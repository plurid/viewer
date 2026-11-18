import { zipContainers } from './containers';
import { sameIdentity, sameTemporalIdentity, temporalIdentity } from './item-identity';
import type { FileEntry, SortKey } from '../contracts';
import { modelFormats } from '../previews/models/formats';
import { cameraRawFormats } from '../previews/images/rendered';
import { mailFormats } from '../previews/mail/formats';
import { certificateFormats } from '../previews/keys/certificates';
import { provisionFormats } from '../previews/data/provision';
import { shortcutFormats } from '../previews/data/shortcuts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
type CapturedItem = Pick<FileEntry, 'identity' | 'kind' | 'created' | 'modified' | 'size'>;
/** Captured authority never accepts the unreadable-entry convenience used by selection refresh. */
export function sameCapturedItem(current: CapturedItem, captured: CapturedItem): boolean {
  return (
    current.identity !== '' &&
    captured.identity !== '' &&
    current.kind === captured.kind &&
    sameSelection(current, captured)
  );
}
export function sameSelection(a: CapturedItem, b: CapturedItem): boolean {
  if (a.identity === '' && b.identity === '') return true;
  if (a.kind !== b.kind) return false;
  if (!b.identity.endsWith(':u64')) return sameIdentity(a.identity, b.identity);
  const previous = temporalIdentity(b.identity, b.kind, b.created);
  if (previous.includes(':synthetic:file:'))
    return (
      a.kind === 'file' &&
      sameTemporalIdentity(temporalIdentity(a.identity, a.kind, a.created), previous) &&
      a.size === b.size &&
      a.modified === b.modified &&
      a.created === b.created
    );
  return sameIdentity(a.identity, b.identity);
}
function renamedSelection(
  cached: FileEntry,
  index: ReturnType<typeof indexEntries>,
): FileEntry | undefined {
  if (
    !temporalIdentity(cached.identity, cached.kind, cached.created).includes(':synthetic:file:')
  ) {
    const candidate = index.identities.get(cached.identity);
    return candidate && sameSelection(candidate, cached) ? candidate : undefined;
  }
  let found: FileEntry | undefined;
  for (const entry of index.paths.values()) {
    if (
      entry.kind !== cached.kind ||
      entry.size !== cached.size ||
      entry.modified !== cached.modified ||
      entry.created !== cached.created
    )
      continue;
    if (!sameSelection(entry, cached)) continue;
    if (found) return;
    found = entry;
  }
  return found;
}
export function indexEntries(entries: readonly FileEntry[]) {
  const paths = new Map<string, FileEntry>();
  const identities = new Map<string, FileEntry | null>();
  for (const entry of entries) {
    paths.set(entry.path, entry);
    identities.set(entry.identity, identities.has(entry.identity) ? null : entry);
  }
  return { paths, identities };
}

/** Keep the exact selected item across refresh/rename. An ambiguous identity never retargets it. */
export function reconcileSelection(
  selection: readonly string[],
  cache: Map<string, FileEntry>,
  directory: string,
  index: ReturnType<typeof indexEntries>,
): string[] {
  const next: string[] = [];
  for (const path of selection) {
    const cached = cache.get(path);
    if (cached && cached.parent !== directory) {
      next.push(path);
      continue;
    }
    const exact = index.paths.get(path);
    const entry =
      exact && (!cached || sameSelection(exact, cached))
        ? exact
        : cached?.identity
          ? renamedSelection(cached, index)
          : undefined;
    if (entry) {
      cache.set(entry.path, entry);
      next.push(entry.path);
    }
  }
  return [...new Set(next)];
}
export function sortEntries(
  entries: FileEntry[],
  key: SortKey,
  descending: boolean,
  foldersFirst = true,
): FileEntry[] {
  return [...entries].sort(entryOrder(key, descending, foldersFirst));
}
/** The order `sortEntries` puts entries in, as a comparison. */
export function entryOrder(
  key: SortKey,
  descending: boolean,
  foldersFirst = true,
): (a: FileEntry, b: FileEntry) => number {
  return (a, b) => {
    if (foldersFirst && browsable(a) !== browsable(b)) return browsable(a) ? -1 : 1;
    const value =
      key === 'name'
        ? collator.compare(a.name, b.name)
        : key === 'kind' || key === 'extension'
          ? collator.compare(a.extension, b.extension)
          : a[key] - b[key];
    return (value || collator.compare(a.name, b.name)) * (descending ? -1 : 1);
  };
}
/** How many digits a size keeps: one decimal, or every byte for a threshold a rounded figure could
 * misstate. */
