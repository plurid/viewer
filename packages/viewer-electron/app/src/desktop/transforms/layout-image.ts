/**
 * The pixel work of a layout, done with sharp inside the image utility process: pictures for a
 * PDF, text WinAnsi cannot hold, and a whole PNG or JPEG page painted onto one canvas. A session
 * keeps that canvas between requests, so each source image crosses the process boundary once.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflate } from 'node:zlib';
import type { LayoutItem } from '../../domain/layout/plan';
import { jpegFrame } from './pdf';
import { plainText } from './layout-text';
import type { TextItem } from './layout-text';

type ImageItem = Extract<LayoutItem, { kind: 'image' }>;
type RectItem = Extract<LayoutItem, { kind: 'rect' }>;
type PathItem = Extract<LayoutItem, { kind: 'path' }>;
/** What a canvas draws between images: shapes and lines of text. */
export type LayoutMark = RectItem | PathItem | TextItem;
type Crop = ImageItem['crop'];
type Rotation = ImageItem['rotate'];
interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Metadata {
  format?: string;
  compression?: string;
  width?: number;
  height?: number;
  orientation?: number;
  hasAlpha?: boolean;
  space?: string;
  channels?: number;
  depth?: string;
  icc?: Buffer;
}
interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Raw {
  data: Buffer;
  info: { width: number; height: number; channels: number };
}
interface Pipeline {
  metadata(): Promise<Metadata>;
  autoOrient(): Pipeline;
  rotate(angle: number): Pipeline;
  extract(region: Region): Pipeline;
  resize(width: number, height: number, options: { fit: 'fill' }): Pipeline;
  toColourspace(space: 'srgb' | 'b-w'): Pipeline;
  ensureAlpha(): Pipeline;
  removeAlpha(): Pipeline;
  extractChannel(channel: number): Pipeline;
  raw(options?: { depth: 'uchar' }): Pipeline;
  jpeg(options: { quality: number; optimiseCoding: boolean }): Pipeline;
  png(options: { compressionLevel: number; adaptiveFiltering: boolean }): Pipeline;
  withIccProfile(name: 'srgb'): Pipeline;
  withDensity(density: number): Pipeline;
  toBuffer(): Promise<Buffer>;
  toBuffer(options: { resolveWithObject: true }): Promise<Raw>;
}
type Sharp = ((
  input: Buffer,
  options?: {
    limitInputPixels?: number | false;
    failOn?: 'none' | 'truncated' | 'error' | 'warning';
    raw?: { width: number; height: number; channels: 1 | 3 | 4 };
  },
) => Pipeline) & { cache(enabled: boolean): void };

/** An image item's pixels for a PDF page. */
export interface PictureRequest {
  kind: 'picture';
  bytes: Uint8Array;
  rotate: Rotation;
  crop: Crop;
  /** The most pixels the frame keeps at the plan's resolution. */
  most: { width: number; height: number };
  quality: number;
}
export interface Picture {
  filter: 'jpeg' | 'flate';
  /** JPEG data, or deflated 8-bit samples. */
  data: Uint8Array;
  /** Deflated 8-bit opacity, when the picture has any. */
  alpha?: Uint8Array;
  width: number;
  height: number;
  components: 1 | 3;
  icc?: Uint8Array;
  /** Set when `data` is the source's own JPEG, drawn through its orientation, rotation and crop.
   * Otherwise the picture is the cropped frame's content, upright. */
  orientation?: number;
}
/** Lines of text as opacity masks, `scale` pixels to the point. */
export interface TextRequest {
  kind: 'text';
  items: TextItem[];
  scale: number;
}
/** A line's inked pixels on the page's pixel grid. `text` is what was drawn, after shortening. */
export interface TextMask extends Region {
  text: string;
  scale: number;
  mask: Uint8Array;
}
export interface CanvasRequest {
  kind: 'canvas';
  width: number;
  height: number;
  /** Pixels to the point. */
  scale: number;
  /** Transparent when absent. */
  background?: string;
}
export interface CanvasImageRequest {
  kind: 'canvas-image';
  bytes: Uint8Array;
  rotate: Rotation;
  crop: Crop;
  frame: Frame;
}
export interface CanvasMarksRequest {
  kind: 'canvas-marks';
  items: LayoutMark[];
}
export interface CanvasEndRequest {
  kind: 'canvas-end';
  format: 'png' | 'jpeg';
  quality: number;
  dpi: number;
}
export type LayoutImageRequest =
  | PictureRequest
  | TextRequest
  | CanvasRequest
  | CanvasImageRequest
  | CanvasMarksRequest
  | CanvasEndRequest;
