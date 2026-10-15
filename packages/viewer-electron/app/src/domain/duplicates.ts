import type { FileEntry } from './contracts';

/** Files with identical contents. `files` holds one entry per distinct file: hard links
 * to one file are a single item, because removing one would free nothing. */
export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileEntry[];
}
export interface DuplicateResult {
  id: string;
  roots: string[];
  groups: DuplicateGroup[];
  scanned: number;
  coverage: 'complete' | 'partial';
  errors: { path: string; message: string }[];
  created: number;
}
export type DuplicateRequest =
  { kind: 'run'; id: string; roots: string[] } | { kind: 'cancel'; id: string };

/** Groups hashed files by content, largest reclaimable space first. */
export function duplicateGroups(
  hashed: readonly { file: FileEntry; hash: string }[],
): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  const seen = new Set<string>();
  for (const { file, hash } of hashed) {
    if (seen.has(file.identity)) continue;
    seen.add(file.identity);
    const key = `${file.size}:${hash}`;
    const group = groups.get(key) ?? { hash, size: file.size, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.files.length > 1)
    .map((group) => ({
      ...group,
      files: group.files.toSorted(
        (a, b) => a.modified - b.modified || a.path.localeCompare(b.path),
      ),
    }))
    .sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
}
