/**
 * A file's first bytes name what it is when its name does not: real heads from the playground's
 * samples, and generated ones for formats it has no sample of.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { identifyBytes, identifyProbe } from '../src/domain/files/signatures';
import { Resources } from '../src/desktop/previews/resources';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const assets = fileURLToPath(new URL('../tools/playground/assets/', import.meta.url));
const head = async (name: string) =>
  new Uint8Array((await readFile(path.join(assets, name))).subarray(0, identifyProbe));
/** Bytes from text, one per character, then zeros, as a binary header is followed. */
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array([
    ...parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((character) => character.charCodeAt(0)) : part,
    ),
    ...new Array(64).fill(0),
  ]);
const word = (value: number, little = false) => {
  const out = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  return little ? out.reverse() : out;
};
const label = (data: Uint8Array, name?: string) => identifyBytes(data, name)?.label;

describe('playground samples', () => {
  it.each([
    ['library.sqlite', 'SQLite database', 'sqlite'],
    ['study.png', 'PNG image', 'png'],
    ['study.jpg', 'JPEG image', 'jpg'],
    ['study.gif', 'GIF image', 'gif'],
    ['study.webp', 'WebP image', 'webp'],
    ['study.bmp', 'BMP image', 'bmp'],
    ['study.ico', 'Windows icon', 'ico'],
    ['study.tiff', 'TIFF image', 'tiff'],
    ['study.psd', 'Photoshop document', 'psd'],
    ['study.heic', 'HEIC image', 'heic'],
    ['study.avif', 'AVIF image', 'avif'],
    ['study.jp2', 'JPEG 2000 image', 'jp2'],
    ['motion.mp4', 'MPEG-4 video', 'mp4'],
    ['motion.m4v', 'MPEG-4 video', 'mp4'],
    ['motion.mov', 'QuickTime movie', 'mov'],
    ['motion.3gp', '3GPP video', '3gp'],
    ['motion.webm', 'WebM video', 'webm'],
    ['motion.mkv', 'Matroska media', 'mkv'],
    ['motion.avi', 'AVI video', 'avi'],
    ['tone.m4a', 'MPEG-4 audio', 'm4a'],
    ['tone.mp3', 'MP3 audio', 'mp3'],
    ['tone.aac', 'AAC audio', 'aac'],
    ['tone.flac', 'FLAC audio', 'flac'],
    ['tone.ogg', 'Ogg Vorbis audio', 'ogg'],
    ['tone.opus', 'Opus audio', 'opus'],
    ['tone.wav', 'WAV audio', 'wav'],
    ['tone.aiff', 'AIFF audio', 'aiff'],
  ])('%s reads as %s', async (name, expected, extension) => {
    expect(identifyBytes(await head(name), 'unnamed')).toEqual({ label: expected, extension });
  });
});

describe('ZIP packages', () => {
  const zip = (files: Record<string, string>, stored = 'mimetype') =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, text]) => [
          name,
          name === stored ? [strToU8(text), { level: 0 }] : strToU8(text),
        ]),
      ),
    );
  it('reads the stored mimetype of an EPUB or OpenDocument file', () => {
    const container = '<container/>';
    expect(
      identifyBytes(zip({ mimetype: 'application/epub+zip', 'META-INF/container.xml': container })),
    ).toEqual({ label: 'EPUB book', extension: 'epub' });
    expect(
      identifyBytes(
        zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '' }),
      ),
    ).toEqual({ label: 'OpenDocument text document', extension: 'odt' });
    expect(
      label(zip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': '' })),
    ).toBe('OpenDocument spreadsheet');
    expect(
      label(zip({ mimetype: 'application/vnd.oasis.opendocument.text-template', a: '' })),
    ).toBe('OpenDocument file');
  });
  it('tells Office Open XML documents apart by their part names', () => {
    const types = '<Types/>';
    const office = (part: string) =>
      identifyBytes(zip({ '[Content_Types].xml': types, '_rels/.rels': '<r/>', [part]: '<x/>' }));
    expect(office('word/document.xml')).toEqual({ label: 'Word document', extension: 'docx' });
    expect(office('xl/workbook.xml')).toEqual({ label: 'Excel workbook', extension: 'xlsx' });
    expect(office('ppt/presentation.xml')?.extension).toBe('pptx');
    expect(office('docProps/core.xml')).toEqual({ label: 'Office Open XML document' });
  });
  it('names Java and Android packages, and any other ZIP', () => {
    expect(
      identifyBytes(zip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0', 'a.class': '' })),
    ).toEqual({ label: 'Java archive', extension: 'jar' });
    expect(label(zip({ 'AndroidManifest.xml': '', 'classes.dex': '' }))).toBe(
      'Android app package',
    );
    expect(identifyBytes(zip({ 'notes.txt': 'hello' }))).toEqual({
      label: 'ZIP archive',
      extension: 'zip',
    });
    expect(label(bytes('PK\x05\x06'))).toBe('ZIP archive');
  });
});

