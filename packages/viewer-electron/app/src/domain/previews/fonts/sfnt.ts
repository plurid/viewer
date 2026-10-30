/**
 * Font details from SFNT files (TrueType, OpenType and the first face of a collection) and WOFF.
 * Every offset, length and count comes from an untrusted file: each read is checked against the
 * bytes it addresses. WOFF2 tables use Brotli, which the renderer cannot decompress.
 */

/** The largest font file the preview reads. */
export const fontByteLimit = 32_000_000;
/** A WOFF table claiming more than this once decompressed is refused rather than allocated. */
const woffTableLimit = 8 * 1024 * 1024;
/** Characters kept from one name record: a copyright notice runs to a few hundred. */
const nameLimit = 1024;

export type FontFormat = 'truetype' | 'opentype' | 'collection' | 'woff' | 'woff2';

export const fontFormatLabels: Record<FontFormat, string> = {
  truetype: 'TrueType',
  opentype: 'OpenType (CFF)',
  collection: 'Font collection',
  woff: 'WOFF',
  woff2: 'WOFF2',
};

export interface FontNames {
  family?: string;
  style?: string;
  fullName?: string;
  version?: string;
  designer?: string;
  manufacturer?: string;
  copyright?: string;
}

export interface FontInfo {
  format: FontFormat;
  /** Faces in the file; a collection's names, glyphs and coverage describe its first. */
  faces: number;
  names: FontNames;
  glyphs?: number;
  /** Which specimen characters the font maps to a glyph, when its `cmap` could be read. */
  coverage?: ReadonlySet<number>;
  /** Why the names, glyph count and coverage are missing. */
  unread?: string;
}

export class FontError extends Error {}

/** Printable Basic Latin and Latin-1 Supplement, without the space, no-break space and soft hyphen. */
export const specimenCharacters: readonly number[] = [
  ...codeRange(0x21, 0x7e),
  ...codeRange(0xa1, 0xff).filter((code) => code !== 0xad),
];

interface TableRecord {
  offset: number;
  /** Bytes stored in the file. */
  length: number;
  /** Bytes once decompressed; WOFF stores a table uncompressed when the two are equal. */
  original: number;
}
type TableDirectory = Map<string, TableRecord>;
type GlyphLookup = (code: number) => number;
interface FontDirectory {
  tables: TableDirectory;
  faces: number;
}
interface NameRecord {
  rank: number;
  start: number;
  length: number;
  mac: boolean;
}

const truncated = 'The font file is truncated.';
const outside = 'A font table lies outside the file.';
const woff2Unread = 'WOFF2 tables use Brotli compression, which this preview cannot read.';

const signatures: ReadonlyMap<string, FontFormat> = new Map([
  ['\u0000\u0001\u0000\u0000', 'truetype'],
  ['true', 'truetype'],
  ['OTTO', 'opentype'],
  ['ttcf', 'collection'],
  ['wOFF', 'woff'],
  ['wOF2', 'woff2'],
]);

// The typographic family and subfamily (16, 17) group every weight; 1 and 2 split them into four
// styles, so they are the fallback.
const nameIDs: Record<keyof FontNames, readonly number[]> = {
  family: [16, 1],
  style: [17, 2],
  fullName: [4],
  version: [5],
  designer: [9],
  manufacturer: [8],
  copyright: [0],
};
const wantedNames = new Set(Object.values(nameIDs).flat());

const utf16 = new TextDecoder('utf-16be');
const macRoman = new TextDecoder('macintosh');

