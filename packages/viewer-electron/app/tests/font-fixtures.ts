/** Small generated SFNT, collection and WOFF files: a table directory and the tables Viewer reads. */
import { deflateSync } from 'node:zlib';

export interface NameEntry {
  id: number;
  text: string;
  platform?: number;
  encoding?: number;
  language?: number;
  /** Raw string bytes, for encodings the builder does not write. */
  bytes?: Uint8Array;
}

/** A format 4 segment: a run of glyph IDs from `glyph`, or an explicit glyph ID array. */
export type Segment =
  | { first: number; last: number; glyph: number }
  | { first: number; last: number; glyphs: number[] };

export type Tables = Record<string, Uint8Array>;

export class Writer {
  readonly bytes: number[] = [];
  u16(value: number): this {
    this.bytes.push((value >> 8) & 0xff, value & 0xff);
    return this;
  }
  u32(value: number): this {
    return this.u16(value >>> 16).u16(value & 0xffff);
  }
  tag(text: string): this {
    for (const character of text) this.bytes.push(character.charCodeAt(0));
    return this;
  }
  raw(data: Uint8Array): this {
    for (const byte of data) this.bytes.push(byte);
    return this;
  }
  pad(): this {
    while (this.bytes.length % 4) this.bytes.push(0);
    return this;
  }
  done(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.bytes);
  }
}

export function utf16(text: string): Uint8Array {
  const writer = new Writer();
  for (let index = 0; index < text.length; index++) writer.u16(text.charCodeAt(index));
  return writer.done();
}

export function nameTable(entries: readonly NameEntry[]): Uint8Array<ArrayBuffer> {
  const strings = entries.map((entry) => entry.bytes ?? utf16(entry.text));
  // format 0, the record count, then where the string storage begins
  const writer = new Writer()
    .u16(0)
    .u16(entries.length)
    .u16(6 + entries.length * 12);
  let offset = 0;
  entries.forEach((entry, index) => {
    const length = strings[index]!.length;
    writer
      .u16(entry.platform ?? 3)
      .u16(entry.encoding ?? 1)
      .u16(entry.language ?? 0x0409);
    writer.u16(entry.id).u16(length).u16(offset);
    offset += length;
  });
  for (const bytes of strings) writer.raw(bytes);
  return writer.done();
}

export function maxpTable(glyphs: number): Uint8Array<ArrayBuffer> {
  return new Writer().u32(0x00005000).u16(glyphs).done();
}

/** Version 0 and one encoding record, whose subtable follows at byte 12. */
export function cmapHeader(platform: number, encoding: number): Writer {
  return new Writer().u16(0).u16(1).u16(platform).u16(encoding).u32(12);
}

/** A Windows Unicode BMP `cmap` with one format 4 subtable. */
export function cmap4(segments: readonly Segment[]): Uint8Array<ArrayBuffer> {
  const all: Segment[] = [...segments, { first: 0xffff, last: 0xffff, glyph: 0 }];
  const count = all.length;
  const arrays: number[] = [];
  // format, length and language, then the doubled segment count and three unread search hints
  const subtable = new Writer().u16(4).u16(0).u16(0);
  subtable
    .u16(count * 2)
    .u16(0)
    .u16(0)
    .u16(0);
  for (const segment of all) subtable.u16(segment.last);
  subtable.u16(0);
  for (const segment of all) subtable.u16(segment.first);
  for (const segment of all)
    subtable.u16('glyph' in segment ? (segment.glyph - segment.first) & 0xffff : 0);
  all.forEach((segment, index) => {
    if ('glyph' in segment) {
      subtable.u16(0);
      return;
    }
    // counted from this range offset's own position to its first glyph ID
    const own = 16 + count * 6 + index * 2;
    const target = 16 + count * 8 + arrays.length * 2;
    subtable.u16(target - own);
    arrays.push(...segment.glyphs);
  });
  for (const glyph of arrays) subtable.u16(glyph);
  return cmapHeader(3, 1).raw(subtable.done()).done();
}

