import type { Resource, ResourceRead } from '../../contracts';
import { previewTextLimit } from '../../files/read-limits';

export const postscriptFormats = ['ps', 'eps', 'epsf', 'epsi', 'ai'] as const;
export type PostScriptKind = 'PostScript document' | 'Encapsulated PostScript' | 'Illustrator';
export type GhostscriptStatus =
  { kind: 'found' } | { kind: 'missing' } | { kind: 'store' } | { kind: 'failed' };
export type EPSCrop = 'drawing' | 'page';
export const epsCropMaximumPoints = 14_400;
export const epsCropMessage =
  "The drawing's bounding box could not be used; rendering uses the full page.";
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
  previewMessage?: string;
  epsCrop?: EPSCrop;
}
export interface EPSIBitmap {
  width: number;
  height: number;
  depth: number;
  bytes: Uint8Array;
}
export class EPSIPreviewLimitError extends Error {}
const invalid = () => new Error('This PostScript file is malformed; its bytes are shown below.');
const starts = (bytes: Uint8Array, text: string) =>
  bytes.length >= text.length &&
  [...text].every((value, index) => bytes[index] === value.charCodeAt(0));

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

export const postscriptLineLimit = 65_536;

interface LineScan {
  limited: boolean;
  truncated: boolean;
}

