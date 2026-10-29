import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  FontError,
  cmapCoverage,
  fontFormat,
  glyphCount,
  parseNames,
  readFontInfo,
  specimenCharacters,
} from '../src/domain/previews/fonts/sfnt';
import {
  Writer,
  cmap12,
  cmap4,
  cmapHeader,
  collection,
  fixtureFont,
  fixtureNames,
  fixtureTables,
  maxpTable,
  nameTable,
  sfnt,
  woff,
  woffHeader,
  woffRecord,
} from './font-fixtures';

const fixtureDetails = {
  family: 'Fixture Sans',
  style: 'Regular',
  fullName: 'Fixture Sans Regular',
  version: 'Version 1.000',
  designer: 'A. Designer',
  manufacturer: 'Fixture Foundry',
  copyright: 'Copyright 2026 Fixture Foundry',
};
const ascii = specimenCharacters.filter((code) => code < 0x80);

/** Overwrite a big-endian u32 in a copy of `bytes`. */
function patched(bytes: Uint8Array, offset: number, value: number): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes);
  new DataView(copy.buffer).setUint32(offset, value);
  return copy;
}

describe('font format', () => {
  it('recognises each signature and nothing shorter than one', () => {
    expect(fontFormat(sfnt({}, 0x00010000))).toBe('truetype');
    expect(fontFormat(sfnt({}, 0x74727565))).toBe('truetype');
    expect(fontFormat(sfnt({}, 0x4f54544f))).toBe('opentype');
    expect(fontFormat(collection([{}]))).toBe('collection');
    expect(fontFormat(woff({}))).toBe('woff');
    expect(fontFormat(new Writer().tag('wOF2').u32(0).done())).toBe('woff2');
    expect(fontFormat(new Uint8Array([0, 1, 0]))).toBeUndefined();
    expect(fontFormat(new TextEncoder().encode('%PDF-1.7'))).toBeUndefined();
  });

  it('rejects a file that is not a font', async () => {
    await expect(readFontInfo(new TextEncoder().encode('not a font'))).rejects.toBeInstanceOf(
      FontError,
    );
  });
});

describe('TrueType and OpenType details', () => {
  it('reads the names, glyph count and the specimen characters the font maps', async () => {
    const info = await readFontInfo(fixtureFont());
    expect(info).toMatchObject({ format: 'truetype', faces: 1, glyphs: 120 });
    expect(info.unread).toBeUndefined();
    expect(info.names).toEqual(fixtureDetails);
    expect([...info.coverage!]).toEqual(ascii);
  });

  it('labels CFF outlines as OpenType', async () => {
    const info = await readFontInfo(sfnt(fixtureTables(), 0x4f54544f));
    expect(info.format).toBe('opentype');
    expect(info.names.family).toBe('Fixture Sans');
  });

  it('describes the first face of a collection and counts the rest', async () => {
    const second = { ...fixtureTables(), name: nameTable([{ id: 1, text: 'Second Face' }]) };
    const info = await readFontInfo(collection([fixtureTables(), second]));
    expect(info).toMatchObject({ format: 'collection', faces: 2, glyphs: 120 });
    expect(info.names.family).toBe('Fixture Sans');
  });

  it('works without the optional tables', async () => {
    const info = await readFontInfo(sfnt({ head: new Uint8Array(54) }));
    expect(info).toEqual({
      format: 'truetype',
      faces: 1,
      names: {},
      glyphs: undefined,
      coverage: undefined,
    });
  });
});