function codeRange(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function within(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length;
}

function check(bytes: Uint8Array, offset: number, length: number, message: string): void {
  if (!within(bytes, offset, length)) throw new FontError(message);
}

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function fontFormat(bytes: Uint8Array): FontFormat | undefined {
  return bytes.length < 4 ? undefined : signatures.get(tag(bytes, 0));
}

/** Names, glyph count and character coverage. A recognised font with damaged tables resolves
 * with `unread` set; only a file that is not a font rejects. */
export async function readFontInfo(bytes: Uint8Array<ArrayBuffer>): Promise<FontInfo> {
  const format = fontFormat(bytes);
  if (!format) throw new FontError('This file is not a TrueType, OpenType or WOFF font.');
  if (format === 'woff2') return { format, faces: 1, names: {}, unread: woff2Unread };
  try {
    const { tables, faces } = fontDirectory(bytes, format);
    const name = await tableBytes(bytes, tables.get('name'));
    const maxp = await tableBytes(bytes, tables.get('maxp'));
    const cmap = await tableBytes(bytes, tables.get('cmap'));
    const glyphs = maxp && glyphCount(maxp);
    return {
      format,
      faces,
      names: name ? parseNames(name) : {},
      glyphs,
      coverage: cmap && cmapCoverage(cmap, specimenCharacters, glyphs),
    };
  } catch (error) {
    if (!(error instanceof FontError)) throw error;
    return { format, faces: 1, names: {}, unread: error.message };
  }
}

function fontDirectory(bytes: Uint8Array, format: FontFormat): FontDirectory {
  if (format === 'woff') return { tables: woffDirectory(bytes), faces: 1 };
  if (format !== 'collection') return { tables: sfntDirectory(bytes, 0), faces: 1 };
  check(bytes, 0, 12, truncated);
  const data = dataView(bytes);
  const faces = data.getUint32(8);
  if (faces < 1) throw new FontError('The font collection has no faces.');
  check(bytes, 12, faces * 4, truncated);
  return { tables: sfntDirectory(bytes, data.getUint32(12)), faces };
}

/** An SFNT table directory; table offsets count from the start of the file, even in a collection. */
export function sfntDirectory(bytes: Uint8Array, start: number): TableDirectory {
  check(bytes, start, 12, truncated);
  const data = dataView(bytes);
  const count = data.getUint16(start + 4);
  check(bytes, start + 12, count * 16, truncated);
  const tables: TableDirectory = new Map();
  for (let index = 0; index < count; index++) {
    const record = start + 12 + index * 16;
    const offset = data.getUint32(record + 8);
    const length = data.getUint32(record + 12);
    check(bytes, offset, length, outside);
    tables.set(tag(bytes, record), { offset, length, original: length });
  }
  return tables;
}

export function woffDirectory(bytes: Uint8Array): TableDirectory {
  check(bytes, 0, 44, truncated);
  const data = dataView(bytes);
  const count = data.getUint16(12);
  check(bytes, 44, count * 20, truncated);
  const tables: TableDirectory = new Map();
  for (let index = 0; index < count; index++) {
    const record = 44 + index * 20;
    const offset = data.getUint32(record + 4);
    const length = data.getUint32(record + 8);
    const original = data.getUint32(record + 12);
    check(bytes, offset, length, outside);
    if (length > original)
      throw new FontError('A compressed font table is larger than its original.');
    tables.set(tag(bytes, record), { offset, length, original });
  }
  return tables;
}

async function tableBytes(
  bytes: Uint8Array<ArrayBuffer>,
  record: TableRecord | undefined,
): Promise<Uint8Array | undefined> {
  if (!record) return;
  const stored = bytes.subarray(record.offset, record.offset + record.length);
  if (record.length === record.original) return stored;
  if (record.original > woffTableLimit)
    throw new FontError('A compressed font table is too large to read.');
  return inflate(stored, record.original);
}

/** WOFF tables are zlib streams; the output may not exceed the length the directory declares. */
async function inflate(stored: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array> {
  const output = new Uint8Array(length);
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(stored);
      controller.close();
    },
  });
  const reader = input.pipeThrough(new DecompressionStream('deflate')).getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length > length)
        throw new FontError('A compressed font table is longer than its directory states.');
      output.set(value, size);
      size += value.length;
    }
  } catch (error) {
    throw error instanceof FontError ? error : new FontError('A compressed font table is damaged.');
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (size !== length)
    throw new FontError('A compressed font table is shorter than its directory states.');
  return output;
}

function nameRank(platform: number, encoding: number, language: number): number {
  // Windows Unicode, BMP or full repertoire, in US English first
  if (platform === 3 && (encoding === 1 || encoding === 10)) return language === 0x0409 ? 5 : 4;
  if (platform === 0) return 3;
  // Mac Roman, in English first
  if (platform === 1 && encoding === 0) return language === 0 ? 2 : 1;
  return 0;
}

/** The `name` table's best record for each detail; records outside its string storage are skipped. */
export function parseNames(table: Uint8Array): FontNames {
  if (!within(table, 0, 6)) return {};
  const data = dataView(table);
  const count = data.getUint16(2);
  const storage = data.getUint16(4);
  if (!within(table, 6, count * 12)) return {};
  const best = new Map<number, NameRecord>();
  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12;
    const platform = data.getUint16(record);
    const rank = nameRank(platform, data.getUint16(record + 2), data.getUint16(record + 4));
    const id = data.getUint16(record + 6);
    if (!rank || !wantedNames.has(id) || (best.get(id)?.rank ?? 0) >= rank) continue;
    const length = data.getUint16(record + 8);
    const start = storage + data.getUint16(record + 10);
    if (within(table, start, length)) best.set(id, { rank, start, length, mac: platform === 1 });
  }
  const names: FontNames = {};
  for (const [key, ids] of Object.entries(nameIDs) as [keyof FontNames, readonly number[]][]) {
    for (const id of ids) {
      const record = best.get(id);
      const text = record && nameText(table, record);
      if (text) {
        names[key] = text;
        break;
      }
    }
  }
  return names;
}

