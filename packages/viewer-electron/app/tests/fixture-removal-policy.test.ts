import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { temporaryRoot, trashFixtureEntry } from '../tools/temporary';

afterEach(() => vi.unstubAllEnvs());

it('blocks parent-side fixture removal instead of moving an entry to a holding folder', async () => {
  vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '1');
  const root = await temporaryRoot('viewer-no-removal-fixture-');
  const file = path.join(root, 'Kept.txt');
  await writeFile(file, 'Keep this generated file in place.');
  await expect(trashFixtureEntry(file)).rejects.toMatchObject({
    code: 'TEST_REMOVAL_BLOCKED',
  });
  expect(await readFile(file, 'utf8')).toBe('Keep this generated file in place.');
});