describe('name table', () => {
  it('prefers Windows Unicode US English, then other Windows languages, then Mac Roman', () => {
    const names = parseNames(
      nameTable([
        { id: 1, text: '', platform: 1, encoding: 0, language: 0, bytes: ascii8('Mac') },
        { id: 1, text: 'German', language: 0x0407 },
        { id: 1, text: 'English' },
        { id: 2, text: '', platform: 1, encoding: 0, language: 0, bytes: ascii8('Mac') },
        { id: 2, text: 'Kursiv', language: 0x0407 },
        { id: 4, text: 'unused', platform: 2, encoding: 0 },
      ]),
    );
    expect(names).toEqual({ family: 'English', style: 'Kursiv' });
  });

  it('decodes Mac Roman when no Unicode record exists', () => {
    // 0x8e is é and 0xa9 is © in Mac Roman, not Latin-1
    const bytes = new Uint8Array([...ascii8('Caf'), 0x8e, 0x20, 0xa9]);
    const names = parseNames(
      nameTable([{ id: 1, text: '', platform: 1, encoding: 0, language: 0, bytes }]),
    );
    expect(names.family).toBe('Café ©');
  });

  it('decodes UTF-16 surrogate pairs', () => {
    expect(parseNames(nameTable([{ id: 1, text: 'Fixture \u{1d504}' }])).family).toBe(
      'Fixture \u{1d504}',
    );
  });

  it('prefers the typographic family and subfamily', () => {
    const names = parseNames(
      nameTable([
        { id: 1, text: 'Fixture Sans Light' },
        { id: 2, text: 'Regular' },
        { id: 16, text: 'Fixture Sans' },
        { id: 17, text: 'Light' },
      ]),
    );
    expect(names).toMatchObject({ family: 'Fixture Sans', style: 'Light' });
  });

  it('strips control and direction override characters and caps long strings', () => {
    const names = parseNames(
      nameTable([
        { id: 1, text: '\u202eFixture\u0000\u0007Sans\n' },
        { id: 0, text: 'c'.repeat(5000) },
      ]),
    );
    expect(names.family).toBe('Fixture Sans');
    expect(names.copyright).toBe('c'.repeat(1024) + '…');
  });

  it('skips a record whose string lies outside the table and keeps the others', () => {
    const table = nameTable([
      { id: 1, text: 'Fixture Sans' },
      { id: 2, text: 'Regular' },
    ]);
    // the second record's string offset, past the end of the string storage
    new DataView(table.buffer).setUint16(6 + 12 + 10, 0xfff0);
    expect(parseNames(table)).toEqual({ family: 'Fixture Sans' });
  });

  it('reads nothing from a table shorter than its record count', () => {
    const table = nameTable([{ id: 1, text: 'Fixture Sans' }]);
    new DataView(table.buffer).setUint16(2, 400);
    expect(parseNames(table)).toEqual({});
    expect(parseNames(new Uint8Array(4))).toEqual({});
  });
});

describe('maxp and cmap tables', () => {
  it('reads the glyph count of either maxp version and nothing from a short or unknown one', () => {
    expect(glyphCount(maxpTable(512))).toBe(512);
    expect(glyphCount(new Writer().u32(0x00010000).u16(7).raw(new Uint8Array(26)).done())).toBe(7);
    expect(glyphCount(new Writer().u32(0x00005000).done())).toBeUndefined();
    expect(glyphCount(new Writer().u32(0x00020000).u16(7).done())).toBeUndefined();
  });

  it('follows format 4 range offsets into the glyph ID array', () => {
    const table = cmap4([
      { first: 0x41, last: 0x43, glyphs: [5, 0, 7] },
      { first: 0x61, last: 0x62, glyph: 10 },
    ]);
    expect([...cmapCoverage(table, [0x40, 0x41, 0x42, 0x43, 0x61, 0x62, 0x63])!]).toEqual([
      0x41, 0x43, 0x61, 0x62,
    ]);
  });

  it('counts only glyphs the font has', () => {
    const table = cmap4([{ first: 0x41, last: 0x5a, glyph: 1 }]);
    const letters = specimenCharacters.filter((code) => code >= 0x41 && code <= 0x5a);
    expect(cmapCoverage(table, letters, 10)!.size).toBe(9);
  });

  it('reads format 12 groups', () => {
    const table = cmap12([
      [0x30, 0x39, 1],
      [0xc0, 0xff, 20],
    ]);
    const coverage = cmapCoverage(table, specimenCharacters)!;
    expect(coverage.has(0x30) && coverage.has(0x39) && coverage.has(0xc0)).toBe(true);
    expect(coverage.has(0x41) || coverage.has(0xbf)).toBe(false);
    expect(coverage.size).toBe(10 + 64);
  });

  it('reports no coverage for a subtable outside the table or an unread format', () => {
    const outside = cmap4([{ first: 0x41, last: 0x5a, glyph: 1 }]);
    new DataView(outside.buffer).setUint32(8, 0xffff);
    expect(cmapCoverage(outside, specimenCharacters)).toBeUndefined();
    const format6 = cmapHeader(3, 1).u16(6).done();
    expect(cmapCoverage(format6, specimenCharacters)).toBeUndefined();
    const truncated = cmap12([[0x41, 0x5a, 1]]);
    expect(cmapCoverage(truncated.subarray(0, truncated.length - 4), ascii)).toBeUndefined();
  });
});

