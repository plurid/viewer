/**
 * A rebuild trashes the previous build: Forge deletes `.vite` and its output folder before
 * writing new ones, which AGENTS.md forbids. Packaging first moves exactly those two to the Trash, and
 * stops rather than delete anything when the Trash fails.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { lstat, mkdir, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { trashPreviousBuild } from '../tools/trash-previous-build';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, trash: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-rebuild-');
  trash = path.join(root, 'trash');
  await mkdir(trash);
});
afterEach(async () => {
  await trashTemporary(root);
});
const app = () => path.join(root, 'app');
const toTrash = async (file: string) => {
  await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
};
const build = async () => {
  await mkdir(path.join(app(), '.vite', 'build'), { recursive: true });
  await writeFile(path.join(app(), '.vite', 'build', 'main.js'), 'main');
  await mkdir(path.join(app(), 'out', 'Viewer-darwin-arm64', 'Viewer.app'), { recursive: true });
  await mkdir(path.join(app(), 'out', 'notes'), { recursive: true });
};

it('moves the previous build to the Trash, and nothing else', async () => {
  await build();
  const moved = await trashPreviousBuild(app(), {
    platform: 'darwin',
    arch: 'arm64',
    trash: toTrash,
  });
  expect(moved).toEqual([
    path.join(app(), '.vite'),
    path.join(app(), 'out', 'Viewer-darwin-arm64'),
  ]);
  expect((await readdir(trash)).length).toBe(2);
  // other output stays, and the folders a build recreates are gone
  expect(await readdir(path.join(app(), 'out'))).toEqual(['notes']);
  await expect(lstat(path.join(app(), '.vite'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('does nothing when there is no previous build', async () => {
  await mkdir(app());
  expect(
    await trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', trash: toTrash }),
  ).toEqual([]);
});
it('refuses a link in place of a build folder, and moves nothing', async () => {
  await mkdir(path.join(root, 'elsewhere'), { recursive: true });
  await mkdir(app());
  await symlink(path.join(root, 'elsewhere'), path.join(app(), '.vite'));
  await expect(
    trashPreviousBuild(app(), { platform: 'darwin', arch: 'arm64', trash: toTrash }),
  ).rejects.toThrow('link');
  expect(await readdir(trash)).toEqual([]);
});
it('stops when the Trash fails, deleting nothing', async () => {
  await build();
  await expect(
    trashPreviousBuild(app(), {
      platform: 'darwin',
      arch: 'arm64',
      trash: async () => {
        throw new Error('Trash unavailable');
      },
    }),
  ).rejects.toThrow('Trash unavailable');
  expect((await lstat(path.join(app(), '.vite'))).isDirectory()).toBe(true);
  expect((await lstat(path.join(app(), 'out', 'Viewer-darwin-arm64'))).isDirectory()).toBe(true);
});