export type SizePrecision = 'rounded' | 'exact';
const sizeUnits = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
/** Sizes in decimal units, as Finder shows them: 1 KB is 1,000 bytes. */
export function formatBytes(value: number, precision: SizePrecision = 'rounded'): string {
  if (!(value >= 1000)) return `${value} B`;
  let power = Math.min(Math.floor(Math.log10(value) / 3), sizeUnits.length - 1);
  // 999,960 bytes reads as 1 MB, not 1,000 KB
  if (
    precision === 'rounded' &&
    power < sizeUnits.length - 1 &&
    Math.round((value / 1000 ** power) * 10) >= 10_000
  )
    power++;
  const digits = precision === 'exact' ? power * 3 : 1;
  const amount = (value / 1000 ** power).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
  return `${amount} ${sizeUnits[power]}`;
}
/** Folders macOS shows as one item, with an icon of their own: applications and other bundles. */
export const packageExtensions: ReadonlySet<string> = new Set([
  'app',
  'bundle',
  'framework',
  'plugin',
  'kext',
  'prefpane',
  'appex',
  'xpc',
  'saver',
  'qlgenerator',
  'mdimporter',
  'photoslibrary',
  'musiclibrary',
  'xcodeproj',
  'xcworkspace',
  'playground',
  'rtfd',
  'pages',
  'numbers',
  'key',
  'fcpbundle',
  'logicx',
  'band',
  'lproj',
]);
export const isPackage = (entry: Pick<FileEntry, 'directory' | 'extension'>) =>
  entry.directory && packageExtensions.has(entry.extension.toLowerCase());
/** A folder Viewer browses into. An application or other bundle is one item, as in Finder
 *: it opens in its app, and Show Package Contents goes inside. */
export const browsable = (entry: Pick<FileEntry, 'directory' | 'extension'>) =>
  entry.directory && !isPackage(entry);
// The Kind column's words for common files, as Finder names them; any other file is its
// extension's "document".
const kindNames: Readonly<Record<string, string>> = {
  pdf: 'PDF document',
  txt: 'Plain text',
  text: 'Plain text',
  md: 'Markdown document',
  markdown: 'Markdown document',
  rtf: 'Rich text document',
  html: 'HTML document',
  htm: 'HTML document',
  css: 'CSS style sheet',
  json: 'JSON document',
  csv: 'CSV document',
  tsv: 'TSV document',
  xml: 'XML document',
  yaml: 'YAML document',
  yml: 'YAML document',
  ts: 'TypeScript source',
  tsx: 'TypeScript source',
  js: 'JavaScript source',
  jsx: 'JavaScript source',
  py: 'Python script',
  sh: 'Shell script',
  rs: 'Rust source',
  go: 'Go source',
  c: 'C source',
  cpp: 'C++ source',
  java: 'Java source',
  swift: 'Swift source',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  heic: 'HEIC image',
  webp: 'WebP image',
  tif: 'TIFF image',
  tiff: 'TIFF image',
  bmp: 'BMP image',
  svg: 'SVG image',
  psd: 'Photoshop image',
  mp3: 'MP3 audio',
  m4a: 'MPEG-4 audio',
  wav: 'WAV audio',
  aiff: 'AIFF audio',
  flac: 'FLAC audio',
  mp4: 'MPEG-4 movie',
  m4v: 'MPEG-4 movie',
  mov: 'QuickTime movie',
  mkv: 'Matroska movie',
  webm: 'WebM movie',
  zip: 'ZIP archive',
  tar: 'Tar archive',
  gz: 'Gzip archive',
  tgz: 'Gzip archive',
  '7z': '7-Zip archive',
  dmg: 'Disk image',
  docx: 'Word document',
  doc: 'Word document',
  xlsx: 'Excel workbook',
  xls: 'Excel workbook',
  pptx: 'PowerPoint presentation',
  ppt: 'PowerPoint presentation',
  pages: 'Pages document',
  numbers: 'Numbers spreadsheet',
  key: 'Keynote presentation',
  epub: 'EPUB book',
  dxf: 'DXF drawing',
  stl: 'STL model',
  obj: 'OBJ model',
  glb: 'glTF model',
  gltf: 'glTF model',
  step: 'STEP model',
  stp: 'STEP model',
  ttf: 'TrueType font',
  otf: 'OpenType font',
  eml: 'Email message',
  mbox: 'Mailbox',
  ics: 'Calendar',
  vcf: 'Contact card',
  torrent: 'Torrent file',
  sqlite: 'SQLite database',
  db: 'Database',
};
/** The Kind column, as Finder words it: Folder, Application, Alias, "PDF document", "PNG
 * image", "Plain text", or the extension's document. */
