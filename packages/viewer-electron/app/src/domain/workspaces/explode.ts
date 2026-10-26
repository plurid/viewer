import type { FileEntry } from '../contracts';
import { isPackage } from '../files/entries';

/**
 * Explode folder: which subfolders open as linked planes, each under its parent's plane:
 * breadth first to `depth` levels, at most `limit`, by name. Hidden folders only if the plane shows
 * them; bundles (an app is one item) and links (which may loop) never.
 */
export async function explodePlan(
  root: string,
  depth: number,
  list: (path: string) => Promise<readonly FileEntry[]>,
  { limit = 60, showHidden = false }: { limit?: number; showHidden?: boolean } = {},
): Promise<{ path: string; parent: string }[]> {
  const plan: { path: string; parent: string }[] = [];
  let level = [root];
  for (
    let generation = 0;
    generation < depth && level.length && plan.length < limit;
    generation++
  ) {
    const next: string[] = [];
    for (const parent of level) {
      const entries = await list(parent).catch(() => [] as FileEntry[]);
      const folders = entries
        .filter(
          (entry) =>
            entry.directory &&
            entry.kind !== 'symlink' &&
            !isPackage(entry) &&
            (showHidden || !entry.hidden),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of folders) {
        if (plan.length >= limit) break;
        plan.push({ path: entry.path, parent });
        next.push(entry.path);
      }
    }
    level = next;
  }
  return plan;
}
