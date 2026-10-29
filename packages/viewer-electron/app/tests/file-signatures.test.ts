/**
 * A file's first bytes name what it is when its name does not: real heads from the playground's
 * samples, and generated ones for formats it has no sample of. The pinned camera RAW and Apache POI
 * references are read where the playground holds them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import type { FileIdentity } from '../src/domain/files/signatures';
import {
  compoundKind,
  directoryProbe,
  identifyBytes,
  identifyProbe,
} from '../src/domain/files/signatures';
import { Resources } from '../src/desktop/previews/resources';
import { cameraRawSamples } from '../tools/playground/camera-raw';
import { officeLayoutSamples } from '../tools/playground/office-layout';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import type { DirectoryEntry } from './support/compound-file';
import {
  compoundFile,
  excelDirectory,
  powerPointDirectory,
  wordDirectory,
} from './support/compound-file';
import { holds, pinned } from './support/real-corpus';

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
  it('names camera RAW files by their maker’s magic number or brand', () => {
    expect(identifyBytes(bytes('FUJIFILMCCD-RAW 0201FF159505X-T4'))).toEqual({
      label: 'Fujifilm RAW image',
      extension: 'raf',
    });
    expect(identifyBytes(bytes('IIRO', word(8, true)))).toEqual({
      label: 'Olympus RAW image',
      extension: 'orf',
    });
    expect(label(bytes('IIRS', word(8, true)))).toBe('Olympus RAW image');
    expect(label(bytes('MMOR', word(8)))).toBe('Olympus RAW image');
    expect(identifyBytes(bytes('IIU\0', word(0x18, true)))).toEqual({
      label: 'Panasonic RAW image',
      extension: 'rw2',
    });
    expect(identifyBytes(bytes(word(0x18), 'ftypcrx ', word(1), 'crx isom'))).toEqual({
      label: 'Canon RAW image',
      extension: 'cr3',
    });
  });
});

/** The directory sector a compound file's head lacks, as `directoryProbe` asks for it. */
const directoryOf = (file: Uint8Array) => {
  const probe = directoryProbe(file.subarray(0, identifyProbe), file.length);
  return probe && file.subarray(probe.at, probe.at + probe.length);
};
/** The first directory sector wherever it lies: a 512-byte head never holds it. */
const firstDirectory = (file: Uint8Array) => {
  const probe = directoryProbe(file.subarray(0, 512), file.length)!;
  return file.subarray(probe.at, probe.at + probe.length);
};
const word97 = { label: 'Word 97-2003 document', extension: 'doc' };
const excel97 = { label: 'Excel 97-2003 workbook', extension: 'xls' };

