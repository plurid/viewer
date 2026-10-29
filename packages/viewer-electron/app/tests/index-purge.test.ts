/**
 * The index counted its rows by testing every path against the exclusions: a second on 2.5
 * million rows, after every crawl flush, so previews in the same worker waited. Excluded rows are
 * now purged when the exclusions change, so the count needs the roots alone; and the purges, which
 * read every row, run only when the configuration they apply has changed.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileIndex } from '../src/desktop/search/index-core';
import { entry } from '../src/desktop/files/filesystem';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root = '';
beforeEach(async () => {
  root = await temporaryRoot('viewer-index-purge-');
  await mkdir(path.join(root, 'Files'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await trashTemporary(root);
});

const files = () => path.join(root, 'Files');
const search = (exclusions: string[] = []) => ({
  roots: [files()],
  exclusions,
  contentRoots: [],
  paused: true,
});
async function rows(index: FileIndex, names: string[]) {
  const base = await entry(files());
  index.ingest(
    names.map((name) => ({
      ...base,
      directory: false,
      kind: 'file' as const,
      name: path.basename(name),
      path: path.join(files(), name),
    })),
    files(),
  );
}
const found = (index: FileIndex, query: string) =>
  index.query({ query, root: files() }).entries.map((item) => path.relative(files(), item.path));

it('purges rows a new exclusion names, and counts by root alone', async () => {
  const index = new FileIndex(':memory:');
  try {
    index.configure(search());
    await index.settled();
    await rows(index, ['keep.txt', 'node_modules/left.js']);
    expect(index.status().count).toBe(2);
    index.configure(search(['node_modules']));
    await index.settled();
    expect(index.status().count).toBe(1);
    expect(found(index, 'left')).toEqual([]);
    expect(found(index, 'keep')).toEqual(['keep.txt']);
  } finally {
    await index.close();
  }
});

it('skips the purges when a reopened index is configured as it was', async () => {
  const database = path.join(root, 'index.sqlite');
  const prepared: string[] = [];
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    prepared.push(sql);
    return prepare.call(this, sql);
  });
  const purges = () => prepared.filter((sql) => sql.startsWith('DELETE FROM files WHERE')).length;

  const first = new FileIndex(database);
  first.configure(search());
  await first.settled();
  await first.close();
  expect(purges()).toBeGreaterThan(0);

  prepared.length = 0;
  const same = new FileIndex(database);
  same.configure(search());
  await same.settled();
  expect(purges()).toBe(0);
  // a changed configuration purges again
  same.configure(search(['generated']));
  await same.settled();
  expect(purges()).toBeGreaterThan(0);
  await same.close();
});
