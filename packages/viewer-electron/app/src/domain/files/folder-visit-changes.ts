import type { FolderVisits, Visit } from './folder-visits';
import { boundFolderVisits } from './folder-visits';

export interface FolderVisitSave {
  id: string;
  base: FolderVisits;
  clear: boolean;
  revision?: number;
  restored?: FolderVisits;
  clearRevision?: number;
}

export interface FolderVisitReply {
  visits: FolderVisits;
  revision: number;
  clearRevision?: number;
}

export interface FolderVisitChanges {
  clear: boolean;
  removed: string[];
  added: Record<string, Visit>;
  restored: FolderVisits;
}

/** Shared totals are a baseline, never new visits contributed by a receiving window. */
export function folderVisitChanges(
  base: FolderVisits,
  next: FolderVisits,
  clear = false,
  restored: FolderVisits = {},
): FolderVisitChanges {
  const previous = { ...(clear ? {} : base) };
  for (const [path, visit] of Object.entries(restored)) {
    previous[path] = {
      count: Math.max(previous[path]?.count ?? 0, visit.count),
      last: Math.max(previous[path]?.last ?? 0, visit.last),
    };
  }
  const removed = Object.keys(previous).filter((path) => !next[path]);
  const added: Record<string, Visit> = {};
  for (const [path, visit] of Object.entries(next)) {
    const old = previous[path];
    if (old?.count === visit.count && old.last === visit.last) continue;
    // Renaming a folder then revisiting its former path starts that path's count again.
    const reset = old && visit.count < old.count;
    if (reset) removed.push(path);
    added[path] = {
      count: reset ? visit.count : Math.max(0, visit.count - (old?.count ?? 0)),
      last: visit.last,
    };
  }
  return { clear, removed, added, restored };
}

export function applyFolderVisitChanges(
  base: FolderVisits,
  changes: FolderVisitChanges,
  now: number,
): Record<string, Visit> {
  const visits = { ...(changes.clear ? {} : base) };
  for (const [path, visit] of Object.entries(changes.restored)) {
    visits[path] = {
      count: Math.max(visits[path]?.count ?? 0, visit.count),
      last: Math.max(visits[path]?.last ?? 0, visit.last),
    };
  }
  for (const path of changes.removed) delete visits[path];
  for (const [path, visit] of Object.entries(changes.added)) {
    if (!visit.count && !visits[path]) continue;
    visits[path] = {
      count: Math.min(1e9, (visits[path]?.count ?? 0) + visit.count),
      last: Math.max(visits[path]?.last ?? 0, visit.last),
    };
  }
  return boundFolderVisits(
    visits,
    now,
    Object.keys(changes.added).filter((path) => changes.added[path]!.count > 0),
  );
}
