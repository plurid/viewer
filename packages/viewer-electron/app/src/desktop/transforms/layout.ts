/**
 * LAYOUT WRITER: draws a resolved layout plan (src/domain/layout/plan.ts) as one PDF that keeps
 * source PDF pages as vectors, or as one PNG or JPEG image. docs/reference/layout.md describes
 * the output exactly.
 */
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { layoutTransformSchema } from '../../domain/layout/plan';
import type { LayoutFormat, LayoutTransform } from '../../domain/layout/plan';
import { identifyBytes, identifyProbe } from '../../domain/files/signatures';
import { cameraRawFormats } from '../../domain/previews/images/rendered';
import { imageDecoder } from '../native/quick-look-render';
import { rawDecoder } from '../previews/derived';
import { inspectPDF, writeBuffer } from './pdf';
import { writeLayoutPDF } from './layout-pdf';
import type { LayoutImaging, LayoutMark } from './layout-image';

/** A source the caller holds open; `size` is its length when it was opened. */
export interface LayoutSource {
  file: string;
  handle: FileHandle;
  size: number;
}
export interface LayoutTools {
  /** qpdf, from `pdfProcessor(processorRoot)`. */
  qpdf: string;
  /** Opens one layout's pixel work. Pictures, PNG and JPEG output, and text outside WinAnsi
   * need it; a plan of shapes and WinAnsi text does not. */
  imaging?: () => LayoutImaging;
  /** The isolated helpers that read images sharp cannot. Without them, HEIC, BMP and camera RAW
   * sources are refused. */
  decoders?: LayoutDecoders;
}
/** Helper executables, each given only the open source descriptor: the previews use them too. */
export interface LayoutDecoders {
  /** viewer-image-preview: the system image decoder, ImageIO, for HEIC, HEIF and BMP. */
  image: string;
  /** viewer-raw: LibRaw, rendering a camera RAW file as Render RAW does. */
  raw: string;
}
/** How an image source reaches sharp: as it is, or as a system decoder's rendition of it. */
type Reading = 'direct' | 'system' | 'raw';
/** A plan as written: defaults may be left out. */
export type LayoutPlan = z.input<typeof layoutTransformSchema>;
type ImageFormat = Exclude<LayoutFormat, 'pdf'>;

const imageBytes = 256_000_000;
const pdfBytes = 512_000_000;
const timeLimit = 10 * 60_000;
/** What the image tools decode, by signature (src/domain/files/signatures.ts). */
const rasterImages = ['jpg', 'png', 'gif', 'webp', 'tiff', 'avif'];
/** What the system decoder reads in their place, as the JPEG quick action does. */
const systemImages = ['heic', 'heif', 'bmp'];
/** The longest side both helpers render. */
const renditionSide = 4096;

const name = (source: LayoutSource) => path.basename(source.file);
async function head(source: LayoutSource): Promise<Uint8Array> {
  const bytes = Buffer.alloc(Math.min(identifyProbe, source.size));
  const { bytesRead } = await source.handle.read(bytes, 0, bytes.length, 0);
  return bytes.subarray(0, bytesRead);
}
async function readAll(source: LayoutSource): Promise<Buffer> {
  const bytes = Buffer.alloc(source.size);
  for (let offset = 0; offset < bytes.length;) {
    const { bytesRead } = await source.handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) throw new Error(`${name(source)} changed while it was read. Export again.`);
    offset += bytesRead;
  }
  return bytes;
}

/** Each placed source is the kind its items need, by signature, and each page exists. Returns how
 * each image source is read. */
