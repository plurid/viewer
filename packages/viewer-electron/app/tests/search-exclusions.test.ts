import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SearchBatch } from '../src/domain/contracts';
import { defaultSettings } from '../src/domain/services';
import { searchExclusions } from '../src/desktop/search/exclusions';
import { Search } from '../src/desktop/search/search';
import { FileIndex } from '../src/desktop/search/index-core';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const fixtures: string[] = [];
afterEach(async () => {
  for (const root of fixtures.splice(0)) await trashTemporary(root);
});

it('matches exact names and normalized full subtrees without excluding similar names', () => {
  const excluded = searchExclusions(['node_modules', '.venv', '/project/private/']);
  for (const file of [
    '/project/node_modules',
    '/project/node_modules/a/b',
    '/project/.venv/lib',
    '/project/private',
    '/project/private/file',
  ])
    expect(excluded(file), file).toBe(true);
  for (const file of [
    '/project/node_modules-notes/file',
    '/project/private-other/file',
    '/project/readme.md',
  ])
    expect(excluded(file), file).toBe(false);
  expect(searchExclusions(['/'])('/any/file')).toBe(true);
});

it('prunes dependencies before reading them in streamed and indexed content search', async () => {
  const root = await temporaryRoot('viewer-search-exclusions-');
  fixtures.push(root);
  const settings = defaultSettings(root).search;
  settings.contentRoots = [root];
  const hidden = ['node_modules', '.venv', 'venv', '__pycache__', '.next'];
  for (const folder of [...hidden, 'source', 'private', 'private-other']) {
    await mkdir(path.join(root, folder, 'nested'), { recursive: true });
    await writeFile(path.join(root, folder, 'nested', 'needle.txt'), 'needle in contents');
  }
  settings.exclusions.push(path.join(root, 'private') + path.sep);
  const batches: SearchBatch[] = [];
  const authorize = vi.fn(async (_file: string) => {});
  const spotlight = vi.fn(async () => [
    path.join(root, 'node_modules', 'nested', 'needle.txt'),
    path.join(root, 'private', 'nested', 'needle.txt'),
    path.join(root, 'source', 'nested', 'needle.txt'),
  ]);
  const search = new Search(
    (batch) => batches.push(batch),
    spotlight,
    undefined,
    authorize,
    () => settings.exclusions,
  );
  const extracted: string[] = [];
  const index = new FileIndex(':memory:', undefined, async (file) => {
    extracted.push(file);
    return 'needle in contents';
  });
  const expected = [
    path.join(root, 'private-other', 'nested', 'needle.txt'),
    path.join(root, 'source', 'nested', 'needle.txt'),
  ].sort();
  try {
    search.start({ id: 'first', root, query: 'needle', showHidden: true });
    await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
    expect(batches.flatMap((batch) => batch.entries.map((item) => item.path)).sort()).toEqual(
      expected,
    );
    expect(
      authorize.mock.calls.some(
        ([file]) =>
          hidden.some((folder) => file.split(path.sep).includes(folder)) ||
          file.startsWith(path.join(root, 'private') + path.sep),
      ),
    ).toBe(false);
    index.configure(settings);
    await index.settled();
    expect(extracted.sort()).toEqual(expected);
    expect(
      index
        .query({ root, query: 'needle', content: true, showHidden: true })
        .entries.map((item) => item.path)
        .sort(),
    ).toEqual(expected);
    // An explicit empty list enables these folders again, including hidden environments.
    settings.exclusions = [];
    batches.length = 0;
    search.start({ id: 'second', root, query: 'needle', showHidden: true });
    await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
    expect(batches.flatMap((batch) => batch.entries)).toHaveLength(hidden.length + 3);
  } finally {
    await search.close();
    await index.close();
  }
});
