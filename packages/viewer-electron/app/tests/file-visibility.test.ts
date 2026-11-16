import { expect, it, vi } from 'vitest';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  entry as ordinaryEntry,
  entryForScan,
  entryWithVisibility as entry,
  list,
} from '../src/desktop/files/filesystem';
import { createFileVisibility, fileVisibility } from '../src/desktop/files/visibility';
import { temporaryRoot } from '../tools/temporary';

it('reads flags once for the folder and keeps dot files and flagged files hidden, without name patterns', async () => {
  const folder = await temporaryRoot('viewer-visibility-');
  for (const name of ['desktop.ini', 'Thumbs.db', '.dot-file', 'hidden.txt'])
    await writeFile(path.join(folder, name), 'fixture');
  const visibility = {
    hiddenEntries: vi.fn(async () => ['desktop.ini', 'hidden.txt']),
    fileHidden: vi.fn(async () => true),
  };
  const listing = await list(folder, visibility);
  expect(visibility.hiddenEntries).toHaveBeenCalledExactlyOnceWith(folder);
  expect(visibility.fileHidden).not.toHaveBeenCalled();
  expect(
    listing.entries
      .filter((item) => item.hidden)
      .map((item) => item.name)
      .sort(),
  ).toEqual(['.dot-file', 'desktop.ini', 'hidden.txt']);
  expect(listing.entries.find((item) => item.name === 'Thumbs.db')?.hidden).toBe(false);
  expect((await entry(path.join(folder, 'hidden.txt'), visibility)).hidden).toBe(true);
  expect(visibility.fileHidden).toHaveBeenCalledExactlyOnceWith(path.join(folder, 'hidden.txt'));
});

it('lists with an old or missing helper, reads single-item flags and keeps them out of scans', async () => {
  const folder = await temporaryRoot('viewer-visibility-compatibility-');
  const file = path.join(folder, 'visible.txt');
  await writeFile(file, 'fixture');
  for (const binding of [
    () => ({}),
    () => {
      throw new Error('No helper');
    },
  ]) {
    expect((await list(folder, createFileVisibility(binding))).entries).toHaveLength(1);
  }
  const native = vi.spyOn(fileVisibility, 'fileHidden').mockResolvedValue(true);
  for (let index = 0; index < 20; index++)
    expect((await entryForScan(file)).name).toBe('visible.txt');
  expect(native).not.toHaveBeenCalled();
  expect((await ordinaryEntry(file)).hidden).toBe(true);
  expect(native).toHaveBeenCalledExactlyOnceWith(file);
  native.mockRestore();
});

it('keeps the listing permission code when optional flags fail earlier', async () => {
  const folder = await temporaryRoot('viewer-visibility-denied-');
  await chmod(folder, 0);
  try {
    await expect(
      list(folder, {
        hiddenEntries: async () => {
          throw Object.assign(new Error('flags'), { code: 'EIO' });
        },
        fileHidden: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'EACCES' });
  } finally {
    await chmod(folder, 0o700);
  }
});

it('keeps a readable listing when its optional flag read fails', async () => {
  const folder = await temporaryRoot('viewer-visibility-error-');
  const visibility = {
    hiddenEntries: vi.fn(async () => {
      throw new Error('Flag read failed');
    }),
    fileHidden: vi.fn(),
  };
  await writeFile(path.join(folder, 'visible.txt'), 'fixture');
  await writeFile(path.join(folder, '.dot-file'), 'fixture');
  const listing = await list(folder, visibility);
  expect(listing.entries.find((item) => item.name === 'visible.txt')?.hidden).toBe(false);
  expect(listing.entries.find((item) => item.name === '.dot-file')?.hidden).toBe(true);
});
