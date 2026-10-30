/**
 * A layout as a PDF. Each source page becomes a Form XObject that keeps its vectors and text;
 * pictures, shapes and lines of text are drawn with PDF operators. The objects are written as
 * qpdf JSON into the private staging file, and qpdf builds the PDF from it with object streams
 * and compressed streams.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { promisify } from 'node:util';
import { deflate } from 'node:zlib';
import { z } from 'zod';
import type { LayoutItem, LayoutTransform } from '../../domain/layout/plan';
import { limits as qpdfLimits, writeBuffer } from './pdf';
import { runProcessor as nativeProcessor } from './process';
import {
  fitWinAnsi,
  pdfString,
  plainText,
  winAnsi,
  winAnsiReplaced,
  winAnsiWidth,
} from './layout-text';
import type { TextItem } from './layout-text';
import type { LayoutImaging, Picture, TextMask } from './layout-image';
import type { LayoutSource } from './layout';

type ImageItem = Extract<LayoutItem, { kind: 'image' }>;
type PageItem = Extract<LayoutItem, { kind: 'page' }>;
type RectItem = Extract<LayoutItem, { kind: 'rect' }>;
type PathItem = Extract<LayoutItem, { kind: 'path' }>;
type Rotation = ImageItem['rotate'];
type Crop = ImageItem['crop'];
type Frame = ImageItem['frame'];
/** An affine map as PDF writes it: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
type Box = readonly [left: number, bottom: number, right: number, top: number];
type Dictionary = Record<string, unknown>;

export interface PDFLayout {
  plan: LayoutTransform;
  sources: readonly LayoutSource[];
  qpdf: string;
  read(source: number): Promise<Buffer>;
  /** Pixel work, when this process has it: see `LayoutTools`. */
  imaging?: () => LayoutImaging;
  signal: AbortSignal;
  progress(fraction: number, detail: string): void;
}

/** qpdf JSON the writer stages; past it, the layout is refused before qpdf reads it. */
const jsonLimit = 1_000_000_000;
const outputLimit = 750_000_000;
/** One source's pages as qpdf JSON: under the longest string JavaScript holds. */
const sourceLimit = 500_000_000;
const objectLimit = 2_000_000;
/** Text WinAnsi cannot hold is drawn at this resolution or the plan's, whichever is higher. */
const textResolution = 600;
const tooLarge = 'This layout is too large for one PDF. Choose a lower resolution or fewer pages.';

const compress = promisify(deflate);
const runProcessor: typeof nativeProcessor = (...args) =>
  nativeProcessor(...args).catch((error: Error) => {
    throw new Error(error.message.replace(/\bMedia\b/g, 'PDF'));
  });

