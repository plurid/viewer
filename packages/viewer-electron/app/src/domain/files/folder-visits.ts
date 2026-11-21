import { portablePath } from '../schemas';
import type { FileChange } from './changes';
import { pathMapper } from './changes';
import { normalize, scoreLabel } from '../search/name-score';
import { typoScore } from '../search/approximate';

export interface Visit {
  count: number;
  last: number;
}
export type FolderVisits = Readonly<Record<string, Visit>>;
export type FolderRemapping = readonly FileChange[] | ((path: string) => string);
export function sameFolderVisits(first: FolderVisits, second: FolderVisits): boolean {
  return (
    Object.keys(first).length === Object.keys(second).length &&
    Object.entries(first).every(
      ([path, visit]) => visit.count === second[path]?.count && visit.last === second[path]?.last,
    )
  );
}
export const maximumFolderVisits = 500;
const day = 86_400_000;
const ancestorIndexes = new WeakMap<FolderVisits, ReadonlySet<string>>();

function ancestors(visits: FolderVisits): ReadonlySet<string> {
  const existing = ancestorIndexes.get(visits);
  if (existing) return existing;
  const index = new Set<string>();
  for (let path of Object.keys(visits)) {
    while (path) {
      index.add(path);
      if (path === '/') break;
      const cut = path.lastIndexOf('/');
      if (cut < 0) break;
      path = path.slice(0, cut) || '/';
    }
  }
  ancestorIndexes.set(visits, index);
  return index;
}

export function folderPath(path: string): string {
  // Backslashes are ordinary filename characters on POSIX paths.
  if (path.startsWith('/') && !path.startsWith('//'))
    return path.replace(/\/+$/, () => (/^\/+$/.test(path) ? '/' : ''));
  return path.replace(/[\\/]+$/, (slashes) =>
    /^[\\/]+$/.test(path) || /^[a-z]:[\\/]+$/i.test(path) ? slashes[0]! : '',
  );
}

/** Multiple formerly distinct destinations can become one folder after a move. */
export function remapFolderVisits(visits: FolderVisits, changes: FolderRemapping): FolderVisits {
  if (
    typeof changes !== 'function' &&
    !changes.some((change) => ancestors(visits).has(change.source))
  )
    return visits;
  const map = typeof changes === 'function' ? changes : pathMapper(changes);
  const entries = Object.entries(visits)
    .map(([path, visit]) => ({
      path,
      visit,
      destination: map(path),
    }))
    .filter((item) => item.path !== item.destination);
  if (!entries.length) return visits;
  const next: Record<string, Visit> = { ...visits };
  for (const { path } of entries) delete next[path];
  for (const { visit, destination } of entries) {
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
  const match = (label: string, word: string) => {
    const score = scoreLabel(label, word);
    return score > 100 ? score : typoScore(label, word);
  };
  const scored = Object.keys(visits)
    .filter(remembersFolder)
    .map((path) => {
      const own = normalize(path.split(/[\\/]/).filter(Boolean).at(-1) ?? path);
      const whole = normalize(path);
      const nameScores = words.map((word) => match(own, word));
      const scores = words.map((word, index) => Math.max(nameScores[index]!, match(whole, word)));
      return {
        path,
        name: nameScores.every((score) => score > 0) ? 1 : 0,
        score: scores.length ? Math.min(...scores) : 1000,
      };
    })
    .filter((item) => item.score > 0);
  // As with command ranking, a contained word excludes loose near misses for that query.
  const contained = !/\s/.test(needle) && scored.some((item) => item.score >= 400);
  return scored
    .filter((item) => !contained || item.score >= 100)
    .sort(
      (a, b) =>
        b.name - a.name ||
        b.score - a.score ||
        frecencyScore(visits[b.path]!, now) - frecencyScore(visits[a.path]!, now) ||
        visits[b.path]!.last - visits[a.path]!.last ||
        a.path.localeCompare(b.path),
    )
    .map((item) => item.path);
}

/** The jump prefix retains ordered literal words, ending in the folder's own name. */
export function rankFolderJump(visits: FolderVisits, text: string, now: number): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return Object.keys(visits)
    .filter((path) => {
      if (!remembersFolder(path)) return false;
      const lower = path.toLowerCase();
      let from = 0;
      for (const word of words) {
        const found = lower.indexOf(word, from);
        if (found < 0) return false;
        from = found + word.length;
      }
      return (lower.split('/').pop() ?? '').includes(words.at(-1)!);
    })
    .sort((a, b) => frecencyScore(visits[b]!, now) - frecencyScore(visits[a]!, now));
}

export function boundFolderVisits(
  visits: FolderVisits,
  now: number,
  protect: readonly string[] = [],
): Record<string, Visit> {
  const kept = new Set(
    protect.filter((path) => remembersFolder(path) && visits[path]).slice(-maximumFolderVisits),
  );
  for (const path of rankFrecent(visits, '', now)) {
    if (kept.size >= maximumFolderVisits) break;
    kept.add(path);
  }
  return Object.fromEntries([...kept].map((path) => [path, visits[path]!]));
}

export function recordVisit(visits: FolderVisits, path: string, now: number): FolderVisits {
  if (!remembersFolder(path)) return visits;
  path = folderPath(path);
  return boundFolderVisits(
    {
      ...visits,
      [path]: { count: Math.min(1e9, (visits[path]?.count ?? 0) + 1), last: now },
    },
    now,
    [path],
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
