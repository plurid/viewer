/** The layout writer against generated PDFs and images, and a pinned camera RAW original when the
 * playground holds one: vector pages, pictures, shapes, text and raster pages, checked with qpdf,
 * PDF.js rendering and sharp decoding. Every folder is kept. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { temporaryRoot } from '../tools/temporary';
import { cameraRawSamples } from '../tools/playground/camera-raw';
import { workbenchPDF } from './pdf-fixtures';
import { holds, placePinned } from './support/real-corpus';
import { layoutTransformSchema } from '../src/domain/layout/plan';
import type { LayoutTransform } from '../src/domain/layout/plan';
import { titledPlan } from '../src/domain/layout/names';
import { validateTransform } from '../src/domain/operations/transforms';
import { renderLayout } from '../src/desktop/transforms/layout';
import type { LayoutPlan, LayoutSource, LayoutTools } from '../src/desktop/transforms/layout';
import { layoutImagingInProcess } from '../src/desktop/transforms/layout-image';
import { pdfProcessor } from '../src/desktop/transforms/pdf';
import { runProcessor } from '../src/desktop/transforms/process';
import { Transforms } from '../src/desktop/transforms/transforms';
import { transformImage } from '../src/desktop/transforms/image';

interface Canvas {
  getContext(kind: '2d'): { getImageData(x: number, y: number, w: number, h: number): ImageData };
}
type Colour = readonly [number, number, number];

const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`);
const qpdf = pdfProcessor(processors);
const ready =
  process.platform === 'darwin' &&
  existsSync(path.join(processors, 'manifest.json')) &&
  existsSync(qpdf);
const tools: LayoutTools = { qpdf, imaging: () => layoutImagingInProcess(processors) };
const decoders = {
  image: path.resolve('assets', 'viewer-image-preview'),
  raw: path.resolve('assets', `viewer-raw-v3-darwin-${process.arch}`, 'viewer-raw'),
};
const decoding: LayoutTools = { ...tools, decoders };
const rawSample = cameraRawSamples.find((sample) => sample.path.endsWith('Sony-a7III.ARW'))!;
const pdfRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const { createCanvas } = createRequire(path.join(pdfRoot, 'package.json'))('@napi-rs/canvas') as {
  createCanvas(width: number, height: number): Canvas;
};
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
const signal = () => new AbortController().signal;
const red: Colour = [220, 0, 0],
  blue: Colour = [0, 0, 220],
  white: Colour = [255, 255, 255];

const sharp = () => createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp'));

/** A source page tree that keeps Resources, MediaBox and Rotate on its Pages node. Page 1 joins
 * two content streams, carries a note annotation and paints its top-left 100 points red; page 2
 * has a CropBox. */
function treePDF(): Buffer {
  const objects: Buffer[] = [];
  const add = (value: string) => objects.push(Buffer.from(value));
  const stream = (dictionary: string, data: string) =>
    add(`<< ${dictionary} /Length ${data.length} >>\nstream\n${data}\nendstream`);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] /Resources << /Font << /F1 5 0 R >> >> ' +
      '/MediaBox [0 0 300 400] /Rotate 90 >>',
  );
  add('<< /Type /Page /Parent 2 0 R /Contents [6 0 R 7 0 R] /Annots [9 0 R] >>');
  add('<< /Type /Page /Parent 2 0 R /Contents 8 0 R /CropBox [10 10 290 390] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  stream('', '1 0 0 rg 0 300 100 100 re f BT /F1 18 Tf 120 350 Td');
  stream('', '(Inherited first) Tj ET');
  stream('', 'BT /F1 18 Tf 40 350 Td (Cropped second) Tj ET');
  add('<< /Type /Annot /Subtype /Text /Rect [0 0 20 20] /Contents (A note) >>');
  const parts = [Buffer.from('%PDF-1.4\n')],
    offsets: number[] = [];
  let size = parts[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(size);
    const item = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(item);
    size += item.length;
  }
  const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table.join('')}trailer\n` +
        `<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

/** 400 by 300 stored pixels, upright 300 by 400 through EXIF orientation 6. The upright top-left
 * quarter is red, the rest blue. */
