import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { privateStage } from '../src/desktop/staging';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-staging-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('contains partial files in a private directory and removes its owned directory', async () => {
  const stage = await privateStage(root, '.viewer-transfer-');
  expect((await stat(path.dirname(stage.file))).mode & 0o777).toBe(0o700);
  await writeFile(stage.file, 'partial copy');
  await stage.dispose();
  expect(await stat(path.dirname(stage.file)).catch(() => undefined)).toBeUndefined();
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