function nameText(table: Uint8Array, { start, length, mac }: NameRecord): string {
  const limit = mac ? nameLimit : nameLimit * 2;
  const bytes = table.subarray(start, start + Math.min(length, limit));
  const text = (mac ? macRoman : utf16)
    .decode(bytes)
    // control and bidirectional override characters would garble or reorder the shown detail
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .trim();
  return text && length > limit ? text + '…' : text;
}

/** The `maxp` glyph count, in either table version. */
export function glyphCount(table: Uint8Array): number | undefined {
  if (!within(table, 0, 6)) return;
  const data = dataView(table);
  const version = data.getUint32(0);
  if (version !== 0x00005000 && version !== 0x00010000) return;
  return data.getUint16(4);
}

/** Which `characters` the Unicode `cmap` subtable maps to a glyph the font has. Formats 4 and 12. */
export function cmapCoverage(
  table: Uint8Array,
  characters: readonly number[],
  glyphs?: number,
): Set<number> | undefined {
  const lookup = unicodeLookup(table);
  if (!lookup) return;
  return new Set(
    characters.filter((code) => {
      const glyph = lookup(code);
      return glyph > 0 && (glyphs === undefined || glyph < glyphs);
    }),
  );
}

function unicodeLookup(table: Uint8Array): GlyphLookup | undefined {
  if (!within(table, 0, 4)) return;
  const data = dataView(table);
  const count = data.getUint16(2);
  if (!within(table, 4, count * 8)) return;
  let best: { rank: number; lookup: GlyphLookup } | undefined;
  for (let index = 0; index < count; index++) {
    const record = 4 + index * 8;
    const platform = data.getUint16(record);
    const encoding = data.getUint16(record + 2);
    const rank = platform === 3 && (encoding === 1 || encoding === 10) ? 2 : platform === 0 ? 1 : 0;
    if (rank <= (best?.rank ?? 0)) continue;
    const offset = data.getUint32(record + 4);
    const format = within(table, offset, 2) ? data.getUint16(offset) : undefined;
    const lookup =
      format === 4
        ? segmentLookup(table, offset)
        : format === 12
          ? groupLookup(table, offset)
          : undefined;
    if (lookup) best = { rank, lookup };
  }
  return best?.lookup;
}

/** Format 4: segments sorted by end code, each a delta or an offset into the glyph ID array. */
function segmentLookup(table: Uint8Array, start: number): GlyphLookup | undefined {
  if (!within(table, start, 14)) return;
  const data = dataView(table);
  const segments = data.getUint16(start + 6) >> 1;
  if (!within(table, start, 16 + segments * 8)) return;
  const ends = start + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  return (code) => {
    let low = 0;
    let high = segments;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (data.getUint16(ends + middle * 2) < code) low = middle + 1;
      else high = middle;
    }
    if (low === segments) return 0;
    const first = data.getUint16(starts + low * 2);
    if (first > code) return 0;
    const delta = data.getUint16(deltas + low * 2);
    const rangeAt = ranges + low * 2;
    const range = data.getUint16(rangeAt);
    if (range === 0) return (code + delta) & 0xffff;
    // the range offset counts from its own position in the table
    const address = rangeAt + range + (code - first) * 2;
    if (!within(table, address, 2)) return 0;
    const glyph = data.getUint16(address);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  };
}

/** Format 12: sequential groups sorted by start code. */
function groupLookup(table: Uint8Array, start: number): GlyphLookup | undefined {
  if (!within(table, start, 16)) return;
  const data = dataView(table);
  const count = data.getUint32(start + 12);
  const groups = start + 16;
  if (!within(table, groups, count * 12)) return;
  return (code) => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (data.getUint32(groups + middle * 12 + 4) < code) low = middle + 1;
      else high = middle;
    }
    if (low === count) return 0;
    const group = groups + low * 12;
    const first = data.getUint32(group);
    return first > code ? 0 : data.getUint32(group + 8) + (code - first);
  };
}
