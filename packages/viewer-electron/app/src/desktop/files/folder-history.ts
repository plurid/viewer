import { realpath } from 'node:fs/promises';
import type { FileEntry } from '../../domain/contracts';
import type { FolderVisits, Visit } from '../../domain/files/folder-visits';
import { boundFolderVisits, folderPath, remembersFolder } from '../../domain/files/folder-visits';
import { checkFolderCandidates } from '../../domain/files/folder-checks';
import { entry } from './filesystem';

/** Only history records use filesystem spelling; navigation retains the chosen path. */
export async function folderEntry(file: string): Promise<FileEntry> {
  const item = await entry(file);
  if (!item.directory) return item;
  const resolved = await realpath(file);
  return resolved === item.path ? item : entry(resolved);
}

export async function prepareFolderHistory(
  history: FolderVisits,
  check: (path: string) => Promise<{ path?: string; directory: boolean; unavailable?: boolean }>,
  now: number,
) {
  const normalized: Record<string, Visit> = {};
  for (const [old, visit] of Object.entries(history)) {
    if (!remembersFolder(old)) continue;
    const key = folderPath(old);
    normalized[key] = {
      count: Math.min(1e9, (normalized[key]?.count ?? 0) + visit.count),
      last: Math.max(normalized[key]?.last ?? 0, visit.last),
    };
  }
  const observed = new Map<string, { path?: string; directory: boolean; unavailable?: boolean }>();
  await checkFolderCandidates(Object.keys(normalized), check, new AbortController().signal, {
    limit: 500,
    checks: 1000,
    onResult: (key, value) => observed.set(key, value),
  });
  const visits: Record<string, Visit> = {};
  const checked = new Set<string>();
  for (const [old, visit] of Object.entries(normalized)) {
    const known = observed.get(old);
    if (known && !known.directory && !known.unavailable) continue;
    const key = folderPath(known?.path ?? old);
    if (!remembersFolder(key)) continue;
    visits[key] = {
      count: Math.min(1e9, (visits[key]?.count ?? 0) + visit.count),
      last: Math.max(visits[key]?.last ?? 0, visit.last),
    };
    if (known?.directory) checked.add(key);
  }
  return { visits: boundFolderVisits(visits, now), checked: [...checked] };
}