export interface LayoutImageReplies {
  picture: Picture;
  text: (TextMask | null)[];
  canvas: null;
  'canvas-image': null;
  'canvas-marks': null;
  'canvas-end': Uint8Array;
}
export type LayoutImageReply<Request extends LayoutImageRequest = LayoutImageRequest> =
  LayoutImageReplies[Request['kind']];
/** One layout's pixel work: requests run in order, and `close` ends the session. */
export interface LayoutImaging {
  run<Request extends LayoutImageRequest>(
    request: Request,
    signal: AbortSignal,
  ): Promise<LayoutImageReply<Request>>;
  close(): void;
}

const pixelLimit = 100_000_000;
/** Cairo draws surfaces up to 32,767 pixels a side. */
const surfaceSide = 32_767;
const rasterFormats = ['jpeg', 'png', 'gif', 'webp', 'tiff', 'heif'];
const compress = promisify(deflate);

const load = (root: string) => {
  // Production workers are CommonJS: resolve from the processor root, as image.ts does.
  const sharp = createRequire(path.join(root, 'image-loader.cjs'))(
    path.join(root, 'node_modules/sharp'),
  ) as Sharp;
  // A session decodes hundreds of different images; a cache would only hold memory.
  sharp.cache(false);
  return sharp;
};
const buffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
const rgb = (color: string) => [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));

/** A source image's upright size after its rotation, and its crop in those pixels. */
async function geometry(image: Pipeline, rotate: Rotation, crop: Crop) {
  const metadata = await image.metadata();
  if (!rasterFormats.includes(metadata.format ?? '') || !metadata.width || !metadata.height)
    throw new Error('This image format cannot be laid out.');
  if (metadata.format === 'heif' && metadata.compression !== 'av1')
    throw new Error('HEIC images cannot be laid out yet. Convert them to JPEG first.');
  const orientation =
    metadata.orientation && metadata.orientation <= 8 ? Math.max(1, metadata.orientation) : 1;
  const turned = orientation >= 5 !== (rotate % 180 !== 0);
  const width = turned ? metadata.height : metadata.width,
    height = turned ? metadata.width : metadata.height;
  const left = Math.min(width - 1, Math.round(crop.x * width)),
    top = Math.min(height - 1, Math.round(crop.y * height));
  const right = Math.max(left + 1, Math.min(width, Math.round((crop.x + crop.width) * width))),
    bottom = Math.max(top + 1, Math.min(height, Math.round((crop.y + crop.height) * height)));
  return {
    metadata,
    orientation,
    width,
    height,
    crop: { left, top, width: right - left, height: bottom - top },
  };
}
type Geometry = Awaited<ReturnType<typeof geometry>>;

/** The crop of an upright image at `size` pixels. Shrinking resizes the whole image first, so
 * a JPEG decodes at a fraction of its size; enlarging crops first. `visible` keeps a part of it. */
