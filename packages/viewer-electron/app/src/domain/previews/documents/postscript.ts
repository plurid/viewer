import type { Resource, ResourceRead } from '../../contracts';
import { previewTextLimit } from '../../files/read-limits';

export const postscriptFormats = ['ps', 'eps', 'epsf', 'epsi', 'ai'] as const;
export type PostScriptKind = 'PostScript document' | 'Encapsulated PostScript' | 'Illustrator';
export type GhostscriptStatus = { kind: 'found' } | { kind: 'missing' } | { kind: 'store' };
export interface ByteSection {
  offset: number;
  length: number;
}
export interface EPSHeader {
  postscript: ByteSection;
  tiff?: ByteSection;
  wmf?: ByteSection;
}
export interface PostScriptMetadata {
  title?: string;
  creator?: string;
  creationDate?: string;
  pages?: number;
  languageLevel?: number;
  size?: { width: number; height: number; kind: 'Page size' | 'Bounding box' };
}
export interface PostScriptInspection {
  kind: PostScriptKind;
  pdf: boolean;
  metadata: PostScriptMetadata;
  source: ResourceRead;
  preview?: Resource;
  wmf: boolean;
  limited: boolean;
}
export interface EPSIBitmap {
  width: number;
  height: number;
  depth: number;
  bytes: Uint8Array;
}
const invalid = () => new Error('This PostScript file is malformed; its bytes are shown below.');
const starts = (bytes: Uint8Array, text: string) =>
  bytes.length >= text.length && [...text].every((value, index) => bytes[index] === value.charCodeAt(0));

export const binaryEPS = (bytes: Uint8Array) =>
  bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6;

/** Validate all sections together before any caller allocates or reads one. */
export function epsHeader(bytes: Uint8Array, size: number): EPSHeader | undefined {
  if (!binaryEPS(bytes)) return undefined;
  if (bytes.length < 30 || !Number.isSafeInteger(size) || size < 30) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const section = (at: number, required = false): ByteSection | undefined => {
    const offset = view.getUint32(at, true);
    const length = view.getUint32(at + 4, true);
    if (!offset && !length && !required) return undefined;
    if (offset < 30 || !length || offset > size || length > size - offset) throw invalid();
    return { offset, length };
  };
  const postscript = section(4, true)!;
  const wmf = section(12);
  const tiff = section(20);
  const sections = [postscript, wmf, tiff].filter((value): value is ByteSection => !!value);
  sections.sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < sections.length; index++) {
    const previous = sections[index - 1]!;
    if (previous.offset + previous.length > sections[index]!.offset) throw invalid();
  }
  return { postscript, wmf, tiff };
}

/** DSC lines can contain arbitrary binary data. Only bounded printable comments are inspected. */
function* commentLines(bytes: Uint8Array): Generator<string> {
  const length = Math.min(bytes.length, previewTextLimit);
  for (let start = 0; start < length;) {
    let end = start;
    while (end < length && bytes[end] !== 10 && bytes[end] !== 13) end++;
    const next = end + (bytes[end] === 13 && bytes[end + 1] === 10 ? 2 : 1);
    if (end - start <= 4096 && (end < length || bytes.length < previewTextLimit)) {
      const line = bytes.subarray(start, end);
      if (line.every((value) => value === 9 || (value >= 32 && value <= 126)))
        yield String.fromCharCode(...line);
    }
    start = next;
  }
}

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function numbers(value: string, count: number): number[] | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== count || parts.some((part) => !decimal.test(part))) return undefined;
  const result = parts.map(Number);
  return result.every((part) => Number.isFinite(part) && Math.abs(part) <= 1_000_000)
    ? result
    : undefined;
}