/** About seven significant digits, never in exponent form, which PDF does not read. */
function number(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return '0';
  const digits = Math.min(10, Math.max(0, 6 - Math.floor(Math.log10(Math.abs(value)))));
  const text = value.toFixed(digits);
  return digits ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
const colour = (hex: string) =>
  [1, 3, 5].map((at) => number(parseInt(hex.slice(at, at + 2), 16) / 255)).join(' ');
const reference = (id: number) => `${id} 0 R`;
const base64 = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('base64');

/** Applies `first`, then `second`. */
const then = (first: Matrix, second: Matrix): Matrix => [
  first[0] * second[0] + first[1] * second[2],
  first[0] * second[1] + first[1] * second[3],
  first[2] * second[0] + first[3] * second[2],
  first[2] * second[1] + first[3] * second[3],
  first[4] * second[0] + first[5] * second[2] + second[4],
  first[4] * second[1] + first[5] * second[3] + second[5],
];
/** Clockwise quarter turns of a unit square measured from its top-left, y down. */
const turns: Record<Rotation, Matrix> = {
  0: [1, 0, 0, 1, 0, 0],
  90: [0, 1, -1, 0, 1, 0],
  180: [-1, 0, 0, -1, 1, 1],
  270: [0, -1, 1, 0, 0, 1],
};
/** EXIF orientations 1 to 8: the stored image's unit square to the upright one, both y down. */
const orientations: readonly Matrix[] = [
  [1, 0, 0, 1, 0, 0],
  [-1, 0, 0, 1, 1, 0],
  [-1, 0, 0, -1, 1, 1],
  [1, 0, 0, -1, 0, 1],
  [0, 1, 1, 0, 0, 0],
  [0, 1, -1, 0, 1, 0],
  [0, -1, -1, 0, 1, 1],
  [0, -1, 1, 0, 0, 1],
];
/** An image's unit square, y up, to its top-left square, y down. */
const imageSquare: Matrix = [1, 0, 0, -1, 0, 1];
const whole: Crop = { x: 0, y: 0, width: 1, height: 1 };
/** The upright unit square's crop stretched over a frame, on a page `height` tall. */
const cropToFrame = (crop: Crop, frame: Frame, height: number): Matrix => [
  frame.width / crop.width,
  0,
  0,
  -frame.height / crop.height,
  frame.x - (crop.x * frame.width) / crop.width,
  height - frame.y + (crop.y * frame.height) / crop.height,
];
const clip = (frame: Frame, height: number) =>
  `${number(frame.x)} ${number(height - frame.y - frame.height)} ` +
  `${number(frame.width)} ${number(frame.height)} re W n`;
const transform = (matrix: Matrix) => matrix.map(number).join(' ') + ' cm';
/** A PDF /Rotate as a clockwise quarter turn; a value that is not one is ignored, as readers do. */
const quarter = (value: number): Rotation =>
  Number.isInteger(value / 90) ? ((((value % 360) + 360) % 360) as Rotation) : 0;

/** qpdf JSON v2, written in parts: objects may come in any order, the trailer last. */
class QPDFJSON {
  private parts: string[] = ['{"qpdf":[{"jsonversion":2,"pdfversion":"1.7"},{'];
  private buffered = 0;
  private position = 0;
  private separator = '';
  private next = 1;
  constructor(private target: FileHandle) {}
  id(): number {
    if (this.next > objectLimit) throw new Error(tooLarge);
    return this.next++;
  }
  value(id: number, value: unknown): Promise<void> {
    return this.entry(id, JSON.stringify({ value }));
  }
  /** `data` is base64 of the stream's bytes as stored: filtered by its dictionary's /Filter. */
  stream(id: number, dict: Dictionary, data: string): Promise<void> {
    return this.entry(id, `{"stream":{"dict":${JSON.stringify(dict)},"data":"${data}"}}`);
  }
  async end(trailer: Dictionary): Promise<void> {
    this.parts.push(
      `${this.separator}"trailer":${JSON.stringify({ value: { ...trailer, '/Size': this.next } })}}]}`,
    );
    await this.flush();
  }
  private async entry(id: number, body: string) {
    this.parts.push(`${this.separator}"obj:${id} 0 R":`, body);
    this.separator = ',';
    this.buffered += body.length;
    if (this.buffered > 8_000_000) await this.flush();
  }
  private async flush() {
    const bytes = Buffer.from(this.parts.join(''), 'utf8');
    this.parts = [];
    this.buffered = 0;
    if (this.position + bytes.length > jsonLimit) throw new Error(tooLarge);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesWritten } = await this.target.write(
        bytes,
        offset,
        bytes.length - offset,
        this.position + offset,
      );
      if (!bytesWritten) throw new Error('The layout could not be written.');
      offset += bytesWritten;
    }
    this.position += bytes.length;
  }
}

const qpdfObjects = z.object({
  qpdf: z.tuple([
    z.record(z.string(), z.unknown()),
    z.record(
      z.string(),
      z.object({
        value: z.unknown().optional(),
        stream: z
          .object({ dict: z.record(z.string(), z.unknown()), data: z.string().optional() })
          .optional(),
      }),
    ),
  ]),
});
type QPDFObjects = z.infer<typeof qpdfObjects>['qpdf'][1];
const indirect = /^\d+ \d+ R$/;
interface Form {
  id: number;
  box: Box;
  rotate: Rotation;
}

/** Pages 1-3, 7 as qpdf reads a range. */
function ranges(pages: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < pages.length;) {
    let end = index;
    while (end + 1 < pages.length && pages[end + 1] === pages[end]! + 1) end++;
    parts.push(end > index ? `${pages[index]}-${pages[end]}` : `${pages[index]}`);
    index = end + 1;
  }
  return parts.join(',');
}

/**
 * One source PDF's used pages, copied by qpdf with their inherited attributes pushed down and
 * each page's content streams joined into one. Objects are renumbered into the layout as they
 * are reached from a page's resources and content; links to pages are cut.
 */