async function checkSources(
  plan: LayoutTransform,
  sources: readonly LayoutSource[],
  tools: LayoutTools,
  signal: AbortSignal,
): Promise<Map<number, Reading>> {
  const images = new Set<number>(),
    documents = new Set<number>();
  for (const page of plan.pages)
    for (const item of page.items)
      if (item.kind === 'image' || item.kind === 'page') {
        if (item.source >= sources.length)
          throw new Error('An item refers to a file that is not in this layout.');
        (item.kind === 'image' ? images : documents).add(item.source);
      }
  const readings = new Map<number, Reading>();
  for (const index of images) {
    const source = sources[index]!;
    const kind = identifyBytes(await head(source), name(source))?.extension ?? '';
    // DNG, NEF and ARW files read as the TIFF images they also are: their names say RAW.
    const extension = path.extname(source.file).slice(1).toLowerCase();
    const reading: Reading | undefined =
      cameraRawFormats.includes(kind) || cameraRawFormats.includes(extension)
        ? 'raw'
        : systemImages.includes(kind)
          ? 'system'
          : rasterImages.includes(kind)
            ? 'direct'
            : undefined;
    if (!reading) throw new Error(`${name(source)} is not an image a layout can place.`);
    if (reading === 'raw' && !tools.decoders)
      throw new Error(`${name(source)} is a camera RAW file. Convert it to JPEG first.`);
    if (reading === 'system' && !tools.decoders)
      throw new Error(
        `${name(source)} is a ${kind.toUpperCase()} image. Convert it to JPEG first.`,
      );
    if (source.size > imageBytes) throw new Error(`${name(source)} is larger than 256 MB.`);
    readings.set(index, reading);
  }
  const counts = new Map<number, number>();
  let total = 0;
  for (const index of documents) {
    const source = sources[index]!;
    // A PDF of plain ASCII reads as text to identifyBytes: its header names it, as for inspectPDF.
    const header = Buffer.from(await head(source)).toString('latin1', 0, 1024);
    if (!header.includes('%PDF-')) throw new Error(`${name(source)} is not a PDF.`);
    total += source.size;
    if (total > pdfBytes) throw new Error('PDF sources may total at most 512 MB.');
    counts.set(index, (await inspectPDF(tools.qpdf, source, signal)).pages.length);
  }
  for (const page of plan.pages)
    for (const item of page.items)
      if (item.kind === 'page' && item.page > counts.get(item.source)!) {
        const count = counts.get(item.source)!;
        const pages = count === 1 ? '1 page' : `${count} pages`;
        throw new Error(
          `Page ${item.page} is outside ${name(sources[item.source]!)}, which has ${pages}.`,
        );
      }
  return readings;
}

/** The longest upright side, in pixels, that a source's frames show at the plan's resolution. */
function neededSide(plan: LayoutTransform, source: number): number {
  const scale = plan.dpi / 72;
  let side = 1;
  for (const page of plan.pages)
    for (const item of page.items)
      if (item.kind === 'image' && item.source === source)
        side = Math.max(
          side,
          (item.frame.width * scale) / item.crop.width,
          (item.frame.height * scale) / item.crop.height,
        );
  return Math.min(renditionSide, Math.ceil(side));
}

/**
 * A system decoder's rendition of a source, held in memory: ImageIO's PNG at the size its frames
 * need, upright and in the source's colour profile, or LibRaw's sRGB JPEG of a camera RAW file,
 * upright and at most 4,096 pixels long. Both read only the held descriptor.
 */
async function decoded(
  source: LayoutSource,
  reading: Exclude<Reading, 'direct'>,
  decoders: LayoutDecoders,
  side: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const held = { file: source.file, handle: source.handle, info: await source.handle.stat() };
  try {
    if (reading === 'raw') return (await rawDecoder(decoders.raw)(held, 'raw', signal)).data;
    const render = imageDecoder(decoders.image);
    return await render(held, 'image', signal, side)
      .catch((error: unknown) => {
        // A noisy photo's PNG can pass the helper's 32 MB output limit: try a smaller one once.
        if (signal.aborted || side <= 2048) throw error;
        return render(held, 'image', signal, 2048);
      })
      .then((rendition) => rendition.data);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(`${name(source)}: ${(error as Error).message}`);
  }
}