async function orientedPhoto(): Promise<Buffer> {
  const width = 400,
    height = 300;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const colour = x < width / 2 && y >= height / 2 ? red : blue;
      pixels.set(colour, (y * width + x) * 3);
    }
  return sharp()(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

async function sources(files: readonly string[]): Promise<LayoutSource[]> {
  return Promise.all(
    files.map(async (file) => {
      const handle = await open(file);
      return { file, handle, size: (await handle.stat()).size };
    }),
  );
}
async function render(
  plan: LayoutPlan,
  files: readonly string[],
  output: string,
  options: { tools?: LayoutTools; signal?: AbortSignal; progress?: (detail: string) => void } = {},
) {
  const held = await sources(files);
  try {
    await renderLayout(
      plan,
      held,
      output,
      options.tools ?? tools,
      options.signal ?? signal(),
      (_fraction, detail) => options.progress?.(detail),
    );
  } finally {
    await Promise.all(held.map((source) => source.handle.close()));
  }
  return output;
}
async function checked(file: string) {
  const report = await runProcessor(qpdf, ['--check', file], [], signal());
  expect(report.toString()).toContain('No syntax or stream encoding errors');
}
async function objects(
  file: string,
): Promise<Record<string, { value?: unknown; stream?: { dict: Record<string, unknown> } }>> {
  const bytes = await runProcessor(
    qpdf,
    ['--json=2', '--json-key=qpdf', '--decode-level=none', file],
    [],
    signal(),
    { outputLimit: 64_000_000 },
  );
  return JSON.parse(bytes.toString()).qpdf[1];
}
const imagesIn = (values: Awaited<ReturnType<typeof objects>>) =>
  Object.values(values).flatMap((entry) =>
    entry.stream?.dict['/Subtype'] === '/Image' ? [entry.stream.dict] : [],
  );

/** Each page's size and text, and its pixels at one pixel per point. */
async function readPDF(file: string, paint = false) {
  const task = getDocument({
    data: new Uint8Array(await readFile(file)),
    standardFontDataUrl: pdfRoot + '/standard_fonts/',
  });
  try {
    const document = await task.promise;
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const text = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      let pixels: ImageData | undefined;
      if (paint) {
        const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
        pixels = canvas.getContext('2d').getImageData(0, 0, viewport.width, viewport.height);
      }
      pages.push({ width: viewport.width, height: viewport.height, text, pixels });
    }
    return { pages, title: ((await document.getMetadata()).info as { Title?: string }).Title };
  } finally {
    await task.destroy();
  }
}
/** The colour at a point of a page painted one pixel per point, or of a decoded image. */
function at(
  pixels: { width: number; data: ArrayLike<number> },
  x: number,
  y: number,
  channels = 4,
) {
  const index = (Math.floor(y) * pixels.width + Math.floor(x)) * channels;
  return [pixels.data[index]!, pixels.data[index + 1]!, pixels.data[index + 2]!] as const;
}
const near = (actual: Colour, expected: Colour, tolerance = 48) =>
  actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance);

it.skipIf(!ready)(
  'draws a shapes-and-text report with no sources as a checked PDF of many pages',
  async () => {
    const root = await temporaryRoot('viewer-layout-report-');
    const points = Array.from({ length: 4000 }, (_, index) =>
      index % 2 ? 300 + 200 * Math.sin(index / 50) : 40 + (index / 4000) * 500,
    );
    const pages = Array.from({ length: 40 }, (_, index) => ({
      width: 595,
      height: 842,
      items: [
        {
          kind: 'rect' as const,
          frame: { x: 20, y: 20, width: 555, height: 802 },
          stroke: '#333333',
        },
        {
          kind: 'path' as const,
          points,
          stroke: '#cc0000',
          lineWidth: 0.5,
          dash: [3, 1] as [number, number],
        },
        {
          kind: 'path' as const,
          points: [100, 600, 200, 600, 150, 700],
          closed: true,
          fill: '#00aa00',
        },
        {
          kind: 'text' as const,
          text: `Sheet ${index + 1} of 40 (2 mm kerf, 98% used)`,
          x: 297.5,
          y: 800,
          size: 12,
          align: 'center' as const,
          weight: 'bold' as const,
        },
        // Without the image processor, characters outside WinAnsi read as question marks.
        { kind: 'text' as const, text: 'Part 東京-7', x: 40, y: 760, size: 10 },
      ],
    }));
    const output = await render(
      { kind: 'layout', format: 'pdf', title: 'Nesting report', pages },
      [],
      path.join(root, 'Report.pdf'),
      { tools: { qpdf } },
    );
    await checked(output);
    const read = await readPDF(output, true);
    expect(read.title).toBe('Nesting report');
    expect(read.pages).toHaveLength(40);
    expect(read.pages[39]).toMatchObject({ width: 595, height: 842 });
    expect(read.pages[39]!.text).toContain('Sheet 40 of 40 (2 mm kerf, 98% used)');
    expect(read.pages[0]!.text).toContain('Part ??-7');
    expect(near(at(read.pages[0]!.pixels!, 150, 660), [0, 170, 0])).toBe(true);
    expect(near(at(read.pages[0]!.pixels!, 300, 400), white, 8)).toBe(true);
    console.warn('Retained layout report:', root);
  },
);