export function postscriptMetadata(bytes: Uint8Array): PostScriptMetadata {
  const result: PostScriptMetadata = {};
  let nested = 0;
  let hires = false;
  for (const line of commentLines(bytes)) {
    if (/^%%Begin(?:Document|Resource|File)(?::|\s|$)/.test(line)) {
      nested++;
      continue;
    }
    if (/^%%End(?:Document|Resource|File)(?:\s|$)/.test(line)) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    // Binary/data blocks may contain forged comments. Metadata beyond them stays unknown.
    if (/^%%Begin(?:Binary|Data):/.test(line)) break;
    if (nested) continue;
    const comment = /^%%([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!comment) continue;
    const key = comment[1]!;
    const value = comment[2]!.trim();
    if (!value || value === '(atend)' || value.length > 1024) continue;
    if (key === 'Title') result.title ??= value;
    if (key === 'Creator') result.creator ??= value;
    if (key === 'CreationDate') result.creationDate ??= value;
    if (key === 'Pages' && /^\d+(?:\s+[+-]?\d+)?$/.test(value)) {
      const pages = Number(value.split(/\s+/)[0]);
      if (Number.isSafeInteger(pages) && pages <= 1_000_000) result.pages ??= pages;
    }
    if (key === 'LanguageLevel' && /^[123]$/.test(value)) result.languageLevel ??= Number(value);
    if (key === 'DocumentMedia' && !result.size) {
      const media = value.split(/\s+/);
      const size = numbers(media.slice(1, 3).join(' '), 2);
      if (size && size[0]! > 0 && size[1]! > 0)
        result.size = { width: size[0]!, height: size[1]!, kind: 'Page size' };
    }
    if ((key === 'BoundingBox' || key === 'HiResBoundingBox' || key === 'PageBoundingBox') &&
      (!result.size || (result.size.kind === 'Bounding box' && !hires))) {
      const box = numbers(value, 4);
      if (box && box[2]! > box[0]! && box[3]! > box[1]!) {
        result.size = { width: box[2]! - box[0]!, height: box[3]! - box[1]!, kind: 'Bounding box' };
        hires = key === 'HiResBoundingBox';
      }
    }
  }
  return result;
}

export function decodeEPSI(bytes: Uint8Array): EPSIBitmap | undefined {
  const lines = commentLines(bytes);
  let nested = 0;
  for (const line of lines) {
    if (/^%%Begin(?:Document|Resource|File)(?::|\s|$)/.test(line)) nested++;
    if (/^%%End(?:Document|Resource|File)(?:\s|$)/.test(line)) nested = Math.max(0, nested - 1);
    if (/^%%Begin(?:Binary|Data):/.test(line)) return undefined;
    if (nested || !line.startsWith('%%BeginPreview:')) continue;
    const fields = numbers(line.slice('%%BeginPreview:'.length), 4);
    if (!fields || fields.some((field) => !Number.isInteger(field))) throw invalid();
    const [width = 0, height = 0, depth = 0, count = 0] = fields;
    const stride = Math.ceil(width * depth / 8);
    if (width < 1 || height < 1 || width * height > 16_000_000 ||
      ![1, 2, 4, 8].includes(depth) || count < 1 || count > 100_000 ||
      stride * height > previewTextLimit) throw invalid();
    const data = new Uint8Array(stride * height);
    let digits = 0;
    for (let index = 0; index < count; index++) {
      const row = lines.next();
      if (row.done || !/^%[\s0-9a-fA-F]*$/.test(row.value)) throw invalid();
      for (const character of row.value.slice(1)) {
        if (/\s/.test(character)) continue;
        if (digits >= data.length * 2) throw invalid();
        const value = Number.parseInt(character, 16);
        data[digits >> 1] = (data[digits >> 1] ?? 0) | (digits % 2 ? value : value << 4);
        digits++;
      }
    }
    if (digits !== data.length * 2 || lines.next().value !== '%%EndPreview') throw invalid();
    return { width, height, depth, bytes: data };
  }
  return undefined;
}

/** The existing browser image viewer reads this grayscale BMP without running PostScript. */
export function epsiBMP(bitmap: EPSIBitmap): Uint8Array {
  const { width, height, depth, bytes } = bitmap;
  const stride = Math.ceil(width / 4) * 4;
  const offset = 14 + 40 + 256 * 4;
  const output = new Uint8Array(offset + stride * height);
  const view = new DataView(output.buffer);
  output.set([0x42, 0x4d]);
  view.setUint32(2, output.length, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  view.setUint32(46, 256, true);
  for (let gray = 0; gray < 256; gray++) output.fill(gray, 54 + gray * 4, 57 + gray * 4);
  const sourceStride = Math.ceil(width * depth / 8);
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const pixel = (bytes[y * sourceStride + (bit >> 3)]! >> (8 - depth - bit % 8)) & mask;
      output[offset + (height - 1 - y) * stride + x] = 255 - Math.round(pixel * 255 / mask);
    }
  }
  return output;
}

export function inspectPostScript(bytes: Uint8Array, extension: string):
  Omit<PostScriptInspection, 'preview' | 'wmf'> {
  const illustrator = extension.toLowerCase() === 'ai';
  const pdf = illustrator && starts(bytes, '%PDF');
  if (!pdf && !starts(bytes, '%!PS')) throw invalid();
  const first = new TextDecoder().decode(bytes.subarray(0, 256)).split(/[\r\n]/)[0] ?? '';
  return {
    kind: illustrator ? 'Illustrator' : /EPSF-/.test(first) || /^eps[fi]?$/.test(extension)
      ? 'Encapsulated PostScript' : 'PostScript document',
    pdf,
    metadata: pdf ? {} : postscriptMetadata(bytes),
    source: { text: pdf ? '' : new TextDecoder().decode(bytes), binary: false, truncated: false },
    limited: false,
  };
}
