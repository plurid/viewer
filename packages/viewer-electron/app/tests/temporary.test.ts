import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  keptManifest,
  ownedDirectory,
  temporaryRoot,
  trashFixtureEntry,
  trashTemporary,
} from '../tools/temporary';
import { removalBlocked } from './support/preservation';

describe('owned test folders', () => {
  it('removes scenario entries inside an owned directory that temporaryRoot did not create', async () => {
    // Like an app container profile, this folder is created by the run but not by temporaryRoot.
    const directory = await ownedDirectory(
      path.join(os.tmpdir(), 'viewer-owned-' + crypto.randomUUID()),
    );
    const entry = path.join(directory, 'entry');
    await mkdir(entry);
    await writeFile(path.join(entry, 'generated.txt'), 'Generated fixture.');
    if (removalBlocked('owned fixture-entry Trash', [entry])) {
      await expect(trashFixtureEntry(entry)).rejects.toMatchObject({
        code: 'TEST_REMOVAL_BLOCKED',
      });
      expect(readFileSync(path.join(entry, 'generated.txt'), 'utf8')).toBe('Generated fixture.');
    } else {
      await trashFixtureEntry(entry);
      expect(existsSync(entry)).toBe(false);
    }
    // Ownership is only ever taken by creating the folder.
    await expect(ownedDirectory(directory)).rejects.toMatchObject({ code: 'EEXIST' });
    await trashTemporary(directory);
  });
  it('refuses entries outside the folders this run owns', async () => {
    await expect(trashFixtureEntry(os.tmpdir())).rejects.toThrow(
      process.env.VIEWER_TEST_NO_REMOVAL === '1' ? 'removal is blocked' : 'Refusing to remove',
    );
    expect(existsSync(os.tmpdir())).toBe(true);
  });
});
describe('temporary test folders', () => {
  it('lists a folder kept by VIEWER_TEST_PRESERVE=1 once, whether or not its test cleans it up', async () => {
    // A folder a test made and never handed to `trashTemporary` (an extra root) was kept unlisted:
    // 657 of them in one session's runs.
    const previous = process.env.VIEWER_TEST_PRESERVE;
    process.env.VIEWER_TEST_PRESERVE = '1';
    try {
      const forgotten = await temporaryRoot('viewer-temporary-');
      const cleaned = await temporaryRoot('viewer-temporary-');
      await trashTemporary(cleaned);
      const lines = readFileSync(keptManifest, 'utf8').split('\n');
      expect(lines.filter((line) => line.includes('\t' + forgotten + '\t'))).toHaveLength(1);
      expect(lines.filter((line) => line.includes('\t' + cleaned + '\t'))).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.VIEWER_TEST_PRESERVE;
      else process.env.VIEWER_TEST_PRESERVE = previous;
    }
  });
});