class SourcePages {
  private ids = new Map<string, number>();
  private queue: string[] = [];
  constructor(
    private objects: QPDFObjects,
    private writer: QPDFJSON,
  ) {}
  static async read(
    qpdf: string,
    source: LayoutSource,
    pages: readonly number[],
    writer: QPDFJSON,
    signal: AbortSignal,
  ) {
    const bytes = await runProcessor(
      qpdf,
      [
        ...qpdfLimits,
        '--empty',
        '--pages',
        '--file=/dev/fd/3',
        `--range=${ranges(pages)}`,
        '--',
        '--coalesce-contents',
        '--json-output',
        '--json-stream-data=inline',
        '--decode-level=none',
        '-',
      ],
      [source.handle.fd],
      signal,
      { timeout: 120000, outputLimit: sourceLimit },
    );
    return new SourcePages(qpdfObjects.parse(JSON.parse(bytes.toString('utf8'))).qpdf[1], writer);
  }
  private resolve(value: unknown): unknown {
    return typeof value === 'string' && indirect.test(value)
      ? this.objects['obj:' + value]?.value
      : value;
  }
  private dictionary(value: unknown): Dictionary | undefined {
    const resolved = this.resolve(value);
    return resolved && typeof resolved === 'object' && !Array.isArray(resolved)
      ? (resolved as Dictionary)
      : undefined;
  }
  /** A value with its links renumbered into the layout. */
  private copy(value: unknown): unknown {
    if (typeof value === 'string') return indirect.test(value) ? this.link(value) : value;
    if (Array.isArray(value)) return value.map((item) => this.copy(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          key === '/Parent' ? [] : [[key, this.copy(item)]],
        ),
      );
    return value;
  }
  private link(target: string): string | null {
    const entry = this.objects['obj:' + target];
    const type = this.dictionary(target)?.['/Type'];
    if (!entry || type === '/Page' || type === '/Pages' || type === '/Catalog') return null;
    let id = this.ids.get(target);
    if (id === undefined) {
      id = this.writer.id();
      this.ids.set(target, id);
      this.queue.push(target);
    }
    return reference(id);
  }
  private inherited(page: Dictionary, key: string): unknown {
    let node: Dictionary | undefined = page;
    for (let depth = 0; node && depth < 64; depth++) {
      if (key in node) return node[key];
      node = this.dictionary(node['/Parent']);
    }
    return undefined;
  }
  private box(value: unknown): Box | undefined {
    const array = this.resolve(value);
    if (!Array.isArray(array) || array.length !== 4) return undefined;
    const numbers = array.map((item) => this.resolve(item));
    if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item)))
      return undefined;
    const [x1, y1, x2, y2] = numbers as number[];
    return [Math.min(x1!, x2!), Math.min(y1!, y2!), Math.max(x1!, x2!), Math.max(y1!, y2!)];
  }
  /** The page objects in document order. */
  pages(): string[] {
    const found: string[] = [];
    const seen = new Set<string>();
    const walk = (value: unknown, depth: number) => {
      if (typeof value !== 'string' || !indirect.test(value) || seen.has(value) || depth > 64)
        return;
      seen.add(value);
      const node = this.dictionary(value);
      const kids = node && this.resolve(node['/Kids']);
      if (node && node['/Type'] !== '/Page' && Array.isArray(kids))
        for (const kid of kids) walk(kid, depth + 1);
      else if (node) found.push(value);
    };
    walk(this.dictionary(this.dictionary(this.objects.trailer?.value)?.['/Root'])?.['/Pages'], 0);
    return found;
  }
  /** A page as a Form XObject: its visible box, resources and content, without annotations. */
  async form(page: string): Promise<Form> {
    const node = this.dictionary(page)!;
    const media = this.box(this.inherited(node, '/MediaBox')) ?? [0, 0, 612, 792];
    const cropped = this.box(this.inherited(node, '/CropBox'));
    const visible: Box = cropped
      ? [
          Math.max(media[0], cropped[0]),
          Math.max(media[1], cropped[1]),
          Math.min(media[2], cropped[2]),
          Math.min(media[3], cropped[3]),
        ]
      : media;
    const box = visible[2] > visible[0] && visible[3] > visible[1] ? visible : media;
    if (box[2] <= box[0] || box[3] <= box[1]) throw new Error('A PDF page has no visible area.');
    const rotation = this.resolve(this.inherited(node, '/Rotate'));
    const contents = node['/Contents'];
    if (Array.isArray(this.resolve(contents)))
      throw new Error('A PDF page could not be read. Check the file, then try again.');
    const stream =
      typeof contents === 'string' ? this.objects['obj:' + contents]?.stream : undefined;
    const dict: Dictionary = {
      '/Type': '/XObject',
      '/Subtype': '/Form',
      '/BBox': box,
      '/Resources': this.copy(this.inherited(node, '/Resources') ?? {}),
    };
    for (const key of ['/Filter', '/DecodeParms'])
      if (stream?.dict[key] !== undefined) dict[key] = this.copy(stream.dict[key]);
    if (node['/Group'] !== undefined) dict['/Group'] = this.copy(node['/Group']);
    const id = this.writer.id();
    await this.writer.stream(id, dict, stream?.data ?? '');
    return { id, box, rotate: quarter(typeof rotation === 'number' ? rotation : 0) };
  }
  /** Writes every object the forms reached. */
  async finish(signal: AbortSignal) {
    for (let index = 0; index < this.queue.length; index++) {
      if (index % 1000 === 0) signal.throwIfAborted();
      const target = this.queue[index]!;
      const entry = this.objects['obj:' + target]!;
      const id = this.ids.get(target)!;
      if (entry.stream)
        await this.writer.stream(
          id,
          this.copy(entry.stream.dict) as Dictionary,
          entry.stream.data ?? '',
        );
      else await this.writer.value(id, this.copy(entry.value ?? null));
    }
    this.queue = [];
  }
}

