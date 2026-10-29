/**
 * FILE SIGNATURES: what a file holds, read from its first bytes, for a file whose name does not
 * say or says wrongly. A preview reads the head through its resource; the desktop service reads it
 * from the file. Text is not identified here: its preview already shows it.
 */

/** The bytes read from the start of a file to identify it. */
export const identifyProbe = 4096;

export interface FileIdentity {
  /** What a person reads: "SQLite database", "Mach-O executable". */
  label: string;
  /** The extension whose Viewer preview reads this content, when Viewer has one. */
  extension?: string;
}

/** A magic number as text, one byte per character, or as byte values. */
type Magic = string | readonly number[];
/** A further reading of the bytes: a container's kind, a version field. Undefined reads on. */
type Reading = (head: Uint8Array, name: string) => FileIdentity | undefined;
interface Signature {
  magic: Magic;
  /** Where the magic number starts; 0 when absent. */
  at?: number;
  identity: FileIdentity | Reading;
}

const bytes = (magic: Magic) =>
  typeof magic === 'string' ? [...magic].map((character) => character.charCodeAt(0)) : magic;
const has = (head: Uint8Array, magic: Magic, at = 0) => {
  const expected = bytes(magic);
  return (
    at + expected.length <= head.length &&
    expected.every((byte, index) => head[at + index] === byte)
  );
};
const text = (head: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...head.subarray(at, at + length));
/** An unsigned integer of `size` bytes; bytes past the head read as zero. */
const number = (head: Uint8Array, at: number, size: 2 | 4, little: boolean) => {
  let value = 0;
  for (let index = 0; index < size; index++)
    value = value * 256 + (head[at + (little ? size - 1 - index : index)] ?? 0);
  return value;
};

/** Valid UTF-8 without a NUL; a character the probe cut in two still reads as text. */
function readsAsText(head: Uint8Array): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** The names of the first ZIP entries the head holds, and the first entry's stored text. */
function zipEntries(head: Uint8Array) {
  const names: string[] = [];
  let first = '';
  let at = 0;
  while (names.length < 64 && has(head, 'PK\x03\x04', at) && at + 30 <= head.length) {
    const flags = number(head, at + 6, 2, true);
    const method = number(head, at + 8, 2, true);
    const compressed = number(head, at + 18, 4, true);
    const length = number(head, at + 26, 2, true);
    const extra = number(head, at + 28, 2, true);
    const start = at + 30 + length + extra;
    if (start > head.length) break;
    names.push(text(head, at + 30, length));
    if (names.length === 1 && method === 0) first = text(head, start, Math.min(compressed, 100));
    // a size written after the data, or a ZIP64 one, leaves the next header's place unknown
    if (flags & 8 || compressed === 0xffffffff) break;
    at = start + compressed;
  }
  return { names, first };
}
const openDocuments: Record<string, FileIdentity> = {
  text: { label: 'OpenDocument text document', extension: 'odt' },
  spreadsheet: { label: 'OpenDocument spreadsheet', extension: 'ods' },
  presentation: { label: 'OpenDocument presentation', extension: 'odp' },
  graphics: { label: 'OpenDocument drawing', extension: 'odg' },
};
const zip: Reading = (head) => {
  const { names, first } = zipEntries(head);
  if (names[0] === 'mimetype') {
    if (first === 'application/epub+zip') return { label: 'EPUB book', extension: 'epub' };
    const open = /^application\/vnd\.oasis\.opendocument\.([a-z-]+)$/.exec(first);
    if (open) return openDocuments[open[1]!] ?? { label: 'OpenDocument file' };
  }
  const named = (prefix: string) => names.some((name) => name.startsWith(prefix));
  if (named('[Content_Types].xml')) {
    if (named('word/')) return { label: 'Word document', extension: 'docx' };
    if (named('xl/')) return { label: 'Excel workbook', extension: 'xlsx' };
    if (named('ppt/')) return { label: 'PowerPoint presentation', extension: 'pptx' };
    return { label: 'Office Open XML document' };
  }
  if (named('AndroidManifest.xml')) return { label: 'Android app package', extension: 'apk' };
  if (named('META-INF/')) return { label: 'Java archive', extension: 'jar' };
  return { label: 'ZIP archive', extension: 'zip' };
};