describe('OLE compound files', () => {
  it('reads the directory past the head to name a Word document', () => {
    const file = compoundFile(wordDirectory, { directory: 10 });
    const head = file.subarray(0, identifyProbe);
    expect(directoryProbe(head, file.length)).toEqual({ at: 11 * 512, length: 512 });
    expect(identifyBytes(head)).toEqual({ label: 'Office 97-2003 or Outlook file' });
    expect(identifyBytes(head, '', directoryOf(file))).toEqual(word97);
    expect(compoundKind(head.subarray(0, 512), directoryOf(file)!)).toEqual(word97);
    // a version 4 file's 4096-byte directory always lies past the head
    const four = compoundFile(wordDirectory, { directory: 0, shift: 12 });
    expect(directoryProbe(four.subarray(0, identifyProbe), four.length)).toEqual({
      at: 4096,
      length: 4096,
    });
    expect(identifyBytes(four.subarray(0, identifyProbe), '', directoryOf(four))).toEqual(word97);
  });
  it('names each kind from a directory the head holds', () => {
    for (const file of [compoundFile(excelDirectory), compoundFile(powerPointDirectory)])
      expect(directoryProbe(file, file.length)).toBeUndefined();
    expect(identifyBytes(compoundFile(excelDirectory))).toEqual(excel97);
    expect(identifyBytes(compoundFile(powerPointDirectory))).toEqual({
      label: 'PowerPoint 97-2003 presentation',
      extension: 'ppt',
    });
    const root = { name: 'Root Entry', type: 'root', child: 1 } as const;
    const streams = (...names: string[]) =>
      compoundFile([
        root,
        // each the right sibling of the one before
        ...names.map((name, index) => ({
          name,
          type: 'stream' as const,
          right: index + 1 < names.length ? index + 2 : undefined,
        })),
      ]);
    expect(identifyBytes(streams('Book'))).toEqual({
      label: 'Excel 5.0/95 workbook',
      extension: 'xls',
    });
    // a workbook that keeps an Excel 5.0/95 copy beside its own
    expect(identifyBytes(streams('Book', 'Workbook'))).toEqual(excel97);
    expect(identifyBytes(streams('__substg1.0_0037001F'))).toEqual({ label: 'Outlook message' });
    expect(identifyBytes(streams('Contents'))).toEqual({ label: 'Office 97-2003 or Outlook file' });
    expect(label(streams('Contents'), 'Reply.msg')).toBe('Outlook message');
    expect(label(streams('Contents'), 'Setup.msi')).toBe('Windows Installer package');
  });
  it('never names a file by a stream inside a storage', () => {
    // a workbook whose first sector shows a document embedded in it, and not its root's links
    const embedded = compoundFile([
      { name: 'Root Entry', type: 'root', child: 9 },
      { name: 'Workbook', type: 'stream' },
      { name: 'MBD0001A2B3', type: 'storage', child: 3 },
      { name: 'WordDocument', type: 'stream' },
    ]);
    expect(identifyBytes(embedded)).toEqual(excel97);
    // the root's own stream comes before one this sector does not place
    const placed = compoundFile([
      { name: 'Root Entry', type: 'root', child: 1 },
      { name: 'Workbook', type: 'stream' },
      { name: 'WordDocument', type: 'stream' },
    ]);
    expect(identifyBytes(placed)).toEqual(excel97);
    const only = compoundFile([
      { name: 'Root Entry', type: 'root', child: 1 },
      { name: 'ObjectPool', type: 'storage', child: 2 },
      { name: 'Workbook', type: 'stream' },
    ]);
    expect(identifyBytes(only)).toEqual({ label: 'Office 97-2003 or Outlook file' });
  });
  it('refuses a malformed header or directory', () => {
    const file = compoundFile(wordDirectory, { directory: 10 });
    const header = file.subarray(0, 512),
      directory = firstDirectory(file);
    const altered = (at: number, ...values: number[]) => {
      const copy = file.slice();
      copy.set(values, at);
      return copy;
    };
    expect(compoundKind(header, directory)).toEqual(word97);
    // a sector of 1024 bytes, and a header in the other byte order
    for (const malformed of [altered(0x1e, 10, 0), altered(0x1c, 0xff, 0xfe)]) {
      expect(
        directoryProbe(malformed.subarray(0, identifyProbe), malformed.length),
      ).toBeUndefined();
      expect(compoundKind(malformed.subarray(0, 512), directory)).toBeUndefined();
    }
    expect(compoundKind(header.subarray(0, 511), directory)).toBeUndefined();
    // a directory past the end of the file, or not one sector long
    expect(directoryProbe(file.subarray(0, identifyProbe), file.length - 1)).toBeUndefined();
    expect(compoundKind(header, directory.subarray(0, 384))).toBeUndefined();
    expect(compoundKind(header, file.subarray(file.length - 1024))).toBeUndefined();
    // WordDocument's name length, longer than its entry
    expect(compoundKind(header, firstDirectory(altered(11 * 512 + 2 * 128 + 0x40, 66)))).toBe(
      undefined,
    );
    const kind = (...entries: DirectoryEntry[]) => {
      const generated = compoundFile(entries);
      return compoundKind(generated.subarray(0, 512), firstDirectory(generated));
    };
    const root = { name: 'Root Entry', type: 'root', child: 1 } as const;
    const workbook = { name: 'Workbook', type: 'stream' } as const;
    expect(kind(root, workbook)).toEqual(excel97);
    expect(kind(workbook, root)).toBeUndefined();
    // links that loop, reach the root, or share an entry
    expect(kind(root, { ...workbook, left: 1 })).toBeUndefined();
    expect(kind(root, { ...workbook, right: 0 })).toBeUndefined();
    expect(
      kind(root, { ...workbook, right: 2 }, { name: 'ObjectPool', type: 'storage', child: 1 }),
    ).toBeUndefined();
  });
  /** Unmodified Apache POI references, where the playground or a retained corpus holds them. */
  for (const sample of officeLayoutSamples.filter((item) =>
    ['doc', 'xls', 'ppt'].includes(item.formats[0]!),
  )) {
    const extension = sample.formats[0];
    it.skipIf(!holds(sample))(`names ${path.basename(sample.path)} by its directory`, async () => {
      const file = new Uint8Array(await pinned(sample));
      const head = file.subarray(0, identifyProbe);
      expect(compoundKind(head.subarray(0, 512), firstDirectory(file))?.extension).toBe(extension);
      expect(identifyBytes(head, '', directoryOf(file))?.extension).toBe(extension);
      if (extension === 'doc') {
        // Word wrote its directory near the end of the file
        expect(directoryProbe(head, file.length)).toEqual({ at: 332288, length: 512 });
        expect(identifyBytes(head)).toEqual({ label: 'Office 97-2003 or Outlook file' });
      } else expect(identifyBytes(head)?.extension).toBe(extension);
    });
  }
});

/** The playground's pinned camera RAW samples; DNG, NEF and ARW files are TIFF images too. */
describe('camera RAW samples', () => {
  const identities: Record<string, FileIdentity> = {
    cr2: { label: 'Canon RAW image', extension: 'cr2' },
    cr3: { label: 'Canon RAW image', extension: 'cr3' },
    raf: { label: 'Fujifilm RAW image', extension: 'raf' },
    orf: { label: 'Olympus RAW image', extension: 'orf' },
    rw2: { label: 'Panasonic RAW image', extension: 'rw2' },
    dng: { label: 'TIFF image', extension: 'tiff' },
    nef: { label: 'TIFF image', extension: 'tiff' },
    arw: { label: 'TIFF image', extension: 'tiff' },
  };
  for (const sample of cameraRawSamples) {
    const identity = identities[sample.formats[0]!]!;
    it.skipIf(!holds(sample))(
      `${path.basename(sample.path)} reads as ${identity.label}`,
      async () => {
        const head = (await pinned(sample)).subarray(0, identifyProbe);
        expect(identifyBytes(head, 'unnamed')).toEqual(identity);
      },
    );
  }
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
