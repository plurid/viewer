import type { FileEntry, SortKey } from './contracts';

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
    if (foldersFirst && a.directory !== b.directory) return a.directory ? -1 : 1;
    const value =
      key === 'name'
        ? collator.compare(a.name, b.name)
        : key === 'kind'
          ? collator.compare(a.extension, b.extension)
          : a[key] - b[key];
    return (value || collator.compare(a.name, b.name)) * (descending ? -1 : 1);
  });
}
export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}
export function fileFamily(entry: Pick<FileEntry, 'extension' | 'directory' | 'mime'>): string {
  if (entry.directory) return 'folder';
  if (['glb', 'gltf', 'obj', 'stl', 'fbx'].includes(entry.extension)) return 'model';
  if (['zip', 'tar', 'gz', 'tgz'].includes(entry.extension)) return 'archive';
  if (entry.extension === 'pdf') return 'pdf';
  if (['csv', 'tsv', 'json', 'jsonl'].includes(entry.extension)) return 'data';
  if (
    ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'sh', 'html', 'css', 'cpp', 'c', 'java'].includes(
      entry.extension,
    )
  )
    return 'code';
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