/** A Windows Unicode full-repertoire `cmap` with one format 12 subtable. */
export function cmap12(groups: readonly [number, number, number][]): Uint8Array<ArrayBuffer> {
  const writer = cmapHeader(3, 10);
  // format, reserved, length, language and the group count
  writer
    .u16(12)
    .u16(0)
    .u32(16 + groups.length * 12);
  writer.u32(0).u32(groups.length);
  for (const [first, last, glyph] of groups) writer.u32(first).u32(last).u32(glyph);
  return writer.done();
}

/** Table offsets count from the start of the file, so a collection face passes where it begins. */
export function sfnt(tables: Tables, signature = 0x00010000, base = 0): Uint8Array<ArrayBuffer> {
  const tags = Object.keys(tables).sort();
  // the signature and table count, then three unread search hints
  const writer = new Writer().u32(signature).u16(tags.length);
  writer.u16(0).u16(0).u16(0);
  let offset = 12 + tags.length * 16;
  for (const tag of tags) {
    const length = tables[tag]!.length;
    // the tag, an unread checksum, the offset and the length
    writer
      .tag(tag)
      .u32(0)
      .u32(base + offset)
      .u32(length);
    offset += Math.ceil(length / 4) * 4;
  }
  for (const tag of tags) writer.raw(tables[tag]!).pad();
  return writer.done();
}

export function collection(faces: readonly Tables[]): Uint8Array<ArrayBuffer> {
  const writer = new Writer().tag('ttcf').u32(0x00010000).u32(faces.length);
  const bodies: Uint8Array[] = [];
  let base = 12 + faces.length * 4;
  for (const tables of faces) {
    const body = sfnt(tables, 0x00010000, base);
    writer.u32(base);
    bodies.push(body);
    base += body.length;
  }
  for (const body of bodies) writer.raw(body);
  return writer.done();
}

/** The 44-byte WOFF header, without metadata or a private block. */
export function woffHeader(count: number, length: number, flavor = 0x00010000): Writer {
  const writer = new Writer().tag('wOFF').u32(flavor).u32(length);
  // the table count and a reserved field, then the unread SFNT size and version 1.0
  writer.u16(count).u16(0);
  writer.u32(0).u16(1).u16(0);
  // the metadata block's offset and two lengths, then the private block's offset and length
  for (let field = 0; field < 5; field++) writer.u32(0);
  return writer;
}

export function woffRecord(
  writer: Writer,
  tag: string,
  offset: number,
  length: number,
  original: number,
): Writer {
  // the tag, offset, stored and original lengths, and an unread checksum
  return writer.tag(tag).u32(offset).u32(length).u32(original).u32(0);
}

export function woff(tables: Tables, flavor = 0x00010000): Uint8Array<ArrayBuffer> {
  const tags = Object.keys(tables).sort();
  const stored = tags.map((tag) => {
    const compressed = deflateSync(tables[tag]!);
    return compressed.length < tables[tag]!.length ? compressed : tables[tag]!;
  });
  const offsets: number[] = [];
  let length = 44 + tags.length * 20;
  for (const data of stored) {
    offsets.push(length);
    length += Math.ceil(data.length / 4) * 4;
  }
  const writer = woffHeader(tags.length, length, flavor);
  tags.forEach((tag, index) => {
    woffRecord(writer, tag, offsets[index]!, stored[index]!.length, tables[tag]!.length);
  });
  for (const data of stored) writer.raw(data).pad();
  return writer.done();
}

export const fixtureNames: NameEntry[] = [
  { id: 0, text: 'Copyright 2026 Fixture Foundry' },
  { id: 1, text: 'Fixture Sans' },
  { id: 2, text: 'Regular' },
  { id: 4, text: 'Fixture Sans Regular' },
  { id: 5, text: 'Version 1.000' },
  { id: 8, text: 'Fixture Foundry' },
  { id: 9, text: 'A. Designer' },
];

/** Printable ASCII mapped to glyphs 1 to 94; nothing from Latin-1. */
export function fixtureTables(): Tables {
  return {
    name: nameTable(fixtureNames),
    maxp: maxpTable(120),
    cmap: cmap4([{ first: 0x21, last: 0x7e, glyph: 1 }]),
  };
}

export const fixtureFont = () => sfnt(fixtureTables());
