import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ownedDirectory, trashFixtureEntry, trashTemporary } from '../tools/temporary';

describe('owned test folders', () => {
  it('removes scenario entries inside an owned directory that temporaryRoot did not create', async () => {
    // Like an app container profile, this folder is created by the run but not by temporaryRoot.
    const directory = await ownedDirectory(
      path.join(os.tmpdir(), 'viewer-owned-' + crypto.randomUUID()),
    );
    const entry = path.join(directory, 'entry');
    await mkdir(entry);
    await writeFile(path.join(entry, 'generated.txt'), 'Generated fixture.');
    await trashFixtureEntry(entry);
    expect(existsSync(entry)).toBe(false);
    // Ownership is only ever taken by creating the folder.
    await expect(ownedDirectory(directory)).rejects.toMatchObject({ code: 'EEXIST' });
    await trashTemporary(directory);
  });
  it('refuses entries outside the folders this run owns', async () => {
    await expect(trashFixtureEntry(os.tmpdir())).rejects.toThrow('Refusing to remove');
    expect(existsSync(os.tmpdir())).toBe(true);
  });
});
