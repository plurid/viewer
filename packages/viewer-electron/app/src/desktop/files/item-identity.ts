import { realpath } from 'node:fs/promises';
import { lstat } from './stats';
import type { FileStats as Stats } from './stats';
import type { StatIdentity } from '../../domain/files/item-identity';
import { itemIdentity } from '../../domain/files/item-identity';
import path from 'node:path';

/** The existing item a person chose to replace, captured when the collision was shown. */
export type Replaced = Stats;
/** Identity of an item reached under any spelling: case or Unicode variants,
 * symbolic-link ancestors and firmlinks all share its device and inode. */
export const sameItem = (a: StatIdentity, b: StatIdentity) => itemIdentity(a) === itemIdentity(b);
/** Whether the folder `ancestor` holds `file` at any depth, compared by identity. */
export async function holds(ancestor: Stats, file: string): Promise<boolean> {
  if (!ancestor.isDirectory()) return false;
  let current = await realpath(path.dirname(file));
  for (;;) {
    if (sameItem(await lstat(current), ancestor)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
/** A replaced item must still be the one shown in the collision prompt. Folder
 * modification times change when entries are added or removed. */
export function unchanged(current: Stats, expected: Replaced): boolean {
  return (
    sameItem(current, expected) &&
    current.mtimeMs === expected.mtimeMs &&
    (current.isDirectory() ||
      (current.size === expected.size && current.ctimeMs === expected.ctimeMs))
  );
}