describe('malformed files', () => {
  it('reports a table that lies outside the file', async () => {
    const font = fixtureFont();
    // the first directory record, cmap: its offset
    const info = await readFontInfo(patched(font, 12 + 8, font.length + 100));
    expect(info).toMatchObject({ format: 'truetype', names: {} });
    expect(info.unread).toBe('A font table lies outside the file.');
  });

  it('reports a table length that runs past the end of the file', async () => {
    const font = fixtureFont();
    const info = await readFontInfo(patched(font, 12 + 12, 0xffffffff));
    expect(info.unread).toBe('A font table lies outside the file.');
  });

  it('reports a directory longer than the file', async () => {
    const font = fixtureFont();
    const copy = new Uint8Array(font);
    new DataView(copy.buffer).setUint16(4, 0xffff);
    expect((await readFontInfo(copy)).unread).toBe('The font file is truncated.');
    expect((await readFontInfo(font.subarray(0, 8))).unread).toBe('The font file is truncated.');
  });

  it('reports a collection face or face count outside the file', async () => {
    const font = collection([fixtureTables()]);
    expect((await readFontInfo(patched(font, 12, font.length))).unread).toBe(
      'The font file is truncated.',
    );
    expect((await readFontInfo(patched(font, 8, 0x40000000))).unread).toBe(
      'The font file is truncated.',
    );
    expect((await readFontInfo(patched(font, 8, 0))).unread).toBe(
      'The font collection has no faces.',
    );
  });
});

describe('WOFF', () => {
  it('decompresses the tables it reads', async () => {
    const font = woff(fixtureTables());
    // the name table compresses; the fixture would not exercise inflation otherwise
    expect(font.length).toBeLessThan(fixtureFont().length);
    const info = await readFontInfo(font);
    expect(info).toMatchObject({ format: 'woff', faces: 1, glyphs: 120, names: fixtureDetails });
    expect([...info.coverage!]).toEqual(ascii);
  });

  it('describes WOFF2 as unread without failing', async () => {
    const info = await readFontInfo(new Writer().tag('wOF2').u32(0x00010000).done());
    expect(info).toEqual({
      format: 'woff2',
      faces: 1,
      names: {},
      unread: 'WOFF2 tables use Brotli compression, which this preview cannot read.',
    });
  });

  /** A WOFF with one compressed `name` table whose directory record is replaced. */
  function compressedName(
    data: Uint8Array,
    record: { length?: number; original?: number },
  ): Uint8Array<ArrayBuffer> {
    const length = record.length ?? data.length;
    const original = record.original ?? nameTable(fixtureNames).length;
    const writer = woffHeader(1, 64 + data.length);
    return woffRecord(writer, 'name', 64, length, original).raw(data).pad().done();
  }

  it('refuses a compressed table larger than its original', async () => {
    const data = deflateSync(nameTable(fixtureNames));
    const bigger = await readFontInfo(compressedName(data, { original: data.length - 1 }));
    expect(bigger.unread).toBe('A compressed font table is larger than its original.');
  });

  it('refuses output longer or shorter than the directory states', async () => {
    const data = deflateSync(nameTable(fixtureNames));
    const original = nameTable(fixtureNames).length;
    expect((await readFontInfo(compressedName(data, { original: original - 10 }))).unread).toBe(
      'A compressed font table is longer than its directory states.',
    );
    expect((await readFontInfo(compressedName(data, { original: original + 10 }))).unread).toBe(
      'A compressed font table is shorter than its directory states.',
    );
  });

  it('refuses a table claiming too much decompressed space', async () => {
    const data = deflateSync(nameTable(fixtureNames));
    const info = await readFontInfo(compressedName(data, { original: 64 * 1024 * 1024 }));
    expect(info.unread).toBe('A compressed font table is too large to read.');
  });

  it('reports damaged compressed data', async () => {
    const data = new Uint8Array(deflateSync(nameTable(fixtureNames)));
    data.fill(0xff, 2, 12);
    const info = await readFontInfo(compressedName(data, {}));
    expect(info.unread).toBe('A compressed font table is damaged.');
  });

  it('reports a WOFF table outside the file', async () => {
    const font = woff(fixtureTables());
    // the first directory record, cmap: its offset
    const info = await readFontInfo(patched(font, 44 + 4, font.length));
    expect(info.unread).toBe('A font table lies outside the file.');
  });
});

function ascii8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
