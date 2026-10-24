/**
 * EXPLODE FOLDER (2026-10-23): a folder's subfolders, and theirs to the depth asked, as linked planes:
 * breadth first, at most 60, without hidden folders, bundles or links.
 */
import { expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { explodePlan } from '../src/domain/workspaces/explode';

const folder = (path: string, extra: Partial<FileEntry> = {}): FileEntry =>
  ({
    path,
    parent: path.slice(0, path.lastIndexOf('/')) || '/',
    name: path.split('/').pop()!,
    directory: true,
    kind: 'directory',
    extension: path.includes('.') ? path.split('.').pop()! : '',
    hidden: path.split('/').pop()!.startsWith('.'),
    ...extra,
  }) as FileEntry;
const tree: Record<string, FileEntry[]> = {
  '/p': [
    folder('/p/src'),
    folder('/p/docs'),
    folder('/p/.git'),
    folder('/p/App.app'),
    folder('/p/link', { kind: 'symlink' }),
    { ...folder('/p/readme.md'), directory: false, kind: 'file' },
  ],
  '/p/src': [folder('/p/src/a'), folder('/p/src/b')],
  '/p/docs': [folder('/p/docs/c')],
  '/p/src/a': [folder('/p/src/a/deep')],
};
const list = async (path: string) => tree[path] ?? [];

it('opens subfolders breadth first to the depth asked, each under its parent', async () => {
  expect(await explodePlan('/p', 1, list)).toEqual([
    { path: '/p/docs', parent: '/p' },
    { path: '/p/src', parent: '/p' },
  ]);
  expect(await explodePlan('/p', 2, list)).toEqual([
    { path: '/p/docs', parent: '/p' },
    { path: '/p/src', parent: '/p' },
    { path: '/p/docs/c', parent: '/p/docs' },
    { path: '/p/src/a', parent: '/p/src' },
    { path: '/p/src/b', parent: '/p/src' },
  ]);
  expect((await explodePlan('/p', 3, list)).at(-1)).toEqual({
    path: '/p/src/a/deep',
    parent: '/p/src/a',
  });
});
it('stops at the limit, and can include hidden folders', async () => {
  expect(await explodePlan('/p', 3, list, { limit: 3 })).toHaveLength(3);
  expect(
    (await explodePlan('/p', 1, list, { showHidden: true })).map((item) => item.path),
  ).toContain('/p/.git');
});
