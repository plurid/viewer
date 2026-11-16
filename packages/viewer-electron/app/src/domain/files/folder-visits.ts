import { portablePath } from '../schemas';
import type { FileChange } from './changes';
import { pathMapper } from './changes';
import { normalize, scoreLabel } from '../search/name-score';

export interface Visit {
  count: number;
  last: number;
}
export type FolderVisits = Readonly<Record<string, Visit>>;
export const maximumFolderVisits = 500;
const day = 86_400_000;

/** Multiple formerly distinct destinations can become one folder after a move. */
export function remapFolderVisits(
  visits: FolderVisits,
  changes: readonly FileChange[],
): FolderVisits {
  const map = pathMapper(changes);
  const next: Record<string, Visit> = {};
  for (const [path, visit] of Object.entries(visits)) {
    const destination = map(path);
    if (!remembersFolder(destination)) continue;
    next[destination] = {
      count: Math.min(1e9, (next[destination]?.count ?? 0) + visit.count),
      last: Math.max(next[destination]?.last ?? 0, visit.last),
    };
  }
  return next;
}

/** log2(1 + count) * 2^(-ageDays / 30): frequency grows gently, with a 30-day half-life.
 * Clamp future visits to age zero so a clock correction cannot boost them. */
export function frecencyScore({ count, last }: Visit, now: number): number {
  return Math.log2(1 + count) * 2 ** (-Math.max(0, now - last) / (30 * day));
}

/** Virtual browsers never become local folder history; physical Trash folders stay private too. */
export function remembersFolder(path: string): boolean {
  return (
    portablePath.safeParse(path).success &&
    !path
      .split(/[\\/]/)
      .some(
        (part) =>
          ['.Trash', '.Trashes', '$Recycle.Bin'].includes(part) || /^\.Trash-\d+$/.test(part),
      ) &&
    !/(^|[\\/])\.local[\\/]share[\\/]Trash([\\/]|$)/.test(path)
  );
}

export function rankFrecent(visits: FolderVisits, text: string, now: number): string[] {
  const needle = normalize(text.trim());
  const words = needle.split(/\s+/).filter(Boolean);
  return Object.keys(visits)
    .filter(
      (path) =>
        remembersFolder(path) &&
        words.every(
          (word) =>
            scoreLabel(normalize(path), word) > 0 ||
            scoreLabel(normalize(path.split(/[\\/]/).at(-1) ?? path), word) > 0,
        ),
    )
    .sort(
      (a, b) =>
        frecencyScore(visits[b]!, now) - frecencyScore(visits[a]!, now) ||
        visits[b]!.last - visits[a]!.last ||
        a.localeCompare(b),
    );
}

export function boundFolderVisits(visits: FolderVisits, now: number): Record<string, Visit> {
  return Object.fromEntries(
    rankFrecent(visits, '', now)
      .slice(0, maximumFolderVisits)
      .map((path) => [path, visits[path]!]),
  );
}

export function recordVisit(visits: FolderVisits, path: string, now: number): FolderVisits {
  if (!remembersFolder(path)) return visits;
  return boundFolderVisits(
    {
      ...visits,
      [path]: { count: Math.min(1e9, (visits[path]?.count ?? 0) + 1), last: now },
    },
    now,
  );
}

/** A backup can contain the same history, so restoring it must not count those visits twice. */
export function mergeFolderVisits(
  first: FolderVisits,
  second: FolderVisits,
  now: number,
): FolderVisits {
  const merged = { ...first };
  for (const [path, visit] of Object.entries(second)) {
    merged[path] = {
      count: Math.max(merged[path]?.count ?? 0, visit.count),
      last: Math.max(merged[path]?.last ?? 0, visit.last),
    };
  }
  return boundFolderVisits(merged, now);
}