/** Invisible Type 3 fonts carrying the characters of text drawn as a picture, so a reader can
 * search and copy it. Each holds 255 characters, one per code, all one em wide. */
class HiddenText {
  private fonts: { id: number; characters: string[] }[] = [];
  private codes = new Map<string, { font: number; code: number }>();
  constructor(private writer: QPDFJSON) {}
  name = (font: number) => `T${font + 1}`;
  id = (font: number) => this.fonts[font]!.id;
  /** The text as runs of one font's codes. */
  runs(characters: readonly string[]): { font: number; codes: number[] }[] {
    const runs: { font: number; codes: number[] }[] = [];
    for (const character of characters) {
      let placed = this.codes.get(character);
      if (!placed) {
        let last = this.fonts.at(-1);
        if (!last || last.characters.length === 255)
          this.fonts.push((last = { id: this.writer.id(), characters: [] }));
        last.characters.push(character);
        placed = { font: this.fonts.length - 1, code: last.characters.length };
        this.codes.set(character, placed);
      }
      const run = runs.at(-1);
      if (run?.font === placed.font) run.codes.push(placed.code);
      else runs.push({ font: placed.font, codes: [placed.code] });
    }
    return runs;
  }
  async finish() {
    if (!this.fonts.length) return;
    // One empty glyph, an em wide, serves every code.
    const glyph = this.writer.id();
    await this.writer.stream(glyph, {}, Buffer.from('1000 0 d0').toString('base64'));
    for (const font of this.fonts) {
      const count = font.characters.length;
      const hex = (code: number) => code.toString(16).padStart(2, '0').toUpperCase();
      const unicode = (text: string) =>
        [...Array(text.length).keys()]
          .map((index) => text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase())
          .join('');
      const blocks: string[] = [];
      for (let start = 0; start < count; start += 100) {
        const slice = font.characters.slice(start, start + 100);
        blocks.push(
          `${slice.length} beginbfchar`,
          ...slice.map((text, index) => `<${hex(start + index + 1)}> <${unicode(text)}>`),
          'endbfchar',
        );
      }
      const map = [
        '/CIDInit /ProcSet findresource begin',
        '12 dict begin',
        'begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /Adobe-Identity-UCS def',
        '/CMapType 2 def',
        '1 begincodespacerange',
        '<00> <FF>',
        'endcodespacerange',
        ...blocks,
        'endcmap',
        'CMapName currentdict /CMap defineresource pop',
        'end',
        'end',
      ].join('\n');
      const unicodeMap = this.writer.id();
      await this.writer.stream(unicodeMap, {}, Buffer.from(map).toString('base64'));
      await this.writer.value(font.id, {
        '/Type': '/Font',
        '/Subtype': '/Type3',
        '/FontBBox': [0, 0, 0, 0],
        '/FontMatrix': [0.001, 0, 0, 0.001, 0, 0],
        '/CharProcs': { '/g': reference(glyph) },
        '/Encoding': { '/Type': '/Encoding', '/Differences': [1, ...Array(count).fill('/g')] },
        '/FirstChar': 1,
        '/LastChar': count,
        '/Widths': Array(count).fill(1000),
        '/Resources': {},
        '/ToUnicode': reference(unicodeMap),
      });
    }
  }
}