describe('generated heads', () => {
  it('names documents, data and images without a playground sample', () => {
    expect(identifyBytes(bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'))).toEqual({
      label: 'PDF document',
      extension: 'pdf',
    });
    expect(identifyBytes(bytes('AT&TFORM', word(4000), 'DJVUINFO'))?.extension).toBe('djvu');
    expect(identifyBytes(bytes('bplist00\xd1\x01\x02'))).toEqual({
      label: 'Binary property list',
      extension: 'plist',
    });
    expect(label(bytes('PAR1\x15\x04'))).toBe('Parquet data');
    expect(label(bytes('PACK', word(2), word(40)))).toBe('Git pack');
    expect(label(bytes('PACK', word(9)))).toBeUndefined();
    expect(label(bytes('MM\0*\0\0\0\x08'))).toBe('TIFF image');
    expect(identifyBytes(bytes('II*\0\x10\0\0\0CR\x02\0'))).toEqual({
      label: 'Canon RAW image',
      extension: 'cr2',
    });
  });
  it('reads an MP3 frame without an ID3 tag, and the audio after a tag', () => {
    expect(label(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('MP3 audio');
    expect(label(bytes([0xff, 0xfb, 0xf0, 0x64]))).toBeUndefined();
    expect(label(bytes('ID3\x04\0\0\0\0\0\x00fLaC'))).toBe('FLAC audio');
  });
  it('checks a font’s table directory', () => {
    const directory = [0, 10, 0, 128, 0, 3, 0, 32];
    expect(identifyBytes(bytes([0, 1, 0, 0, ...directory]))).toEqual({
      label: 'TrueType font',
      extension: 'ttf',
    });
    expect(identifyBytes(bytes('OTTO', directory))?.extension).toBe('otf');
    expect(identifyBytes(bytes('true', directory))?.label).toBe('TrueType font');
    expect(identifyBytes(bytes([0, 1, 0, 0, 0, 10, 0, 7]))).toBeUndefined();
    expect(identifyBytes(bytes('wOFF\0\x01\0\0'))?.extension).toBe('woff');
    expect(identifyBytes(bytes('wOF2\0\x01\0\0'))?.extension).toBe('woff2');
    expect(identifyBytes(bytes('ttcf\0\x01\0\0'))).toEqual({ label: 'TrueType font collection' });
  });
  it('names archives, and a compressed TAR by the name gzip stored or the file’s own', () => {
    const gzip = new Uint8Array(gzipSync(Buffer.from('plain text')));
    expect(identifyBytes(gzip)).toEqual({ label: 'gzip archive' });
    expect(identifyBytes(gzip, 'backup.tar.gz.part')).toEqual({
      label: 'Compressed TAR archive',
      extension: 'tgz',
    });
    expect(label(bytes([0x1f, 0x8b, 8, 8, 0, 0, 0, 0, 0, 3], 'notes.tar\0', [0x4b, 0x80]))).toBe(
      'Compressed TAR archive',
    );
    expect(label(bytes('BZh91AY&SY\x01\x02'))).toBe('bzip2 archive');
    expect(label(bytes('\xfd7zXZ\0\0\x04'))).toBe('xz archive');
    expect(label(bytes('(\xb5/\xfd\x24'))).toBe('Zstandard archive');
    expect(label(bytes("7z\xbc\xaf'\x1c\0\x04"))).toBe('7-Zip archive');
    expect(label(bytes('Rar!\x1a\x07\x01\0'))).toBe('RAR archive');
    const tar = new Uint8Array(1024);
    tar.set(strToU8('notes.txt'), 0);
    tar.set(strToU8('ustar\x0000'), 257);
    expect(identifyBytes(tar)).toEqual({ label: 'TAR archive', extension: 'tar' });
  });
  it('tells a universal Mach-O binary from a Java class file by the field after CAFEBABE', () => {
    expect(label(bytes([0xca, 0xfe, 0xba, 0xbe], word(2), word(0x01000007)))).toBe(
      'Mach-O universal binary',
    );
    // Java 17: minor version 0, major version 61
    expect(label(bytes([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61, 0, 0x1d]))).toBe('Java class file');
    expect(label(bytes([0xca, 0xfe, 0xba, 0xbe, 0xff, 0xff, 0, 65]))).toBe('Java class file');
  });
  it('reads thin Mach-O files of either byte order, ELF and PE executables', () => {
    const arm64 = [...word(0x0100000c, true), 0, 0, 0, 0];
    expect(label(bytes([0xcf, 0xfa, 0xed, 0xfe], arm64, word(2, true)))).toBe('Mach-O executable');
    expect(label(bytes([0xfe, 0xed, 0xfa, 0xce], word(18), word(0), word(6)))).toBe(
      'Mach-O library',
    );
    expect(
      label(bytes([0xce, 0xfa, 0xed, 0xfe], word(7, true), word(3, true), word(9, true))),
    ).toBe('Mach-O binary');
    const elf = (order: number, type: number[]) =>
      label(bytes('\x7fELF', [2, order, 1], new Array(9).fill(0), type));
    expect(elf(1, [3, 0])).toBe('ELF shared object');
    expect(elf(2, [0, 2])).toBe('ELF executable');
    const portable = (characteristics: number) => {
      const data = bytes('MZ', new Array(0x100).fill(0));
      data[0x3c] = 0x80;
      data.set(strToU8('PE\0\0'), 0x80);
      data[0x80 + 22] = characteristics & 255;
      data[0x80 + 23] = characteristics >> 8;
      return label(data);
    };
    expect(portable(0x0022)).toBe('Windows executable');
    expect(portable(0x2022)).toBe('Windows library (DLL)');
    expect(label(bytes('MZ\x90\0\x03'))).toBe('DOS executable');
    expect(label(bytes('\0asm\x01\0\0\0\x01'))).toBe('WebAssembly module');
    expect(label(bytes('dex\n035\0'))).toBe('Android Dalvik executable');
  });
  it('names an OLE compound file by the streams its directory shows', () => {
    const compound = (...streams: string[]) => {
      const data = new Uint8Array(2048);
      data.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      streams.forEach((stream, index) =>
        data.set(
          [...stream].flatMap((character) => [character.charCodeAt(0), 0]),
          512 + index * 128,
        ),
      );
      return data;
    };
    expect(identifyBytes(compound('Root Entry', 'WordDocument'))).toEqual({
      label: 'Word 97-2003 document',
      extension: 'doc',
    });
    expect(identifyBytes(compound('Root Entry', 'Workbook'))?.extension).toBe('xls');
    expect(label(compound('Root Entry', 'PowerPoint Document'))).toBe(
      'PowerPoint 97-2003 presentation',
    );
    expect(label(compound('Root Entry', '__substg1.0_0037001F'))).toBe('Outlook message');
    expect(label(compound('Root Entry'))).toBe('Office 97-2003 or Outlook file');
    expect(label(compound('Root Entry'), 'Reply.msg')).toBe('Outlook message');
  });
});

describe('what is not identified', () => {
  it('leaves text alone, including a character the probe cut in two', () => {
    expect(identifyBytes(strToU8('# Notes\nPlain text.\n'))).toBeUndefined();
    expect(identifyBytes(strToU8('MZ is how this note begins'))).toBeUndefined();
    const accented = strToU8('Neamț '.repeat(10));
    expect(identifyBytes(accented.subarray(0, accented.length - 2))).toBeUndefined();
    expect(identifyBytes(new Uint8Array())).toBeUndefined();
  });
  it('leaves unknown bytes and short heads unnamed', () => {
    expect(identifyBytes(bytes([0x13, 0x37, 0x42, 0x99]))).toBeUndefined();
    expect(identifyBytes(new Uint8Array([0x89, 0x50, 0x4e]))).toBeUndefined();
    expect(identifyBytes(bytes('RIFF', word(100, true), 'XXXX'))).toBeUndefined();
    expect(identifyBytes(bytes('BM\0\0\0\0\0\0\0\0\0\0\0\0\x07'))).toBeUndefined();
  });
});

/** Show as offers SQLite and archives for misnamed files because their reads go by the bytes. */
describe('a misnamed database or archive through its preview resource', () => {
  let root: string, resources: Resources;
  beforeEach(async () => {
    root = await temporaryRoot('viewer-misnamed-');
    resources = new Resources();
  });
  afterEach(async () => {
    await resources.quiesce();
    await trashTemporary(root);
  });
  const grant = async (name: string, data: Uint8Array) => {
    await writeFile(path.join(root, name), data);
    return resources.grant(path.join(root, name));
  };
  it('lists a database’s tables and an archive’s entries whatever the name says', async () => {
    const library = await grant('library.txt', await readFile(path.join(assets, 'library.sqlite')));
    expect(library.entry.extension).toBe('txt');
    expect(await resources.sqlite(library.id, { kind: 'tables' })).toMatchObject({
      kind: 'tables',
      objects: expect.arrayContaining([expect.objectContaining({ name: 'materials' })]),
    });
    const zip = await grant('Bundle', zipSync({ 'notes.txt': strToU8('hello') }));
    expect((await resources.archive(zip.id)).entries.map((entry) => entry.name)).toEqual([
      'notes.txt',
    ]);
    const header = new Uint8Array(1024);
    header.set(strToU8('notes.txt'), 0);
    header.set(strToU8('0000644\0'), 100);
    header.set(strToU8('00000000000\0'), 124);
    header.set(strToU8('ustar\x0000'), 257);
    header.fill(32, 148, 156);
    const sum = header.subarray(0, 512).reduce((total, byte) => total + byte, 0);
    header.set(strToU8(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    const tar = await grant('backup.part', header);
    expect(identifyBytes(header)?.extension).toBe('tar');
    expect((await resources.archive(tar.id)).entries.map((entry) => entry.name)).toEqual([
      'notes.txt',
    ]);
  });
});