function fitted(image: Pipeline, source: Geometry, size: Region, visible: Region): Pipeline {
  const { crop } = source;
  if (crop.width >= size.width && crop.height >= size.height) {
    const width = Math.max(size.width, Math.round((source.width * size.width) / crop.width)),
      height = Math.max(size.height, Math.round((source.height * size.height) / crop.height));
    const left = Math.min(width - size.width, Math.round((crop.left * width) / source.width)),
      top = Math.min(height - size.height, Math.round((crop.top * height) / source.height));
    return image.resize(width, height, { fit: 'fill' }).extract({
      left: left + visible.left,
      top: top + visible.top,
      width: visible.width,
      height: visible.height,
    });
  }
  const whole = visible.width === size.width && visible.height === size.height;
  const resized = image.extract(crop).resize(size.width, size.height, { fit: 'fill' });
  return whole ? resized : resized.extract(visible);
}

/** A JPEG for a PDF's DCTDecode: the first image's coded data, with APP0 and the Adobe marker
 * that names its colour transform. EXIF, XMP, comments and any further images are left out. */
export function pdfJPEG(input: Buffer): Buffer | undefined {
  const chunks: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;
  while (offset + 2 <= input.length) {
    const start = offset;
    if (input[offset++] !== 0xff) return undefined;
    while (input[offset] === 0xff) offset++;
    const marker = input[offset++]!;
    if (marker === 0xd9) return Buffer.concat([...chunks, Buffer.from([0xff, 0xd9])]);
    if (offset + 2 > input.length) return undefined;
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) return undefined;
    offset += length;
    if (marker <= 0xe0 || marker === 0xee) chunks.push(input.subarray(start, offset));
    if (marker !== 0xda) continue;
    // Coded data runs to the next marker that is neither a stuffed 0xff nor a restart.
    const data = offset;
    while (
      offset + 1 < input.length &&
      !(
        input[offset] === 0xff &&
        input[offset + 1] !== 0 &&
        input[offset + 1] !== 0xff &&
        (input[offset + 1]! < 0xd0 || input[offset + 1]! > 0xd7)
      )
    )
      offset++;
    chunks.push(input.subarray(data, offset));
  }
  return undefined;
}

/** An embedded profile a PDF can name for `components` colour channels. */
function profile(icc: Buffer | undefined, components: 1 | 3): Uint8Array | undefined {
  if (!icc || icc.length < 132) return undefined;
  return icc.toString('latin1', 16, 20) === (components === 1 ? 'GRAY' : 'RGB ') ? icc : undefined;
}

async function picture(sharp: Sharp, request: PictureRequest): Promise<Picture> {
  const input = buffer(request.bytes);
  const open = () => sharp(input, { limitInputPixels: pixelLimit, failOn: 'error' });
  const source = await geometry(open(), request.rotate, request.crop);
  const { metadata, crop } = source;
  const size = {
    left: 0,
    top: 0,
    width: Math.min(crop.width, Math.max(1, request.most.width)),
    height: Math.min(crop.height, Math.max(1, request.most.height)),
  };
  const kept = size.width === crop.width && size.height === crop.height;
  if (kept && metadata.format === 'jpeg' && metadata.depth === 'uchar' && !metadata.hasAlpha) {
    const components =
      metadata.channels === 1 && metadata.space === 'b-w'
        ? 1
        : metadata.channels === 3 && metadata.space === 'srgb'
          ? 3
          : undefined;
    const frame = components && jpegFrame(input);
    const data =
      frame &&
      frame.components === components &&
      frame.width === metadata.width &&
      frame.height === metadata.height
        ? pdfJPEG(input)
        : undefined;
    if (components && data)
      return {
        filter: 'jpeg',
        data,
        width: metadata.width!,
        height: metadata.height!,
        components,
        icc: profile(metadata.icc, components),
        orientation: source.orientation,
      };
  }
  let image = open().autoOrient();
  if (request.rotate) image = image.rotate(request.rotate);
  image = fitted(image, source, size, size);
  if (metadata.hasAlpha) {
    const { data, info } = await image
      .toColourspace('srgb')
      .ensureAlpha()
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    const colour = Buffer.alloc(pixels * 3),
      alpha = Buffer.alloc(pixels);
    let opaque = true;
    for (let index = 0; index < pixels; index++) {
      colour[index * 3] = data[index * 4]!;
      colour[index * 3 + 1] = data[index * 4 + 1]!;
      colour[index * 3 + 2] = data[index * 4 + 2]!;
      alpha[index] = data[index * 4 + 3]!;
      if (alpha[index] !== 255) opaque = false;
    }
    if (!opaque)
      return {
        filter: 'flate',
        data: await compress(colour),
        alpha: await compress(alpha),
        width: info.width,
        height: info.height,
        components: 3,
      };
    image = sharp(colour, { raw: { width: info.width, height: info.height, channels: 3 } });
  }
  const gray = metadata.space === 'b-w' && !metadata.hasAlpha;
  const { data, info } = await image
    .toColourspace(gray ? 'b-w' : 'srgb')
    .jpeg({ quality: request.quality, optimiseCoding: true })
    .toBuffer({ resolveWithObject: true });
  return {
    filter: 'jpeg',
    data,
    width: info.width,
    height: info.height,
    components: gray ? 1 : 3,
  };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);