/** Only comments allocate strings; an empty-line flood stops at the shared line budget. */
function* commentLines(bytes: Uint8Array, scan: LineScan): Generator<string> {
  const length = Math.min(bytes.length, previewTextLimit);
  let count = 0;
  for (let start = 0; start < length;) {
    if (++count > postscriptLineLimit) {
      scan.limited = true;
      return;
    }
    let end = start;
    while (end < length && bytes[end] !== 10 && bytes[end] !== 13) end++;
    const next = end + (bytes[end] === 13 && bytes[end + 1] === 10 ? 2 : 1);
    if (bytes[start] === 37 && end - start <= 4096 && (end < length || !scan.truncated)) {
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

function metadataComment(result: PostScriptMetadata, line: string): void {
  const comment = /^%%([A-Za-z]+):\s*(.*)$/.exec(line);
  if (!comment) return;
  const key = comment[1]!;
  const value = comment[2]!.trim();
  if (!value || value === '(atend)' || value.length > 1024) return;
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
  if (
    (key === 'BoundingBox' || key === 'HiResBoundingBox' || key === 'PageBoundingBox') &&
    (!result.size || (result.size.kind === 'Bounding box' && key === 'HiResBoundingBox'))
  ) {
    const box = numbers(value, 4);
    if (box && box[2]! > box[0]! && box[3]! > box[1]!)
      result.size = { width: box[2]! - box[0]!, height: box[3]! - box[1]!, kind: 'Bounding box' };
  }
}

interface BitmapScan {
  bitmap?: EPSIBitmap;
  rows: number;
  expected: number;
  digits: number;
  ended: boolean;
  error?: Error;
}
function beginBitmap(line: string): BitmapScan {
  const result: BitmapScan = { rows: 0, expected: 0, digits: 0, ended: false };
  const fields = numbers(line.slice('%%BeginPreview:'.length), 4);
  if (!fields || fields.some((field) => !Number.isInteger(field)))
    return { ...result, error: invalid() };
  const [width = 0, height = 0, depth = 0, count = 0] = fields;
  const stride = Math.ceil((width * depth) / 8);
  if (width < 1 || height < 1 || ![1, 2, 4, 8].includes(depth) || count < 1)
    return { ...result, error: invalid() };
  if (width * height > 16_000_000 || count > 100_000 || stride * height > previewTextLimit)
    return {
      ...result,
      error: new EPSIPreviewLimitError('The embedded EPSI picture exceeds the preview limits.'),
    };
  return {
    ...result,
    expected: count,
    bitmap: { width, height, depth, bytes: new Uint8Array(stride * height) },
  };
}
function bitmapLine(scan: BitmapScan, line: string): void {
  if (line.trimEnd() === '%%EndPreview') {
    scan.ended = true;
    if (!scan.bitmap || scan.rows !== scan.expected || scan.digits !== scan.bitmap.bytes.length * 2)
      scan.error ??= invalid();
    return;
  }
  scan.rows++;
  if (scan.error) return;
  if (!/^%[\s0-9a-fA-F]*$/.test(line) || scan.rows > scan.expected) {
    scan.error = invalid();
    return;
  }
  const data = scan.bitmap!.bytes;
  for (let index = 1; index < line.length; index++) {
    const code = line.charCodeAt(index);
    if (code === 32 || code === 9) continue;
    if (scan.digits >= data.length * 2) {
      scan.error = invalid();
      return;
    }
    const value = code >= 97 ? code - 87 : code >= 65 ? code - 55 : code - 48;
    data[scan.digits >> 1] = (data[scan.digits >> 1] ?? 0) | (scan.digits % 2 ? value : value << 4);
    scan.digits++;
  }
}

/** Metadata and the optional bitmap share one scan, so selection cannot double the line work. */
function scanComments(bytes: Uint8Array, truncated = false) {
  const state: LineScan = { limited: bytes.length > previewTextLimit, truncated };
  const metadata: PostScriptMetadata = {};
  let nested = 0;
  let picture: BitmapScan | undefined;
  let boxSeen = false;
  let boxUsable = true;
  let trailer = false;
  for (const line of commentLines(bytes, state)) {
    if (/^%%Begin(?:Document|Resource|File)(?::|\s|$)/.test(line)) {
      nested++;
      continue;
    }
    if (/^%%End(?:Document|Resource|File)(?:\s|$)/.test(line)) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (/^%%Begin(?:Binary|Data):/.test(line)) break;
    if (nested) continue;
    if (line === '%%Trailer') trailer = true;
    const boxComment = !trailer && /^%%(?:HiRes)?BoundingBox:\s*(.*)$/.exec(line);
    if (boxComment) {
      boxSeen = true;
      const box = numbers(boxComment[1]!, 4);
      // A sub-point box can round to a zero-sized pdfwrite page; excessive dimensions stay uncropped.
      boxUsable &&=
        !!box &&
        [box[2]! - box[0]!, box[3]! - box[1]!].every(
          (dimension) => dimension >= 1 && dimension <= epsCropMaximumPoints,
        );
    }
    if (!picture && line.startsWith('%%BeginPreview:')) picture = beginBitmap(line);
    else if (picture && !picture.ended) bitmapLine(picture, line);
    metadataComment(metadata, line);
  }
  if (picture && !picture.ended)
    picture.error ??=
      truncated || state.limited
        ? new EPSIPreviewLimitError(
            'The embedded EPSI picture extends beyond the inspection limits.',
          )
        : invalid();
  return {
    metadata,
    limited: state.limited,
    bitmap: picture?.error ? undefined : picture?.bitmap,
    error: picture?.error,
    epsCrop: (boxSeen && boxUsable ? 'drawing' : 'page') as EPSCrop,
  };
}
export function postscriptMetadata(bytes: Uint8Array): PostScriptMetadata {
  return scanComments(bytes).metadata;
}
export function decodeEPSI(bytes: Uint8Array, truncated = false): EPSIBitmap | undefined {
  const result = scanComments(bytes, truncated);
  if (result.error) throw result.error;
  return result.bitmap;
}

/** Transport markers carry no PostScript instructions and are omitted only from interpreter input. */
export function postscriptOffset(bytes: Uint8Array): number {
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  while (offset < Math.min(bytes.length, 256) && [4, 9, 10, 12, 13, 32].includes(bytes[offset]!))
    offset++;
  return offset;
}
export function postscriptSignature(bytes: Uint8Array): boolean {
  const offset = postscriptOffset(bytes);
  return (
    bytes[offset] === 37 &&
    bytes[offset + 1] === 33 &&
    ((bytes[offset + 2] === 80 && bytes[offset + 3] === 83) ||
      [9, 10, 11, 12, 13, 32].includes(bytes[offset + 2]!))
  );
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
  const sourceStride = Math.ceil((width * depth) / 8);
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const pixel = (bytes[y * sourceStride + (bit >> 3)]! >> (8 - depth - (bit % 8))) & mask;
      output[offset + (height - 1 - y) * stride + x] = 255 - Math.round((pixel * 255) / mask);
    }
  }
  return output;
}

export function postscriptContent(
  bytes: Uint8Array,
  extension: string,
  truncated = false,
  binary = false,
) {
  const illustrator = extension.toLowerCase() === 'ai';
  const pdf = illustrator && starts(bytes, '%PDF');
  const offset = postscriptOffset(bytes);
  const named = postscriptFormats.some((format) => format === extension.toLowerCase());
  const readable =
    bytes.length > offset &&
    bytes
      .subarray(offset, offset + 512)
      .every(
        (value) =>
          value === 9 ||
          value === 10 ||
          value === 12 ||
          value === 13 ||
          (value >= 32 && value < 127),
      );
  if (
    !pdf &&
    (starts(bytes, '%PDF') ||
      (!postscriptSignature(bytes) && !(named && (bytes[offset] === 37 || readable))))
  )
    throw invalid();
  const first =
    new TextDecoder().decode(bytes.subarray(offset, offset + 256)).split(/[\r\n]/)[0] ?? '';
  const comments = pdf
    ? { metadata: {}, limited: false, bitmap: undefined, error: undefined, epsCrop: undefined }
    : scanComments(bytes, truncated);
  const encapsulated = binary || /EPSF-/.test(first) || /^eps[fi]?$/.test(extension.toLowerCase());
  const document: Omit<PostScriptInspection, 'preview' | 'wmf'> = {
    kind: illustrator
      ? 'Illustrator'
      : encapsulated
        ? 'Encapsulated PostScript'
        : 'PostScript document',
    pdf,
    metadata: comments.metadata,
    source: { text: pdf ? '' : new TextDecoder().decode(bytes), binary: false, truncated },
    limited: truncated || comments.limited,
    epsCrop: encapsulated && !pdf ? comments.epsCrop : undefined,
    previewMessage: comments.error
      ? comments.error instanceof EPSIPreviewLimitError
        ? comments.error.message
        : 'The embedded EPSI picture could not be read.'
      : undefined,
  };
  return { document, bitmap: comments.bitmap };
}
export function inspectPostScript(
  bytes: Uint8Array,
  extension: string,
): Omit<PostScriptInspection, 'preview' | 'wmf'> {
  return postscriptContent(bytes, extension).document;
}