/** The brands of an ISO base media file: the major one first, then the compatible ones. */
const isoMedia: Reading = (head) => {
  const end = Math.min(number(head, 0, 4, false), head.length, 256);
  const brands = [text(head, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(text(head, at, 4));
  const major = brands[0]!;
  const any = (...names: string[]) => brands.some((brand) => names.includes(brand));
  if (any('avif', 'avis')) return { label: 'AVIF image', extension: 'avif' };
  if (any('heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'))
    return { label: 'HEIC image', extension: 'heic' };
  if (any('mif1', 'msf1')) return { label: 'HEIF image', extension: 'heif' };
  if (major === 'crx ') return { label: 'Canon RAW image', extension: 'cr3' };
  if (major === 'qt  ') return { label: 'QuickTime movie', extension: 'mov' };
  if (major.startsWith('M4A') || major.startsWith('M4B'))
    return { label: 'MPEG-4 audio', extension: 'm4a' };
  if (major.startsWith('3g2')) return { label: '3GPP2 video', extension: '3g2' };
  if (major.startsWith('3g')) return { label: '3GPP video', extension: '3gp' };
  return { label: 'MPEG-4 video', extension: 'mp4' };
};

/** Matroska names its kind in the EBML header's DocType element, 0x4282. */
const matroska: Reading = (head) => {
  for (let at = 4; at + 3 < Math.min(head.length, 64); at++)
    if (head[at] === 0x42 && head[at + 1] === 0x82) {
      const kind = text(head, at + 3, (head[at + 2] ?? 0) & 0x7f);
      if (kind === 'webm') return { label: 'WebM video', extension: 'webm' };
      if (kind === 'matroska') return { label: 'Matroska media', extension: 'mkv' };
    }
  return undefined;
};

/** An MPEG audio frame header: MP3 is layer III; layer bits 00 are AAC in an ADTS frame. */
const audioFrame: Reading = (head) => {
  const second = head[1] ?? 0,
    third = head[2] ?? 0;
  if ((second & 0xe0) !== 0xe0) return undefined;
  const version = (second >> 3) & 3,
    layer = (second >> 1) & 3;
  if (layer === 0)
    return (second & 0xf0) === 0xf0 ? { label: 'AAC audio', extension: 'aac' } : undefined;
  const bitrate = third >> 4,
    rate = (third >> 2) & 3;
  return layer === 1 && version !== 1 && bitrate !== 0 && bitrate !== 15 && rate !== 3
    ? { label: 'MP3 audio', extension: 'mp3' }
    : undefined;
};
/** An ID3 tag comes before MP3 audio, and sometimes before AAC or FLAC. */
const id3: Reading = (head, name) => {
  const version = head[3] ?? 0;
  if (version < 2 || version > 4) return undefined;
  // the tag's size is four 7-bit bytes
  const size = [6, 7, 8, 9].reduce((total, at) => total * 128 + ((head[at] ?? 0) & 0x7f), 0);
  const audio = head.subarray(10 + size);
  if (has(audio, 'fLaC')) return { label: 'FLAC audio', extension: 'flac' };
  if (has(audio, [0xff]))
    return audioFrame(audio, name) ?? { label: 'MP3 audio', extension: 'mp3' };
  return { label: 'MP3 audio', extension: 'mp3' };
};
/** An Ogg stream's first packet names its codec. */
const ogg: Reading = (head) => {
  const packet = 27 + (head[26] ?? 0);
  if (has(head, '\x01vorbis', packet)) return { label: 'Ogg Vorbis audio', extension: 'ogg' };
  if (has(head, 'OpusHead', packet)) return { label: 'Opus audio', extension: 'opus' };
  if (has(head, '\x80theora', packet)) return { label: 'Ogg video', extension: 'ogv' };
  return { label: 'Ogg audio', extension: 'ogg' };
};
const riff: Reading = (head) =>
  has(head, 'WEBP', 8)
    ? { label: 'WebP image', extension: 'webp' }
    : has(head, 'WAVE', 8)
      ? { label: 'WAV audio', extension: 'wav' }
      : has(head, 'AVI ', 8)
        ? { label: 'AVI video', extension: 'avi' }
        : undefined;
const aiff: Reading = (head) =>
  has(head, 'AIFF', 8) || has(head, 'AIFC', 8)
    ? { label: 'AIFF audio', extension: 'aiff' }
    : undefined;
/** The DIB header that follows a bitmap's file header has one of a few sizes. */
const bitmap: Reading = (head) =>
  [12, 40, 52, 56, 64, 108, 124].includes(number(head, 14, 4, true))
    ? { label: 'BMP image', extension: 'bmp' }
    : undefined;
/** An icon directory: a count, then entries whose reserved byte is zero and planes 0 or 1. */
const icon: Reading = (head) => {
  const count = number(head, 4, 2, true);
  return count > 0 && count < 256 && head[9] === 0 && number(head, 10, 2, true) <= 1
    ? { label: 'Windows icon', extension: 'ico' }
    : undefined;
};
const tiff: Reading = (head) =>
  has(head, 'CR', 8)
    ? { label: 'Canon RAW image', extension: 'cr2' }
    : { label: 'TIFF image', extension: 'tiff' };
/** A font's table count, and the search range derived from it. */
const font =
  (identity: FileIdentity): Reading =>
  (head) => {
    const tables = number(head, 4, 2, false);
    return tables > 0 &&
      tables < 128 &&
      number(head, 6, 2, false) === 16 * 2 ** Math.floor(Math.log2(tables))
      ? identity
      : undefined;
  };
/** A compressed TAR when the name gzip stored, or the file's own, says so. */
const gzip: Reading = (head, name) => {
  const flags = head[3] ?? 0;
  let stored = '';
  if (flags & 8) {
    const start = 10 + (flags & 4 ? 2 + number(head, 10, 2, true) : 0);
    const end = head.indexOf(0, start);
    if (end > start) stored = text(head, start, end - start);
  }
  return [stored, name].some((value) => /\.(?:tar|tgz)(?:\.|$)/i.test(value))
    ? { label: 'Compressed TAR archive', extension: 'tgz' }
    : { label: 'gzip archive' };
};
const machTypes: Record<number, string> = {
  1: 'Mach-O object file',
  2: 'Mach-O executable',
  4: 'Mach-O core dump',
  6: 'Mach-O library',
  8: 'Mach-O bundle',
};
const machO =
  (little: boolean): Reading =>
  (head) => ({ label: machTypes[number(head, 12, 4, little)] ?? 'Mach-O binary' });
/** CAFEBABE begins both: a universal binary counts its few architectures where a Java class
 * file has its version, 45 or more. */
const universal: Reading = (head) => {
  const count = number(head, 4, 4, false);
  return count > 0 && count < 45
    ? { label: 'Mach-O universal binary' }
    : { label: 'Java class file' };
};
const elfTypes: Record<number, string> = {
  1: 'ELF object file',
  2: 'ELF executable',
  3: 'ELF shared object',
  4: 'ELF core dump',
};
const elf: Reading = (head) => ({
  label: elfTypes[number(head, 16, 2, head[5] !== 2)] ?? 'ELF binary',
});
/** A DOS header points to the PE header, whose characteristics mark a library. */
const portable: Reading = (head) => {
  const header = number(head, 0x3c, 4, true);
  if (!has(head, 'PE\0\0', header)) return { label: 'DOS executable' };
  return number(head, header + 22, 2, true) & 0x2000
    ? { label: 'Windows library (DLL)' }
    : { label: 'Windows executable' };
};
const utf16 = (value: string) => [...value].flatMap((character) => [character.charCodeAt(0), 0]);
const holds = (head: Uint8Array, value: string) => {
  const expected = utf16(value);
  for (let at = 512; at + expected.length <= head.length; at += 2)
    if (has(head, expected, at)) return true;
  return false;
};
/** An OLE compound file names its streams in a directory the head may hold. */
const compound: Reading = (head, name) => {
  if (holds(head, 'WordDocument')) return { label: 'Word 97-2003 document', extension: 'doc' };
  if (holds(head, 'Workbook') || holds(head, 'Book'))
    return { label: 'Excel 97-2003 workbook', extension: 'xls' };
  if (holds(head, 'PowerPoint Document'))
    return { label: 'PowerPoint 97-2003 presentation', extension: 'ppt' };
  if (holds(head, '__substg1.0_') || /\.msg$/i.test(name)) return { label: 'Outlook message' };
  if (/\.msi$/i.test(name)) return { label: 'Windows Installer package' };
  return { label: 'Office 97-2003 or Outlook file' };
};
const archive = (label: string): FileIdentity => ({ label });

/** Checked in order; the first whose magic number matches and whose reading answers wins. */
const signatures: readonly Signature[] = [
  // databases and documents
  { magic: 'SQLite format 3\0', identity: { label: 'SQLite database', extension: 'sqlite' } },
  { magic: 'PK\x03\x04', identity: zip },
  { magic: 'PK\x05\x06', identity: { label: 'ZIP archive', extension: 'zip' } },
  { magic: '%PDF-', identity: { label: 'PDF document', extension: 'pdf' } },
  { magic: 'AT&TFORM', identity: { label: 'DjVu document', extension: 'djvu' } },
  { magic: '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1', identity: compound },
  { magic: 'bplist00', identity: { label: 'Binary property list', extension: 'plist' } },
  { magic: 'PAR1', identity: { label: 'Parquet data' } },
  { magic: '\x89HDF\r\n\x1a\n', identity: { label: 'HDF5 data' } },
  { magic: 'ARROW1', identity: { label: 'Apache Arrow data' } },
  // images
  { magic: '\x89PNG\r\n\x1a\n', identity: { label: 'PNG image', extension: 'png' } },
  { magic: '\xff\xd8\xff', identity: { label: 'JPEG image', extension: 'jpg' } },
  { magic: 'GIF87a', identity: { label: 'GIF image', extension: 'gif' } },
  { magic: 'GIF89a', identity: { label: 'GIF image', extension: 'gif' } },
  { magic: 'RIFF', identity: riff },
  { magic: 'BM', identity: bitmap },
  { magic: 'II*\0', identity: tiff },
  { magic: 'MM\0*', identity: { label: 'TIFF image', extension: 'tiff' } },
  { magic: '\0\0\x01\0', identity: icon },
  { magic: '8BPS', identity: { label: 'Photoshop document', extension: 'psd' } },
  { magic: '\0\0\0\x0cjP  \r\n\x87\n', identity: { label: 'JPEG 2000 image', extension: 'jp2' } },
  { magic: 'icns', identity: { label: 'Apple icon image', extension: 'icns' } },
  { magic: 'v/1\x01', identity: { label: 'OpenEXR image', extension: 'exr' } },
  // audio and video
  { magic: 'ftyp', at: 4, identity: isoMedia },
  { magic: '\x1aE\xdf\xa3', identity: matroska },
  { magic: 'ID3', identity: id3 },
  { magic: [0xff], identity: audioFrame },
  { magic: 'fLaC', identity: { label: 'FLAC audio', extension: 'flac' } },
  { magic: 'OggS', identity: ogg },
  { magic: 'FORM', identity: aiff },
  { magic: 'caff', identity: { label: 'Core Audio file', extension: 'caf' } },
  { magic: 'FLV\x01', identity: { label: 'Flash video', extension: 'flv' } },
  { magic: '0&\xb2u\x8ef\xcf\x11', identity: { label: 'Windows Media file', extension: 'asf' } },
  { magic: '\0\0\x01\xba', identity: { label: 'MPEG video', extension: 'mpg' } },
  // fonts
  { magic: '\0\x01\0\0', identity: font({ label: 'TrueType font', extension: 'ttf' }) },
  { magic: 'true', identity: font({ label: 'TrueType font', extension: 'ttf' }) },
  { magic: 'OTTO', identity: font({ label: 'OpenType font', extension: 'otf' }) },
  { magic: 'wOFF', identity: { label: 'WOFF font', extension: 'woff' } },
  { magic: 'wOF2', identity: { label: 'WOFF2 font', extension: 'woff2' } },
  { magic: 'ttcf', identity: { label: 'TrueType font collection' } },
  // archives
  { magic: '\x1f\x8b\x08', identity: gzip },
  {
    magic: 'BZh',
    identity: (head) => (/[1-9]/.test(text(head, 3, 1)) ? archive('bzip2 archive') : undefined),
  },
  { magic: '\xfd7zXZ\0', identity: archive('xz archive') },
  { magic: '(\xb5/\xfd', identity: archive('Zstandard archive') },
  { magic: '\x04"M\x18', identity: archive('LZ4 archive') },
  { magic: "7z\xbc\xaf'\x1c", identity: archive('7-Zip archive') },
  { magic: 'Rar!\x1a\x07', identity: archive('RAR archive') },
  { magic: 'ustar', at: 257, identity: { label: 'TAR archive', extension: 'tar' } },
  { magic: 'xar!', identity: archive('Installer package (xar)') },
  { magic: 'MSCF\0\0\0\0', identity: archive('Windows cabinet archive') },
  {
    magic: '!<arch>\n',
    identity: (head) =>
      has(head, 'debian-binary', 8) ? archive('Debian package') : archive('ar archive'),
  },
  {
    magic: 'PACK',
    identity: (head) =>
      [2, 3].includes(number(head, 4, 4, false)) ? { label: 'Git pack' } : undefined,
  },
  // programs
  { magic: '\xfe\xed\xfa\xce', identity: machO(false) },
  { magic: '\xfe\xed\xfa\xcf', identity: machO(false) },
  { magic: '\xce\xfa\xed\xfe', identity: machO(true) },
  { magic: '\xcf\xfa\xed\xfe', identity: machO(true) },
  { magic: '\xca\xfe\xba\xbe', identity: universal },
  { magic: '\xca\xfe\xba\xbf', identity: { label: 'Mach-O universal binary' } },
  { magic: '\x7fELF', identity: elf },
  { magic: 'MZ', identity: portable },
  { magic: '\0asm\x01\0\0\0', identity: { label: 'WebAssembly module' } },
  {
    magic: 'dex\n',
    identity: (head) =>
      /^\d{3}\0$/.test(text(head, 4, 4)) ? { label: 'Android Dalvik executable' } : undefined,
  },
];

/**
 * What the head of a file says it is, or undefined for text and for bytes no signature names.
 * `name`, the file's own, refines a few: a gzip whose name says TAR, an Outlook message.
 */
export function identifyBytes(head: Uint8Array, name = ''): FileIdentity | undefined {
  if (readsAsText(head)) return undefined;
  for (const signature of signatures) {
    if (!has(head, signature.magic, signature.at)) continue;
    const identity =
      typeof signature.identity === 'function'
        ? signature.identity(head, name)
        : signature.identity;
    if (identity) return identity;
  }
  return undefined;
}
