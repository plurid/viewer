import { lstatSync, realpathSync, statSync } from 'node:fs';
import type { CheckedFolder } from '../../domain/files/folder-checks';
import type { FolderVisits, Visit } from '../../domain/files/folder-visits';
import { boundFolderVisits, folderPath, remembersFolder } from '../../domain/files/folder-visits';
import { checkFolderCandidates, FolderCheckPool } from '../../domain/files/folder-checks';

/** History alone resolves filesystem spelling; a dangling link is unknown, never a file. */
export function checkHistoryFolder(path: string): CheckedFolder {
  const item = lstatSync(path);
  let directory = item.isDirectory();
  if (item.isSymbolicLink()) {
    try {
      directory = statSync(path).isDirectory();
    } catch {
      return { directory: false, unavailable: true };
    }
  }
  return { directory, path: realpathSync.native(path) };
}

export async function prepareFolderHistory(
  history: FolderVisits,
  check: (path: string) => Promise<{ path?: string; directory: boolean; unavailable?: boolean }>,
  now: number,
  delegated = false,
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
    pool: new FolderCheckPool(delegated ? { timeout: false } : {}),
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
  return {
    visits: boundFolderVisits(visits, now),
    checked: [...checked],
    aliases: Object.fromEntries(
      [...observed]
        .filter(([, value]) => value.directory && value.path)
        .map(([old, value]) => [old, value.path!]),
    ),
    files: [...observed]
      .filter(([, value]) => !value.directory && !value.unavailable)
      .map(([old]) => old),
  };
}

/** Scheduling, including a never-answering disk, is outside the window's startup barrier. */
export class BackgroundFolderHistory {
  private started = false;
  private epoch = 0;

  clear(): void {
    this.epoch++;
  }

  start(
    visits: FolderVisits,
    check: Parameters<typeof prepareFolderHistory>[1],
    apply: (prepared: Awaited<ReturnType<typeof prepareFolderHistory>>) => void,
  ): void {
    if (this.started) return;
    this.started = true;
    const epoch = this.epoch;
    setTimeout(() => {
      if (epoch !== this.epoch) return;
      void prepareFolderHistory(visits, check, Date.now(), true)
        .then((prepared) => {
          if (epoch === this.epoch) apply(prepared);
        })
        .catch(() => {});
    }, 0);
  }
}