it.skipIf(!ready)(
  'places source PDF pages as vectors through inherited attributes, rotation and crop',
  async () => {
    const root = await temporaryRoot('viewer-layout-pages-');
    const tree = path.join(root, 'Tree.pdf'),
      deck = path.join(root, 'Deck.pdf');
    await writeFile(tree, treePDF(), { flag: 'wx' });
    await writeFile(deck, workbenchPDF(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']), {
      flag: 'wx',
    });
    // Tree.pdf page 1 shows 400 by 300 through its inherited Rotate 90, red at top-right.
    const frames = {
      turned: { x: 40, y: 40, width: 200, height: 150 },
      upright: { x: 300, y: 40, width: 150, height: 200 },
      cropped: { x: 40, y: 300, width: 200, height: 150 },
    };
    const output = await render(
      {
        kind: 'layout',
        format: 'pdf',
        pages: [
          {
            width: 612,
            height: 792,
            items: [
              { kind: 'page', source: 0, page: 1, frame: frames.turned },
              { kind: 'page', source: 0, page: 1, frame: frames.upright, rotate: 90 },
              {
                kind: 'page',
                source: 0,
                page: 1,
                frame: frames.cropped,
                crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
              },
              {
                kind: 'page',
                source: 0,
                page: 2,
                frame: { x: 300, y: 300, width: 200, height: 150 },
              },
            ],
          },
          {
            width: 842,
            height: 595,
            items: [1, 2, 3, 4].map((page, index) => ({
              kind: 'page' as const,
              source: 1,
              page,
              frame: {
                x: (index % 2) * 421,
                y: Math.floor(index / 2) * 297.5,
                width: 421,
                height: 297.5,
              },
            })),
          },
        ],
      },
      [tree, deck],
      path.join(root, 'Pages.pdf'),
    );
    await checked(output);
    const read = await readPDF(output, true);
    expect(read.pages.map((page) => [page.width, page.height])).toEqual([
      [612, 792],
      [842, 595],
    ]);
    expect(read.pages[0]!.text).toContain('Inherited first');
    expect(read.pages[0]!.text).toContain('Cropped second');
    expect(read.pages[1]!.text).toMatch(/Alpha.*Beta.*Gamma.*Delta/);
    expect(read.pages[1]!.text).not.toContain('Epsilon');
    const pixels = read.pages[0]!.pixels!;
    const sample = (
      frame: { x: number; y: number; width: number; height: number },
      u: number,
      v: number,
    ) => at(pixels, frame.x + u * frame.width, frame.y + v * frame.height);
    // Rotate 90 puts the red corner at the top-right; another 90 at the bottom-right.
    expect(near(sample(frames.turned, 0.9, 0.15), red)).toBe(true);
    expect(near(sample(frames.turned, 0.1, 0.15), white, 8)).toBe(true);
    expect(near(sample(frames.upright, 0.85, 0.9), red)).toBe(true);
    expect(near(sample(frames.upright, 0.85, 0.1), white, 8)).toBe(true);
    // The crop keeps the top-right quarter, so red fills its right half; nothing spills out.
    expect(near(sample(frames.cropped, 0.75, 0.3), red)).toBe(true);
    expect(near(sample(frames.cropped, 0.25, 0.3), white, 8)).toBe(true);
    expect(near(at(pixels, frames.cropped.x - 5, frames.cropped.y + 20), white, 8)).toBe(true);
    const values = await objects(output);
    const kinds = Object.values(values).map((entry) => [
      entry.stream?.dict['/Subtype'],
      (entry.value as { '/Type'?: string } | undefined)?.['/Type'],
    ]);
    expect(kinds.filter(([subtype]) => subtype === '/Form')).toHaveLength(6);
    expect(kinds.some(([, type]) => type === '/Annot')).toBe(false);
    expect(imagesIn(values)).toHaveLength(0);
    console.warn('Retained layout pages:', root);
  },
);