/** One page's operators and the resources they name. */
class Content {
  readonly operators: string[] = [];
  readonly xobjects = new Map<string, number>();
  readonly fonts = new Map<string, number>();
  constructor(readonly height: number) {}
  xobject(id: number): string {
    const name = `X${id}`;
    this.xobjects.set(name, id);
    return '/' + name;
  }
  font(name: string, id: number): string {
    this.fonts.set(name, id);
    return '/' + name;
  }
  resources(): Dictionary {
    const resources: Dictionary = {};
    const named = (map: Map<string, number>) =>
      Object.fromEntries([...map].map(([name, id]) => ['/' + name, reference(id)]));
    if (this.xobjects.size) resources['/XObject'] = named(this.xobjects);
    if (this.fonts.size) resources['/Font'] = named(this.fonts);
    return resources;
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const rightToLeft =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const strong = /[\p{L}\p{N}]/u;
/**
 * A line's characters in the order it shows them: readers take a PDF's drawing order as visual
 * and rebuild the reading order from it. A reduced bidi algorithm: the first strong character
 * sets the line's direction, a neutral between two runs of one direction joins them, and runs
 * are reversed from the deepest level up.
 */
function visualOrder(characters: readonly string[]): string[] {
  const kinds = characters.map((character) =>
    rightToLeft.test(character) ? 'R' : strong.test(character) ? 'L' : 'N',
  );
  if (!kinds.includes('R')) return [...characters];
  const base = kinds.find((kind) => kind !== 'N')!;
  const levels = kinds.map((kind, index) => {
    let resolved = kind;
    if (kind === 'N') {
      const before = kinds.findLast((other, at) => at < index && other !== 'N') ?? base;
      const after = kinds.find((other, at) => at > index && other !== 'N') ?? base;
      resolved = before === after ? before : base;
    }
    return resolved === 'R' ? 1 : base === 'R' ? 2 : 0;
  });
  const order = [...characters.keys()];
  for (let level = Math.max(...levels); level >= 1; level--)
    for (let start = 0; start < order.length;) {
      if (levels[order[start]!]! < level) {
        start++;
        continue;
      }
      let end = start;
      while (end + 1 < order.length && levels[order[end + 1]!]! >= level) end++;
      order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
      start = end + 1;
    }
  return order.map((index) => characters[index]!);
}
const standardFonts = { regular: 'Helvetica', bold: 'Helvetica-Bold' } as const;

class LayoutWriter {
  private forms = new Map<string, Form>();
  private pictures = new Map<string, { id: number; orientation?: number }>();
  private originals = new Map<number, number>();
  private profiles = new Map<string, number>();
  private standard: Partial<Record<keyof typeof standardFonts, number>> = {};
  private hidden: HiddenText;
  constructor(
    private layout: PDFLayout,
    private writer: QPDFJSON,
  ) {
    this.hidden = new HiddenText(writer);
  }

  private imaging(): LayoutImaging {
    if (!this.layout.imaging) throw new Error('Image processing is unavailable here.');
    return this.layout.imaging();
  }

  /** Every used source page as a form, one source at a time. */
  async importPages(from: number, to: number) {
    const used = new Map<number, Set<number>>();
    for (const page of this.layout.plan.pages)
      for (const item of page.items)
        if (item.kind === 'page')
          used.set(item.source, (used.get(item.source) ?? new Set()).add(item.page));
    const total = [...used.values()].reduce((sum, pages) => sum + pages.size, 0);
    let done = 0;
    for (const [source, numbers] of used) {
      const pages = [...numbers].sort((a, b) => a - b);
      const document = await SourcePages.read(
        this.layout.qpdf,
        this.layout.sources[source]!,
        pages,
        this.writer,
        this.layout.signal,
      );
      const found = document.pages();
      if (found.length !== pages.length)
        throw new Error('A PDF page could not be read. Check the file, then try again.');
      for (const [index, page] of pages.entries()) {
        this.layout.signal.throwIfAborted();
        this.forms.set(`${source}:${page}`, await document.form(found[index]!));
        done++;
        this.layout.progress(
          from + ((to - from) * done) / total,
          `Reading page ${done} of ${total}`,
        );
      }
      await document.finish(this.layout.signal);
    }
  }

  private async profile(icc: Uint8Array, components: 1 | 3): Promise<number> {
    const key = createHash('sha256').update(icc).digest('hex');
    let id = this.profiles.get(key);
    if (id === undefined) {
      id = this.writer.id();
      this.profiles.set(key, id);
      await this.writer.stream(
        id,
        { '/N': components, '/Alternate': components === 1 ? '/DeviceGray' : '/DeviceRGB' },
        base64(icc),
      );
    }
    return id;
  }
  private async image(picture: Picture): Promise<number> {
    const id = this.writer.id();
    const dict: Dictionary = {
      '/Type': '/XObject',
      '/Subtype': '/Image',
      '/Width': picture.width,
      '/Height': picture.height,
      '/ColorSpace': picture.icc
        ? ['/ICCBased', reference(await this.profile(picture.icc, picture.components))]
        : picture.components === 1
          ? '/DeviceGray'
          : '/DeviceRGB',
      '/BitsPerComponent': 8,
      '/Filter': picture.filter === 'jpeg' ? '/DCTDecode' : '/FlateDecode',
    };
    if (picture.alpha) {
      const mask = this.writer.id();
      await this.writer.stream(
        mask,
        {
          '/Type': '/XObject',
          '/Subtype': '/Image',
          '/Width': picture.width,
          '/Height': picture.height,
          '/ColorSpace': '/DeviceGray',
          '/BitsPerComponent': 8,
          '/Filter': '/FlateDecode',
        },
        base64(picture.alpha),
      );
      dict['/SMask'] = reference(mask);
    }
    await this.writer.stream(id, dict, base64(picture.data));
    return id;
  }

  private async drawImage(item: ImageItem, content: Content) {
    const { frame, crop } = item;
    if (!(frame.width > 0 && frame.height > 0)) return;
    const resolution = this.layout.plan.dpi / 72;
    const most = {
      width: Math.max(1, Math.ceil(frame.width * resolution)),
      height: Math.max(1, Math.ceil(frame.height * resolution)),
    };
    const key = [item.source, item.rotate, crop.x, crop.y, crop.width, crop.height]
      .concat(most.width, most.height)
      .join(':');
    let placed = this.pictures.get(key);
    if (!placed) {
      const picture = await this.imaging().run(
        {
          kind: 'picture',
          bytes: await this.layout.read(item.source),
          rotate: item.rotate,
          crop,
          most,
          quality: this.layout.plan.quality,
        },
        this.layout.signal,
      );
      if (picture.orientation === undefined) placed = { id: await this.image(picture) };
      else {
        // The source's own JPEG is embedded once, however many frames show it.
        let id = this.originals.get(item.source);
        if (id === undefined) this.originals.set(item.source, (id = await this.image(picture)));
        placed = { id, orientation: picture.orientation };
      }
      this.pictures.set(key, placed);
    }
    // A picture made for this frame fills it; the source's own JPEG turns, crops and clips here.
    const original = placed.orientation !== undefined;
    const matrix = original
      ? [
          imageSquare,
          orientations[placed.orientation! - 1]!,
          turns[item.rotate],
          cropToFrame(crop, frame, content.height),
        ].reduce(then)
      : then(imageSquare, cropToFrame(whole, frame, content.height));
    content.operators.push(
      'q',
      ...(original ? [clip(frame, content.height)] : []),
      transform(matrix),
      `${content.xobject(placed.id)} Do`,
      'Q',
    );
  }

  private drawPage(item: PageItem, content: Content) {
    const { frame } = item;
    if (!(frame.width > 0 && frame.height > 0)) return;
    const form = this.forms.get(`${item.source}:${item.page}`)!;
    const [left, bottom, right, top] = form.box;
    const width = right - left,
      height = top - bottom;
    // The form's space to its unrotated page seen from the top-left, then both turns.
    const upright: Matrix = [1 / width, 0, 0, -1 / height, -left / width, top / height];
    const matrix = [
      upright,
      turns[quarter(form.rotate + item.rotate)],
      cropToFrame(item.crop, frame, content.height),
    ].reduce(then);
    content.operators.push(
      'q',
      clip(frame, content.height),
      transform(matrix),
      `${content.xobject(form.id)} Do`,
      'Q',
    );
  }

  private drawShape(item: RectItem | PathItem, content: Content) {
    if (!item.fill && !item.stroke) return;
    const operators = ['q'];
    if (item.fill) operators.push(`${colour(item.fill)} rg`);
    if (item.stroke) operators.push(`${colour(item.stroke)} RG`, `${number(item.lineWidth)} w`);
    if (item.kind === 'rect') {
      const { x, y, width, height } = item.frame;
      operators.push(
        `${number(x)} ${number(content.height - y - height)} ${number(width)} ${number(height)} re`,
      );
    } else {
      if (item.stroke && item.dash && item.dash[0] + item.dash[1] > 0)
        operators.push(`[${number(item.dash[0])} ${number(item.dash[1])}] 0 d`);
      const steps: string[] = [];
      for (let index = 0; index < item.points.length; index += 2)
        steps.push(
          `${number(item.points[index]!)} ${number(content.height - item.points[index + 1]!)} ` +
            (index ? 'l' : 'm'),
        );
      operators.push(steps.join('\n'));
      if (item.closed) operators.push('h');
    }
    operators.push(item.fill && item.stroke ? 'B' : item.fill ? 'f' : 'S', 'Q');
    content.operators.push(operators.join('\n'));
  }

  /** A line in Helvetica, shortened with an ellipsis past its `maxWidth`. */
  private drawText(item: TextItem, codes: Uint8Array, content: Content) {
    const fitted = fitWinAnsi(codes, item.size, item.weight, item.maxWidth);
    if (!fitted?.length) return;
    const width = winAnsiWidth(fitted, item.size, item.weight);
    const x =
      item.align === 'start'
        ? item.x
        : item.align === 'center'
          ? item.x - width / 2
          : item.x - width;
    const id = (this.standard[item.weight] ??= this.writer.id());
    const font = content.font(item.weight === 'bold' ? 'F2' : 'F1', id);
    content.operators.push(
      `q BT ${font} ${number(item.size)} Tf ${colour(item.color)} rg ` +
        `${number(x)} ${number(content.height - item.y)} Td ${pdfString(fitted)} Tj ET Q`,
    );
  }

  /** Text drawn as a picture: its colour through the line's opacity mask, then the same
   * characters in an invisible font over it. */
  private async drawMask(item: TextItem, mask: TextMask, content: Content) {
    const masked = this.writer.id(),
      id = this.writer.id();
    const image = (extra: Dictionary) => ({
      '/Type': '/XObject',
      '/Subtype': '/Image',
      '/Width': mask.width,
      '/Height': mask.height,
      '/BitsPerComponent': 8,
      '/Filter': '/FlateDecode',
      ...extra,
    });
    await this.writer.stream(
      masked,
      image({ '/ColorSpace': '/DeviceGray' }),
      (await compress(mask.mask)).toString('base64'),
    );
    const fill = Buffer.alloc(mask.width * mask.height * 3);
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(item.color.slice(at, at + 2), 16));
    for (let at = 0; at < fill.length; at += 3) {
      fill[at] = red!;
      fill[at + 1] = green!;
      fill[at + 2] = blue!;
    }
    await this.writer.stream(
      id,
      image({ '/ColorSpace': '/DeviceRGB', '/SMask': reference(masked) }),
      (await compress(fill)).toString('base64'),
    );
    const frame = {
      x: mask.left / mask.scale,
      y: mask.top / mask.scale,
      width: mask.width / mask.scale,
      height: mask.height / mask.scale,
    };
    content.operators.push(
      'q',
      transform([
        frame.width,
        0,
        0,
        frame.height,
        frame.x,
        content.height - frame.y - frame.height,
      ]),
      `${content.xobject(id)} Do`,
      'Q',
    );
    const characters = visualOrder(
      Array.from(segmenter.segment(mask.text), (part) => part.segment),
    );
    if (!characters.length) return;
    const runs = this.hidden.runs(characters);
    const scaling = (100 * frame.width) / (characters.length * item.size);
    content.operators.push(
      `q BT 3 Tr ${number(scaling)} Tz ${number(frame.x)} ${number(content.height - item.y)} Td`,
      ...runs.map((run) => {
        const font = content.font(this.hidden.name(run.font), this.hidden.id(run.font));
        const codes = run.codes.map((code) => code.toString(16).padStart(2, '0')).join('');
        return `${font} ${number(item.size)} Tf <${codes}> Tj`;
      }),
      'ET Q',
    );
  }

  async drawPages(parent: number, from: number, to: number): Promise<number[]> {
    const { plan, signal } = this.layout;
    const ids: number[] = [];
    for (const [index, page] of plan.pages.entries()) {
      signal.throwIfAborted();
      const content = new Content(page.height);
      if (page.background)
        content.operators.push(
          `q ${colour(page.background)} rg 0 0 ${number(page.width)} ${number(page.height)} re f Q`,
        );
      const masks = new Map<TextItem, TextMask | null>();
      const pictures = page.items.filter((item) => item.kind === 'image').length;
      let placed = 0;
      for (const [position, item] of page.items.entries()) {
        signal.throwIfAborted();
        if (item.kind === 'image') {
          await this.drawImage(item, content);
          // A contact sheet can be one page of hundreds of pictures: report each.
          this.layout.progress(
            from + ((to - from) * (index + ++placed / (pictures + 1))) / plan.pages.length,
            `Placing image ${placed} of ${pictures}`,
          );
        } else if (item.kind === 'page') this.drawPage(item, content);
        else if (item.kind === 'text') {
          const text = plainText(item.text);
          // Without pixel work, as in a service's own report, other characters read as "?".
          const codes = winAnsi(text) ?? (this.layout.imaging ? undefined : winAnsiReplaced(text));
          if (codes) this.drawText(item, codes, content);
          else {
            if (!masks.has(item)) await this.masks(page.items.slice(position), masks);
            const mask = masks.get(item);
            masks.delete(item);
            if (mask) await this.drawMask(item, mask, content);
          }
        } else this.drawShape(item, content);
      }
      const stream = this.writer.id(),
        id = this.writer.id();
      await this.writer.stream(
        stream,
        {},
        Buffer.from(content.operators.join('\n'), 'latin1').toString('base64'),
      );
      await this.writer.value(id, {
        '/Type': '/Page',
        '/Parent': reference(parent),
        '/MediaBox': [0, 0, page.width, page.height],
        '/Resources': content.resources(),
        '/Contents': reference(stream),
      });
      ids.push(id);
      this.layout.progress(
        from + ((to - from) * (index + 1)) / plan.pages.length,
        `Drawing page ${index + 1} of ${plan.pages.length}`,
      );
    }
    return ids;
  }

  /** Pictures of the next lines WinAnsi cannot hold, a hundred to a request, so a page of
   * captions holds a bounded number of them at once. */
  private async masks(items: readonly LayoutItem[], into: Map<TextItem, TextMask | null>) {
    const lines: TextItem[] = [];
    for (const item of items) {
      if (lines.length === 100) break;
      if (item.kind === 'text' && !winAnsi(plainText(item.text))) lines.push(item);
    }
    const masks = await this.imaging().run(
      {
        kind: 'text',
        items: lines,
        scale: Math.max(textResolution, this.layout.plan.dpi) / 72,
      },
      this.layout.signal,
    );
    for (const [index, line] of lines.entries()) into.set(line, masks[index] ?? null);
  }

  async finish() {
    for (const [weight, id] of Object.entries(this.standard) as [
      keyof typeof standardFonts,
      number,
    ][])
      await this.writer.value(id, {
        '/Type': '/Font',
        '/Subtype': '/Type1',
        '/BaseFont': '/' + standardFonts[weight],
        '/Encoding': '/WinAnsiEncoding',
      });
    await this.hidden.finish();
  }
}

/** Writes the layout's PDF at `output`, through `target`, its open staging file. */
export async function writeLayoutPDF(
  layout: PDFLayout,
  target: FileHandle,
  output: string,
): Promise<void> {
  const { plan, signal, progress } = layout;
  const writer = new QPDFJSON(target);
  const catalog = writer.id(),
    pages = writer.id();
  const drawing = new LayoutWriter(layout, writer);
  progress(0.05, 'Reading PDF pages');
  await drawing.importPages(0.05, 0.35);
  const kids = await drawing.drawPages(pages, 0.35, 0.85);
  await drawing.finish();
  await writer.value(pages, {
    '/Type': '/Pages',
    '/Kids': kids.map(reference),
    '/Count': kids.length,
  });
  const title = plan.title?.trim();
  await writer.value(catalog, {
    '/Type': '/Catalog',
    '/Pages': reference(pages),
    ...(title ? { '/ViewerPreferences': { '/DisplayDocTitle': true } } : {}),
  });
  let info: number | undefined;
  if (title) await writer.value((info = writer.id()), { '/Title': 'u:' + title });
  await writer.end({ '/Root': reference(catalog), ...(info ? { '/Info': reference(info) } : {}) });
  signal.throwIfAborted();
  progress(0.9, 'Writing PDF');
  // qpdf seeks in its JSON input: the staging file serves, as in pdf.ts. No other file is made.
  const reader = await open(
    output,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes: Buffer;
  try {
    const [written, read] = await Promise.all([target.stat(), reader.stat()]);
    if (!read.isFile() || written.dev !== read.dev || written.ino !== read.ino)
      throw new Error('The private PDF staging file changed. Export again.');
    bytes = await runProcessor(
      layout.qpdf,
      [
        ...qpdfLimits,
        '--json-input',
        '--compress-streams=y',
        '--object-streams=generate',
        '--deterministic-id',
        '/dev/fd/3',
        '-',
      ],
      [reader.fd],
      signal,
      { timeout: 300000, outputLimit },
    ).catch((error: Error) => {
      throw /inspection limit/.test(error.message) ? new Error(tooLarge) : error;
    });
  } finally {
    await reader.close();
  }
  signal.throwIfAborted();
  await writeBuffer(target, bytes);
}
