import { zipContainers } from './containers';
import type { FileEntry, SortKey } from '../contracts';
import { modelFormats } from '../previews/models/formats';
import { cameraRawFormats } from '../previews/images/rendered';
import { mailFormats } from '../previews/mail/formats';
import { certificateFormats } from '../previews/keys/certificates';
import { provisionFormats } from '../previews/data/provision';
import { shortcutFormats } from '../previews/data/shortcuts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
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
      exact && (!cached || exact.identity === cached.identity)
        ? exact
        : cached?.identity
          ? index.identities.get(cached.identity)
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
  return [...entries].sort((a, b) => {
    if (foldersFirst && browsable(a) !== browsable(b)) return browsable(a) ? -1 : 1;
    const value =
      key === 'name'
        ? collator.compare(a.name, b.name)
        : key === 'kind' || key === 'extension'
          ? collator.compare(a.extension, b.extension)
          : a[key] - b[key];
    return (value || collator.compare(a.name, b.name)) * (descending ? -1 : 1);
  });
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
/** The Kind column: Folder, Application, Alias, or a file's or bundle's extension. */
export function kindLabel(entry: Pick<FileEntry, 'directory' | 'extension' | 'kind'>): string {
  if (entry.kind === 'symlink') return 'Alias';
  if (browsable(entry)) return 'Folder';
  if (isPackage(entry) && entry.extension.toLowerCase() === 'app') return 'Application';
  return entry.extension.toUpperCase() || 'File';
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