it.skipIf(!ready)(
  'embeds pictures through orientation, rotation and crop, keeping a JPEG unless it is downsampled',
  async () => {
    const root = await temporaryRoot('viewer-layout-pictures-');
    const photo = path.join(root, 'Photo.jpg'),
      logo = path.join(root, 'Logo.png');
    await writeFile(photo, await orientedPhoto(), { flag: 'wx' });
    await writeFile(
      logo,
      await sharp()({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer(),
      { flag: 'wx' },
    );
    const frames = {
      upright: { x: 40, y: 40, width: 150, height: 200 },
      turned: { x: 220, y: 40, width: 200, height: 150 },
      redQuarter: { x: 40, y: 300, width: 100, height: 100 },
      blueQuarter: { x: 160, y: 300, width: 100, height: 100 },
      logo: { x: 300, y: 300, width: 100, height: 100 },
    };
    const page = {
      width: 500,
      height: 500,
      background: '#ffffff',
      items: [
        { kind: 'image' as const, source: 0, frame: frames.upright },
        { kind: 'image' as const, source: 0, frame: frames.turned, rotate: 90 as const },
        {
          kind: 'image' as const,
          source: 0,
          frame: frames.redQuarter,
          crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },
        {
          kind: 'image' as const,
          source: 0,
          frame: frames.blueQuarter,
          crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
        },
        { kind: 'image' as const, source: 1, frame: frames.logo },
        {
          kind: 'text' as const,
          text: 'Photo.jpg',
          x: 115,
          y: 260,
          size: 9,
          align: 'center' as const,
        },
      ],
    };
    const expectations = (
      sample: (frame: (typeof frames)[keyof typeof frames], u: number, v: number) => Colour,
    ) => {
      expect(near(sample(frames.upright, 0.25, 0.25), red)).toBe(true);
      expect(near(sample(frames.upright, 0.75, 0.75), blue)).toBe(true);
      expect(near(sample(frames.turned, 0.75, 0.25), red)).toBe(true);
      expect(near(sample(frames.turned, 0.25, 0.25), blue)).toBe(true);
      expect(near(sample(frames.redQuarter, 0.5, 0.5), red)).toBe(true);
      expect(near(sample(frames.blueQuarter, 0.5, 0.5), blue)).toBe(true);
      expect(near(sample(frames.logo, 0.5, 0.5), [127, 127, 255], 24)).toBe(true);
    };
    for (const dpi of [300, 36]) {
      const output = await render(
        { kind: 'layout', format: 'pdf', dpi, pages: [page] },
        [photo, logo],
        path.join(root, `Pictures ${dpi}.pdf`),
      );
      await checked(output);
      const read = await readPDF(output, true);
      expect(read.pages[0]!.text).toContain('Photo.jpg');
      const pixels = read.pages[0]!.pixels!;
      expectations((frame, u, v) =>
        at(pixels, frame.x + u * frame.width, frame.y + v * frame.height),
      );
      const images = imagesIn(await objects(output));
      const jpegs = images.filter((image) => image['/Filter'] === '/DCTDecode');
      if (dpi === 300)
        // The source JPEG once, as stored, for every frame that does not shrink it.
        expect(
          jpegs.filter((image) => image['/Width'] === 400 && image['/Height'] === 300),
        ).toHaveLength(1);
      else
        expect(Math.max(...jpegs.map((image) => Number(image['/Width'])))).toBeLessThanOrEqual(100);
      expect(images.some((image) => image['/SMask'])).toBe(true);
    }
    for (const format of ['png', 'jpeg'] as const) {
      const output = await render(
        { kind: 'layout', format, dpi: 144, pages: [page] },
        [photo, logo],
        path.join(root, `Pictures.${format === 'jpeg' ? 'jpg' : 'png'}`),
      );
      const { data, info } = await sharp()(output)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([1000, 1000]);
      expectations((frame, u, v) =>
        at(
          { width: info.width, data },
          (frame.x + u * frame.width) * 2,
          (frame.y + v * frame.height) * 2,
          3,
        ),
      );
    }
    console.warn('Retained layout pictures:', root);
  },
);

it.skipIf(!ready)(
  'paints PNG and JPEG pages in sRGB at the plan resolution, transparent where a PNG is unpainted',
  async () => {
    const root = await temporaryRoot('viewer-layout-raster-');
    const page = {
      width: 300,
      height: 200,
      items: [
        { kind: 'rect' as const, frame: { x: 10, y: 10, width: 100, height: 80 }, fill: '#ff0000' },
        {
          kind: 'path' as const,
          points: [150, 20, 290, 20, 290, 90],
          closed: true,
          fill: '#0000ff',
        },
        { kind: 'rect' as const, frame: { x: 50, y: 50, width: 20, height: 20 }, fill: '#00ff00' },
        { kind: 'text' as const, text: 'Caption', x: 10, y: 150, size: 24, color: '#000000' },
      ],
    };
    const png = await render(
      { kind: 'layout', format: 'png', dpi: 216, pages: [page] },
      [],
      path.join(root, 'Sheet.png'),
    );
    const decoded = await sharp()(png).raw().toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height, decoded.info.channels]).toEqual([900, 600, 4]);
    const pixel = (x: number, y: number) => at({ width: 900, data: decoded.data }, x * 3, y * 3, 4);
    expect(pixel(20, 20)).toEqual([255, 0, 0]);
    expect(pixel(60, 60)).toEqual([0, 255, 0]);
    expect(pixel(280, 30)).toEqual([0, 0, 255]);
    expect(decoded.data[(10 * 900 + 890) * 4 + 3]).toBe(0);
    let ink = 0;
    for (let y = 130 * 3; y < 155 * 3; y++)
      for (let x = 10 * 3; x < 100 * 3; x++) if (decoded.data[(y * 900 + x) * 4 + 3]! > 128) ink++;
    expect(ink).toBeGreaterThan(500);
    const metadata = await sharp()(png).metadata();
    expect(metadata.density).toBe(216);
    expect(metadata.icc).toBeDefined();
    // Only the resolution tags sharp writes with the density.
    expect(metadata.exif?.length ?? 0).toBeLessThan(256);
    const jpeg = await render(
      { kind: 'layout', format: 'jpeg', dpi: 72, quality: 80, pages: [page] },
      [],
      path.join(root, 'Sheet.jpg'),
    );
    const flat = await sharp()(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect([flat.info.width, flat.info.height, flat.info.channels]).toEqual([300, 200, 3]);
    expect(near(at({ width: 300, data: flat.data }, 290, 190, 3), white, 4)).toBe(true);
    expect(near(at({ width: 300, data: flat.data }, 20, 20, 3), [255, 0, 0], 24)).toBe(true);
    console.warn('Retained layout raster pages:', root);
  },
);

it.skipIf(!ready)('draws text WinAnsi cannot hold as a picture that stays searchable', async () => {
  const root = await temporaryRoot('viewer-layout-unicode-');
  const caption = { kind: 'text' as const, x: 50, y: 60, size: 14, color: '#003366' };
  const output = await render(
    {
      kind: 'layout',
      format: 'pdf',
      pages: [
        {
          width: 300,
          height: 200,
          items: [
            { ...caption, text: '東京.jpg' },
            { ...caption, y: 100, text: 'Ελληνικά and שלום' },
            { ...caption, y: 140, text: '東京の長い写真の名前がここにあります.jpg', maxWidth: 120 },
            { ...caption, y: 180, text: 'Café crème €5', weight: 'bold' as const },
          ],
        },
      ],
    },
    [],
    path.join(root, 'Captions.pdf'),
  );
  await checked(output);
  const read = await readPDF(output, true);
  const text = read.pages[0]!.text;
  expect(text).toContain('東京.jpg');
  expect(text).toContain('Ελληνικά and שלום');
  expect(text).toContain('Café crème €5');
  expect(text).toMatch(/東京の.*…/);
  let ink = 0;
  for (let y = 45; y < 65; y++)
    for (let x = 50; x < 120; x++) if (!near(at(read.pages[0]!.pixels!, x, y), white, 60)) ink++;
  expect(ink).toBeGreaterThan(80);
  // The shortened line stays inside its 120 points.
  for (let y = 125; y < 145; y++)
    for (let x = 175; x < 300; x++)
      expect(near(at(read.pages[0]!.pixels!, x, y), white, 60)).toBe(true);
  expect(imagesIn(await objects(output)).filter((image) => image['/SMask'])).toHaveLength(3);
  console.warn('Retained layout captions:', root);
});

it.skipIf(!ready)('lays out through the transform service with its source checks', async () => {
  const root = await temporaryRoot('viewer-layout-service-');
  const deck = path.join(root, 'Deck.pdf'),
    photo = path.join(root, 'Photo.jpg');
  await writeFile(deck, workbenchPDF(['One', 'Two']), { flag: 'wx' });
  await writeFile(photo, await orientedPhoto(), { flag: 'wx' });
  const transforms = new Transforms(
    processors,
    async () => {},
    (bytes, plan) => transformImage(processors, bytes, plan),
    undefined,
    { imaging: () => layoutImagingInProcess(processors) },
  );
  const plan = {
    kind: 'layout',
    format: 'pdf',
    pages: [
      {
        width: 400,
        height: 300,
        items: [
          { kind: 'page', source: 0, page: 2, frame: { x: 0, y: 0, width: 200, height: 266 } },
          { kind: 'image', source: 1, frame: { x: 220, y: 20, width: 150, height: 200 } },
        ],
      },
    ],
  };
  const details: string[] = [];
  try {
    const output = path.join(root, 'Sheet.pdf');
    await transforms.execute(
      validateTransform(titledPlan(plan as LayoutTransform, 'Sheet for Ana.pdf'), 2),
      [deck, photo],
      output,
      signal(),
      (_fraction, detail) => details.push(detail),
    );
    await checked(output);
    const read = await readPDF(output);
    expect(read.pages[0]!.text).toContain('Two');
    // titled with the name chosen, without its extension
    expect(read.title).toBe('Sheet for Ana');
    expect(details.at(-1)).toBe('Layout ready');
    expect(() => validateTransform(plan, 1)).toThrow('not in this layout');
    const swapped = structuredClone(plan);
    swapped.pages[0]!.items[0]!.source = 1;
    await expect(
      transforms.execute(
        validateTransform(swapped, 2),
        [deck, photo],
        path.join(root, 'A.pdf'),
        signal(),
        () => {},
      ),
    ).rejects.toThrow('Photo.jpg is not a PDF.');
    const outside = structuredClone(plan);
    (outside.pages[0]!.items[0] as { page: number }).page = 3;
    await expect(
      transforms.execute(
        validateTransform(outside, 2),
        [deck, photo],
        path.join(root, 'B.pdf'),
        signal(),
        () => {},
      ),
    ).rejects.toThrow('Page 3 is outside Deck.pdf, which has 2 pages.');
  } finally {
    await transforms.quiesce();
  }
  console.warn('Retained layout service output:', root);
});

it.skipIf(!ready)('refuses sources, plans and work outside its limits', async () => {
  const root = await temporaryRoot('viewer-layout-limits-');
  const deck = path.join(root, 'Deck.pdf'),
    raw = path.join(root, 'Shot.dng'),
    heic = path.join(root, 'Phone.heic'),
    photo = path.join(root, 'Photo.jpg');
  await writeFile(deck, workbenchPDF(['One']), { flag: 'wx' });
  await writeFile(photo, await orientedPhoto(), { flag: 'wx' });
  await writeFile(
    raw,
    await sharp()({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .tiff()
      .toBuffer(),
    { flag: 'wx' },
  );
  await writeFile(
    heic,
    Buffer.concat([Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic', 'latin1'), Buffer.alloc(64)]),
    { flag: 'wx' },
  );
  const picture = (source: number) => ({
    kind: 'layout' as const,
    format: 'pdf' as const,
    pages: [
      {
        width: 100,
        height: 100,
        items: [{ kind: 'image' as const, source, frame: { x: 0, y: 0, width: 50, height: 50 } }],
      },
    ],
  });
  const files = [deck, raw, heic, photo];
  let count = 0;
  const attempt = (plan: LayoutPlan, options?: Parameters<typeof render>[3]) =>
    render(plan, files, path.join(root, `Attempt ${++count}.pdf`), options);
  await expect(attempt(picture(0))).rejects.toThrow('Deck.pdf is not an image a layout can place.');
  await expect(attempt(picture(1))).rejects.toThrow('Shot.dng is a camera RAW file.');
  await expect(attempt(picture(2))).rejects.toThrow('Phone.heic is a HEIC image.');
  await expect(attempt(picture(7))).rejects.toThrow('not in this layout');
  await expect(attempt(picture(3), { tools: { qpdf } })).rejects.toThrow(
    'Image processing is unavailable',
  );
  const blank = { width: 100, height: 100, items: [] };
  expect(() =>
    layoutTransformSchema.parse({ kind: 'layout', format: 'pdf', pages: Array(1001).fill(blank) }),
  ).toThrow();
  expect(() =>
    layoutTransformSchema.parse({
      kind: 'layout',
      format: 'png',
      dpi: 1200,
      pages: [{ ...blank, width: 14400, height: 14400 }],
    }),
  ).toThrow('100 megapixels');
  expect(() =>
    layoutTransformSchema.parse({
      kind: 'layout',
      format: 'jpeg',
      pages: [
        {
          ...blank,
          items: [{ kind: 'page', source: 0, page: 1, frame: { x: 0, y: 0, width: 1, height: 1 } }],
        },
      ],
    }),
  ).toThrow('PDF pages are laid out as a PDF.');
  const stopped = new AbortController();
  stopped.abort(new Error('Stopped before it began.'));
  await expect(attempt(picture(3), { signal: stopped.signal })).rejects.toThrow(
    'Stopped before it began.',
  );
  const cancel = new AbortController();
  const many = {
    kind: 'layout' as const,
    format: 'pdf' as const,
    pages: Array(20).fill({
      ...blank,
      items: [{ kind: 'image' as const, source: 3, frame: { x: 0, y: 0, width: 50, height: 50 } }],
    }),
  };
  await expect(
    attempt(many, {
      signal: cancel.signal,
      progress: (detail) => {
        if (detail === 'Drawing page 3 of 20') cancel.abort(new Error('Cancelled at page 3.'));
      },
    }),
  ).rejects.toThrow('Cancelled at page 3.');
  console.warn('Retained layout limits:', root);
});

it.skipIf(!ready)(
  'lays out HEIC and BMP images through the system decoder, upright and at the size frames need',
  async (context) => {
    const root = await temporaryRoot('viewer-layout-heic-');
    const jpeg = path.join(root, 'Source.jpg'),
      heic = path.join(root, 'Phone.heic');
    await writeFile(jpeg, await orientedPhoto(), { flag: 'wx' });
    // sips keeps the EXIF orientation as the HEIF rotation ImageIO applies.
    const made = await promisify(execFile)('/usr/bin/sips', [
      '-s',
      'format',
      'heic',
      jpeg,
      '--out',
      heic,
    ])
      .then(() => existsSync(heic))
      .catch(() => false);
    if (!made) {
      console.warn('sips cannot write HEIC on this Mac: the HEIC layout is not checked.');
      context.skip();
    }
    const frames = {
      upright: { x: 40, y: 40, width: 150, height: 200 },
      turned: { x: 220, y: 40, width: 200, height: 150 },
    };
    const page = {
      width: 500,
      height: 300,
      items: [
        { kind: 'image' as const, source: 0, frame: frames.upright },
        { kind: 'image' as const, source: 0, frame: frames.turned, rotate: 90 as const },
      ],
    };
    const expectations = (
      sample: (frame: typeof frames.upright, u: number, v: number) => Colour,
    ) => {
      expect(near(sample(frames.upright, 0.25, 0.25), red)).toBe(true);
      expect(near(sample(frames.upright, 0.75, 0.75), blue)).toBe(true);
      expect(near(sample(frames.turned, 0.75, 0.25), red)).toBe(true);
      expect(near(sample(frames.turned, 0.25, 0.75), blue)).toBe(true);
    };
    await expect(
      render({ kind: 'layout', format: 'pdf', pages: [page] }, [heic], path.join(root, 'A.pdf')),
    ).rejects.toThrow('Phone.heic is a HEIC image. Convert it to JPEG first.');
    const pdf = await render(
      { kind: 'layout', format: 'pdf', dpi: 72, pages: [page] },
      [heic],
      path.join(root, 'Phone.pdf'),
      { tools: decoding },
    );
    await checked(pdf);
    const pixels = (await readPDF(pdf, true)).pages[0]!.pixels!;
    expectations((frame, u, v) =>
      at(pixels, frame.x + u * frame.width, frame.y + v * frame.height),
    );
    // At 72 dpi the longest frame side asks for 200 pixels: the rendition is no larger.
    const sizes = imagesIn(await objects(pdf)).map((image) => [image['/Width'], image['/Height']]);
    expect(sizes.flat().every((side) => Number(side) <= 200)).toBe(true);
    const png = await render(
      { kind: 'layout', format: 'png', dpi: 144, pages: [page] },
      [heic],
      path.join(root, 'Phone.png'),
      { tools: decoding },
    );
    const { data, info } = await sharp()(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1000, 600]);
    expectations((frame, u, v) =>
      at(
        { width: info.width, data },
        (frame.x + u * frame.width) * 2,
        (frame.y + v * frame.height) * 2,
        3,
      ),
    );
    // BMP takes the same route; sips writes it upright.
    const bmp = path.join(root, 'Scan.bmp');
    await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'bmp', jpeg, '--out', bmp]);
    const flat = await render(
      {
        kind: 'layout',
        format: 'png',
        dpi: 72,
        pages: [{ ...page, items: page.items.slice(0, 1) }],
      },
      [bmp],
      path.join(root, 'Scan.png'),
      { tools: decoding },
    );
    const scan = await sharp()(flat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const point = (u: number, v: number) =>
      at(
        { width: scan.info.width, data: scan.data },
        frames.upright.x + u * frames.upright.width,
        frames.upright.y + v * frames.upright.height,
        3,
      );
    expect(near(point(0.25, 0.25), red)).toBe(true);
    expect(near(point(0.75, 0.75), blue)).toBe(true);
    console.warn('Retained HEIC layout:', root);
  },
);

it.skipIf(!ready)(
  'renders a camera RAW file through the RAW helper as Render RAW does',
  async () => {
    const root = await temporaryRoot('viewer-layout-raw-route-');
    // A stand-in helper: it answers Render RAW's mode with a blue JPEG, as the real one answers.
    const rendition = path.join(root, 'Rendition.jpg'),
      helper = path.join(root, 'viewer-raw'),
      shot = path.join(root, 'Shot.dng');
    await writeFile(
      rendition,
      await sharp()({ create: { width: 300, height: 200, channels: 3, background: '#0000dc' } })
        .jpeg()
        .toBuffer(),
      { flag: 'wx' },
    );
    await writeFile(
      helper,
      `#!/bin/sh\n[ "$1" = raw ] || exit 2\nprintf '{"kind":"raw"}\\n'\nexec cat '${rendition}'\n`,
      { flag: 'wx', mode: 0o755 },
    );
    await writeFile(
      shot,
      await sharp()({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
        .tiff()
        .toBuffer(),
      { flag: 'wx' },
    );
    const output = await render(
      {
        kind: 'layout',
        format: 'png',
        dpi: 72,
        pages: [
          {
            width: 300,
            height: 200,
            items: [{ kind: 'image', source: 0, frame: { x: 0, y: 0, width: 300, height: 200 } }],
          },
        ],
      },
      [shot],
      path.join(root, 'Shot.png'),
      { tools: { ...decoding, decoders: { ...decoders, raw: helper } } },
    );
    const { data } = await sharp()(output)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(near(at({ width: 300, data }, 150, 100, 3), blue, 24)).toBe(true);
    console.warn('Retained RAW routing:', root);
  },
);

it.skipIf(!ready || !holds(rawSample))(
  'lays out a camera RAW original rendered by the bundled LibRaw helper',
  async () => {
    const root = await temporaryRoot('viewer-layout-raw-');
    const shot = path.join(root, 'Sony.ARW');
    await placePinned(rawSample, shot);
    const output = await render(
      {
        kind: 'layout',
        format: 'pdf',
        dpi: 300,
        pages: [
          {
            width: 400,
            height: 300,
            items: [{ kind: 'image', source: 0, frame: { x: 50, y: 50, width: 300, height: 200 } }],
          },
        ],
      },
      [shot],
      path.join(root, 'Sony.pdf'),
      { tools: decoding },
    );
    await checked(output);
    const images = imagesIn(await objects(output));
    expect(images).toHaveLength(1);
    // 300 points at 300 dpi keep 1,250 pixels of the 3,012 LibRaw renders.
    expect(images[0]).toMatchObject({ '/Filter': '/DCTDecode', '/Width': 1250 });
    const pixels = (await readPDF(output, true)).pages[0]!.pixels!;
    expect(near(at(pixels, 200, 150), white, 8)).toBe(false);
    expect(near(at(pixels, 20, 20), white, 8)).toBe(true);
    console.warn('Retained RAW layout:', root);
  },
);