const entities: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escape = (text: string) => text.replace(/[&<>]/g, (character) => entities[character]!);
const anchors = { start: 'start', center: 'middle', end: 'end' } as const;
/** Room a line needs before it is measured: a wide character takes about an em. */
const room = (text: string, size: number) =>
  graphemes(text).reduce((total, part) => total + (part.codePointAt(0)! >= 0x1100 ? 1.1 : 0.7), 1) *
  size;

/**
 * The inked pixels of one line drawn in the system sans-serif, on the page grid at `scale`, inside
 * `bounds` when given. The drawing area grows until the ink stops at its sides; without bounds, a
 * line too wide for one surface is drawn at a lower scale, which the result carries.
 */
async function ink(
  sharp: Sharp,
  item: TextItem,
  text: string,
  scale: number,
  bounds?: Region,
): Promise<Region & { mask: Buffer; scale: number }> {
  const empty = { left: 0, top: 0, width: 0, height: 0, mask: Buffer.alloc(0), scale };
  let width = room(text, item.size);
  for (let attempt = 0; ; attempt++) {
    const before = item.align === 'start' ? item.size : item.align === 'center' ? width / 2 : width,
      after = item.align === 'end' ? item.size : item.align === 'center' ? width / 2 : width;
    if (!bounds) scale = Math.min(scale, (surfaceSide - 2) / (before + after));
    const area = {
      left: Math.floor((item.x - before) * scale),
      top: Math.floor((item.y - 1.6 * item.size) * scale),
      right: Math.ceil((item.x + after) * scale),
      bottom: Math.ceil((item.y + 0.8 * item.size) * scale),
    };
    const clipped = {
      left: Math.max(area.left, bounds?.left ?? -Infinity),
      top: Math.max(area.top, bounds?.top ?? -Infinity),
      right: Math.min(area.right, bounds ? bounds.left + bounds.width : Infinity),
      bottom: Math.min(area.bottom, bounds ? bounds.top + bounds.height : Infinity),
    };
    // Past a surface's limit the line is clipped around its anchor.
    const anchor = Math.round(item.x * scale);
    if (clipped.right - clipped.left > surfaceSide) {
      clipped.left = Math.max(clipped.left, anchor - surfaceSide / 2);
      clipped.right = Math.min(clipped.right, clipped.left + surfaceSide);
    }
    clipped.bottom = Math.min(clipped.bottom, clipped.top + surfaceSide);
    const pixels = {
      width: clipped.right - clipped.left,
      height: clipped.bottom - clipped.top,
    };
    if (pixels.width <= 0 || pixels.height <= 0) return empty;
    const view = [clipped.left, clipped.top, pixels.width, pixels.height].map(
      (value) => value / scale,
    );
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels.width}" height="${pixels.height}" ` +
      `viewBox="${view.join(' ')}"><text x="${item.x}" y="${item.y}" xml:space="preserve" ` +
      `font-family="sans-serif" font-size="${item.size}" ` +
      `font-weight="${item.weight === 'bold' ? 'bold' : 'normal'}" ` +
      `text-anchor="${anchors[item.align]}">${escape(text)}</text></svg>`;
    const alpha = await sharp(Buffer.from(svg), { limitInputPixels: false })
      .ensureAlpha()
      .extractChannel(3)
      .raw({ depth: 'uchar' })
      .toBuffer();
    let left = pixels.width,
      right = -1,
      top = pixels.height,
      bottom = -1;
    for (let y = 0; y < pixels.height; y++)
      for (let x = 0, row = y * pixels.width; x < pixels.width; x++)
        if (alpha[row + x]) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          bottom = y;
        }
    if (right < 0) return empty;
    const touches =
      (left === 0 && clipped.left === area.left) ||
      (right === pixels.width - 1 && clipped.right === area.right);
    if (touches && attempt < 3) {
      width *= 2;
      continue;
    }
    const inked = { width: right - left + 1, height: bottom - top + 1 };
    const mask = Buffer.alloc(inked.width * inked.height);
    for (let y = 0; y < inked.height; y++)
      alpha.copy(
        mask,
        y * inked.width,
        (top + y) * pixels.width + left,
        (top + y) * pixels.width + right + 1,
      );
    return { left: clipped.left + left, top: clipped.top + top, ...inked, mask, scale };
  }
}

