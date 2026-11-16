import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { entryWithVisibility as entry, list } from '../src/desktop/files/filesystem';
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

it('does not silently turn an unreadable flag into a visible file', async () => {
  const folder = await temporaryRoot('viewer-visibility-error-');
  const visibility = {
    hiddenEntries: vi.fn(async () => {
      throw new Error('Flag read failed');
    }),
    fileHidden: vi.fn(),
  };
  await expect(list(folder, visibility)).rejects.toThrow('Flag read failed');
});