export function kindLabel(entry: Pick<FileEntry, 'directory' | 'extension' | 'kind'>): string {
  if (entry.kind === 'symlink') return 'Alias';
  if (browsable(entry)) return 'Folder';
  const extension = entry.extension.toLowerCase();
  if (isPackage(entry) && extension === 'app') return 'Application';
  return kindNames[extension] ?? (extension ? `${extension.toUpperCase()} document` : 'Document');
}

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const calendarDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const midnight = (time: Date) =>
  new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
/** A file's date as Finder's list shows it: "Today at 3:04 PM", "Yesterday at 9:15 AM",
 * "Nov 17, 2026 at 3:04 PM". */
export function listDate(time: number | Date, now: number | Date = Date.now()): string {
  const when = new Date(time);
  const days = Math.round((midnight(new Date(now)) - midnight(when)) / 86_400_000);
  const at = clock.format(when);
  if (days === 0) return `Today at ${at}`;
  if (days === 1) return `Yesterday at ${at}`;
  return `${calendarDay.format(when)} at ${at}`;
}

export function fileFamily(entry: Pick<FileEntry, 'extension' | 'directory' | 'mime'>): string {
  if (entry.directory) return 'folder';
  if (entry.extension === 'dxf') return 'drawing';
  if (modelFormats.includes(entry.extension)) return 'model';
  if (['zip', 'tar', 'gz', 'tgz', ...zipContainers].includes(entry.extension)) return 'archive';
  if (entry.extension === 'pdf') return 'pdf';
  if (mailFormats.includes(entry.extension)) return 'mail';
  if (['csv', 'tsv', 'json', 'jsonl'].includes(entry.extension)) return 'data';
  // certificates, armored keys, torrents and profiles, which Viewer reads field by field
  if (
    [...certificateFormats, 'asc', 'torrent', ...provisionFormats].some(
      (format) => format === entry.extension,
    )
  )
    return 'data';
  if (shortcutFormats.some((format) => format === entry.extension)) return 'link';
  if (
    ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'sh', 'html', 'css', 'cpp', 'c', 'java'].includes(
      entry.extension,
    )
  )
    return 'code';
  // painted and designed images in a ZIP, which no system MIME table names
  if (['kra', 'ora', 'sketch'].includes(entry.extension)) return 'image';
  if (cameraRawFormats.includes(entry.extension)) return 'image';
  // sound no system MIME table names
  if (['ape', 'mpa'].includes(entry.extension)) return 'audio';
  if (entry.mime.startsWith('image/')) return 'image';
  if (entry.mime.startsWith('audio/')) return 'audio';
  if (entry.mime.startsWith('video/')) return 'video';
  return 'file';
}
export function selectedRange(entries: FileEntry[], anchor: string, target: string): string[] {
  const a = entries.findIndex((entry) => entry.path === anchor);
  const b = entries.findIndex((entry) => entry.path === target);
  return a < 0 || b < 0
    ? [target]
    : entries.slice(Math.min(a, b), Math.max(a, b) + 1).map((entry) => entry.path);
}

/** How a folder's items are grouped in its view. */
export type FileGrouping = 'none' | 'kind' | 'modified';
export function fileGroup(entry: FileEntry, group: FileGrouping): string {
  if (group === 'none') return '';
  if (group === 'kind')
    return entry.kind === 'symlink'
      ? 'Aliases'
      : browsable(entry)
        ? 'Folders'
        : isPackage(entry) && entry.extension.toLowerCase() === 'app'
          ? 'Applications'
          : entry.extension
            ? entry.extension.toUpperCase() + ' files'
            : 'Files';
  if (!entry.modified) return 'Unknown date';
  // The person's calendar day, not the UTC one.
  const date = new Date(entry.modified);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0'))
    .join('-');
}
export function groupEntries(entries: FileEntry[], group: FileGrouping): FileEntry[] {
  return group === 'none'
    ? entries
    : entries.toSorted(
        (a, b) =>
          (group === 'modified' ? -1 : 1) * fileGroup(a, group).localeCompare(fileGroup(b, group)),
      );
}
