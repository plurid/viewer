import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { privateStage } from '../src/desktop/operations/staging';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-staging-');
});
afterEach(async () => {
  await trashTemporary(root);
});
it('removes an emptied private directory after publication', async () => {
  const stage = await privateStage(root, '.viewer-transfer-');
  expect((await stat(path.dirname(stage.file))).mode & 0o777).toBe(0o700);
  await writeFile(stage.file, 'published copy');
  await rename(stage.file, path.join(root, 'Published.txt'));
  expect(await stage.dispose()).toBeUndefined();
  expect(await readdir(root)).toEqual(['Published.txt']);
});
it('moves partial content to the Trash instead of deleting it', async () => {
  const bin = path.join(root, 'Trash');
  await mkdir(bin);
  const trashed: string[] = [];
  const stage = await privateStage(root, '.viewer-transfer-', async (file) => {
    trashed.push(file);
    await rename(file, path.join(bin, path.basename(file)));
  });
  await writeFile(stage.file, 'partial copy');
  expect(await stage.dispose()).toBeUndefined();
  expect(trashed).toHaveLength(1);
  expect(path.basename(trashed[0])).toMatch(/^Viewer incomplete transfer /);
  expect(await readFile(path.join(bin, path.basename(trashed[0]), 'item'), 'utf8')).toBe(
    'partial copy',
  );
  expect(await readdir(root)).toEqual(['Trash']);
});
it('keeps partial content and reports it when no Trash can take it', async () => {
  for (const trash of [undefined, async () => undefined]) {
    const stage = await privateStage(root, '.viewer-transfer-', trash);
    await writeFile(stage.file, 'partial copy');
    const kept = await stage.dispose();
    expect(kept).toBeDefined();
    expect(await readFile(path.join(kept!, 'item'), 'utf8')).toBe('partial copy');
  }
});
it('preserves a replacement at the temporary path instead of deleting its unrelated data', async () => {
  const stage = await privateStage(root, '.viewer-transfer-');
  const directory = path.dirname(stage.file);
  await rename(directory, directory + '-original');
  await mkdir(directory);
  await writeFile(path.join(directory, 'User data.txt'), 'must remain');
  await expect(stage.dispose()).rejects.toThrow('location changed');
  expect(await readFile(path.join(directory, 'User data.txt'), 'utf8')).toBe('must remain');
});