/** A line shortened with an ellipsis to fit its `maxWidth`, measured at a low resolution. */
async function textMask(
  sharp: Sharp,
  item: TextItem,
  scale: number,
  bounds?: Region,
): Promise<TextMask | null> {
  const text = plainText(item.text);
  const whole = await ink(sharp, item, text, scale, bounds);
  if (item.maxWidth === undefined || whole.width / whole.scale <= item.maxWidth + 1 / whole.scale)
    return whole.width ? { ...whole, text } : null;
  const parts = graphemes(text);
  const measure = Math.min(scale, 32 / item.size);
  const shortened = (count: number) => parts.slice(0, count).join('').trimEnd() + '…';
  const fits = async (count: number) => {
    const drawn = await ink(sharp, item, shortened(count), measure);
    return drawn.width / drawn.scale <= item.maxWidth!;
  };
  if (!(await fits(0))) return null;
  let low = 0,
    high = parts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (await fits(middle)) low = middle;
    else high = middle - 1;
  }
  const value = shortened(low);
  const drawn = await ink(sharp, item, value, scale, bounds);
  return drawn.width ? { ...drawn, text: value } : null;
}

interface Canvas {
  width: number;
  height: number;
  scale: number;
  pixels: Buffer;
}
/** Paints straight-alpha RGBA `layer` over the canvas at `left`, `top`. */
function paint(canvas: Canvas, layer: Region, rgba: Buffer) {
  const { pixels } = canvas;
  for (let y = 0; y < layer.height; y++) {
    let target = ((layer.top + y) * canvas.width + layer.left) * 4,
      source = y * layer.width * 4;
    for (let x = 0; x < layer.width; x++, target += 4, source += 4) {
      const alpha = rgba[source + 3]!;
      if (alpha === 0) continue;
      if (alpha === 255) {
        rgba.copy(pixels, target, source, source + 4);
        continue;
      }
      const below = (pixels[target + 3]! * (255 - alpha)) / 255,
        total = alpha + below;
      for (let channel = 0; channel < 3; channel++)
        pixels[target + channel] = Math.round(
          (rgba[source + channel]! * alpha + pixels[target + channel]! * below) / total,
        );
      pixels[target + 3] = Math.round(total);
    }
  }
}
/** The part of a region on the canvas, or undefined when none is. */
function onCanvas(canvas: Canvas, region: Region): Region | undefined {
  const left = Math.max(0, region.left),
    top = Math.max(0, region.top);
  const right = Math.min(canvas.width, region.left + region.width),
    bottom = Math.min(canvas.height, region.top + region.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : undefined;
}

const number = (value: number) => String(Math.round(value * 1000) / 1000);
/** Shapes in one SVG cut to their bounds on the canvas; a 0 line width draws one pixel. */
function shapes(canvas: Canvas, items: (RectItem | PathItem)[]) {
  const scale = canvas.scale;
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const elements: string[] = [];
  for (const item of items) {
    if (!item.fill && !item.stroke) continue;
    const line = Math.max(item.lineWidth, 1 / scale);
    // A miter can reach five line widths past a corner at PDF's limit of 10.
    const margin = (item.stroke ? 5 * line : 0) + 2 / scale;
    const style =
      `fill="${item.fill ?? 'none'}" stroke="${item.stroke ?? 'none'}" ` +
      `stroke-width="${number(line)}" stroke-miterlimit="10"`;
    let xs: number[], ys: number[];
    if (item.kind === 'rect') {
      const { x, y, width, height } = item.frame;
      xs = [x, x + width];
      ys = [y, y + height];
      elements.push(
        `<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" ` +
          `height="${number(height)}" ${style}/>`,
      );
    } else {
      xs = item.points.filter((_, index) => index % 2 === 0);
      ys = item.points.filter((_, index) => index % 2 === 1);
      const steps = xs.map((x, index) => `${index ? 'L' : 'M'}${number(x)} ${number(ys[index]!)}`);
      const dash = item.dash && item.dash[0] + item.dash[1] > 0 ? item.dash : undefined;
      elements.push(
        `<path d="${steps.join(' ')}${item.closed ? ' Z' : ''}" ${style}` +
          (dash ? ` stroke-dasharray="${number(dash[0])} ${number(dash[1])}"` : '') +
          '/>',
      );
    }
    bounds.left = Math.min(bounds.left, Math.min(...xs) - margin);
    bounds.top = Math.min(bounds.top, Math.min(...ys) - margin);
    bounds.right = Math.max(bounds.right, Math.max(...xs) + margin);
    bounds.bottom = Math.max(bounds.bottom, Math.max(...ys) + margin);
  }
  if (!elements.length) return undefined;
  const left = Math.floor(bounds.left * scale),
    top = Math.floor(bounds.top * scale);
  const region = onCanvas(canvas, {
    left,
    top,
    width: Math.ceil(bounds.right * scale) - left,
    height: Math.ceil(bounds.bottom * scale) - top,
  });
  if (!region) return undefined;
  const view = [region.left, region.top, region.width, region.height].map((value) => value / scale);
  return {
    region,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${region.width}" height="${region.height}" ` +
      `viewBox="${view.join(' ')}">${elements.join('')}</svg>`,
  };
}

/** Requests for one layout, run in order. The canvas lives until `canvas-end` encodes it. */
export function layoutImageSession(root: string) {
  const sharp = load(root);
  let canvas: Canvas | undefined;
  const painting = () => {
    if (!canvas) throw new Error('The layout canvas is not ready.');
    return canvas;
  };
  const marks = async (items: LayoutMark[]) => {
    const target = painting();
    const bounds = { left: 0, top: 0, width: target.width, height: target.height };
    for (let index = 0; index < items.length;) {
      const item = items[index]!;
      if (item.kind === 'text') {
        index++;
        const mask = await textMask(sharp, item, target.scale, bounds);
        if (!mask) continue;
        const [red = 0, green = 0, blue = 0] = rgb(item.color);
        const rgba = Buffer.alloc(mask.width * mask.height * 4);
        for (let at = 0; at < mask.mask.length; at++) {
          rgba[at * 4] = red;
          rgba[at * 4 + 1] = green;
          rgba[at * 4 + 2] = blue;
          rgba[at * 4 + 3] = mask.mask[at]!;
        }
        paint(target, mask, rgba);
        continue;
      }
      const group: (RectItem | PathItem)[] = [];
      while (index < items.length && items[index]!.kind !== 'text')
        group.push(items[index++] as RectItem | PathItem);
      const drawn = shapes(target, group);
      if (!drawn) continue;
      const rgba = await sharp(Buffer.from(drawn.svg), { limitInputPixels: false })
        .ensureAlpha()
        .raw({ depth: 'uchar' })
        .toBuffer();
      paint(target, drawn.region, rgba);
    }
  };
  const run = async (request: LayoutImageRequest): Promise<LayoutImageReply> => {
    switch (request.kind) {
      case 'picture':
        return picture(sharp, request);
      case 'text': {
        const masks: (TextMask | null)[] = [];
        for (const item of request.items) masks.push(await textMask(sharp, item, request.scale));
        return masks;
      }
      case 'canvas': {
        if (request.width * request.height > pixelLimit)
          throw new Error('Choose a lower resolution: the image would exceed 100 megapixels.');
        const pixels = Buffer.alloc(request.width * request.height * 4);
        if (request.background) {
          const colour = Buffer.from([...rgb(request.background), 255]);
          for (let at = 0; at < pixels.length; at += 4) colour.copy(pixels, at);
        }
        canvas = { width: request.width, height: request.height, scale: request.scale, pixels };
        return null;
      }
      case 'canvas-image': {
        const target = painting();
        const { frame } = request;
        const left = Math.round(frame.x * target.scale),
          top = Math.round(frame.y * target.scale);
        const size = {
          left: 0,
          top: 0,
          width: Math.round((frame.x + frame.width) * target.scale) - left,
          height: Math.round((frame.y + frame.height) * target.scale) - top,
        };
        if (size.width <= 0 || size.height <= 0) return null;
        const visible = onCanvas(target, { left, top, width: size.width, height: size.height });
        if (!visible) return null;
        const input = buffer(request.bytes);
        const open = () => sharp(input, { limitInputPixels: pixelLimit, failOn: 'error' });
        const source = await geometry(open(), request.rotate, request.crop);
        let image = open().autoOrient();
        if (request.rotate) image = image.rotate(request.rotate);
        const { data } = await fitted(image, source, size, {
          ...visible,
          left: visible.left - left,
          top: visible.top - top,
        })
          .toColourspace('srgb')
          .ensureAlpha()
          .raw({ depth: 'uchar' })
          .toBuffer({ resolveWithObject: true });
        paint(target, visible, data);
        return null;
      }
      case 'canvas-marks':
        await marks(request.items);
        return null;
      case 'canvas-end': {
        const target = painting();
        canvas = undefined;
        let opaque = true;
        for (let at = 3; at < target.pixels.length && opaque; at += 4)
          opaque = target.pixels[at] === 255;
        let image = sharp(target.pixels, {
          limitInputPixels: false,
          raw: { width: target.width, height: target.height, channels: 4 },
        });
        if (opaque || request.format === 'jpeg') image = image.removeAlpha();
        image = image.withIccProfile('srgb').withDensity(request.dpi);
        return request.format === 'jpeg'
          ? image.jpeg({ quality: request.quality, optimiseCoding: true }).toBuffer()
          : image.png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
      }
    }
  };
  return run;
}

/** Layout pixel work in this process, for tests and tools. The app runs it in the image utility
 * process, which a cancellation ends (image-process.ts). */
export function layoutImagingInProcess(root: string): LayoutImaging {
  let session: ReturnType<typeof layoutImageSession> | undefined;
  return {
    async run<Request extends LayoutImageRequest>(request: Request, signal: AbortSignal) {
      signal.throwIfAborted();
      session ??= layoutImageSession(root);
      const value = await session(request);
      signal.throwIfAborted();
      return value as LayoutImageReply<Request>;
    },
    close() {
      session = undefined;
    },
  };
}