/** The single page painted at the plan's resolution, then encoded once. */
async function writeImage(
  plan: LayoutTransform,
  format: ImageFormat,
  read: (source: number) => Promise<Buffer>,
  imaging: LayoutImaging,
  target: FileHandle,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
) {
  const page = plan.pages[0]!;
  const scale = plan.dpi / 72;
  await imaging.run(
    {
      kind: 'canvas',
      width: Math.max(1, Math.round(page.width * scale)),
      height: Math.max(1, Math.round(page.height * scale)),
      scale,
      // JPEG has no transparency: an unpainted page is white paper.
      background: page.background ?? (format === 'jpeg' ? '#ffffff' : undefined),
    },
    signal,
  );
  let marks: LayoutMark[] = [];
  const paint = async () => {
    if (marks.length) await imaging.run({ kind: 'canvas-marks', items: marks }, signal);
    marks = [];
  };
  const images = page.items.filter((item) => item.kind === 'image').length;
  let placed = 0;
  for (const item of page.items) {
    signal.throwIfAborted();
    if (item.kind === 'image') {
      await paint();
      await imaging.run(
        {
          kind: 'canvas-image',
          bytes: await read(item.source),
          rotate: item.rotate,
          crop: item.crop,
          frame: item.frame,
        },
        signal,
      );
      placed++;
      progress(0.1 + (0.75 * placed) / images, `Placing image ${placed} of ${images}`);
    } else if (item.kind !== 'page') {
      marks.push(item);
      if (marks.length >= 1000) await paint();
    }
  }
  await paint();
  progress(0.9, `Encoding ${format === 'jpeg' ? 'JPEG' : 'PNG'}`);
  const data = await imaging.run(
    { kind: 'canvas-end', format, quality: plan.quality, dpi: plan.dpi },
    signal,
  );
  signal.throwIfAborted();
  await writeBuffer(target, Buffer.from(data.buffer, data.byteOffset, data.length));
}

/**
 * Writes `plan` as a new file at `output`, which must not exist yet. `sources` are the files the
 * plan's `source` numbers index; a plan of shapes and text may have none. Sources are only read.
 */
export async function renderLayout(
  plan: LayoutPlan,
  sources: readonly LayoutSource[],
  output: string,
  tools: LayoutTools,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void = () => {},
): Promise<void> {
  signal.throwIfAborted();
  const layout = layoutTransformSchema.parse(plan);
  signal = AbortSignal.any([signal, AbortSignal.timeout(timeLimit)]);
  progress(0, 'Checking layout sources');
  const readings = await checkSources(layout, sources, tools, signal);
  let session: LayoutImaging | undefined;
  const begin = tools.imaging;
  const imaging = begin && (() => (session ??= begin()));
  // A decoded rendition is kept until another source is read: frames of one source often follow.
  let last: { source: number; bytes: Buffer } | undefined;
  const read = async (source: number) => {
    const reading = readings.get(source) ?? 'direct';
    if (reading === 'direct') return readAll(sources[source]!);
    if (last?.source === source) return last.bytes;
    const bytes = await decoded(
      sources[source]!,
      reading,
      tools.decoders!,
      neededSide(layout, source),
      signal,
    );
    last = { source, bytes };
    return bytes;
  };
  const target = await open(output, 'wx+', 0o644);
  try {
    if (layout.format === 'pdf')
      await writeLayoutPDF(
        {
          plan: layout,
          sources,
          qpdf: tools.qpdf,
          read,
          imaging,
          signal,
          progress,
        },
        target,
        output,
      );
    else if (!imaging) throw new Error('Image processing is unavailable here.');
    else await writeImage(layout, layout.format, read, imaging(), target, signal, progress);
    await target.sync();
    progress(1, 'Layout ready');
  } finally {
    session?.close();
    await target.close();
  }
}
