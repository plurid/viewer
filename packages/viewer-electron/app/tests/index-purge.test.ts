/**
 * The index counted its rows by testing every path against the exclusions: a second on 2.5
 * million rows, after every crawl flush, so previews in the same worker waited. Excluded rows are
 * now purged when the exclusions change, so the count needs the roots alone; and the purges, which
 * read every row, run only when the configuration they apply has changed.
 */
import { chmod, mkdir } from 'node:fs/promises';
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

it('compacts an existing database and keeps surviving names and passages on the same rows', async () => {
  const file = path.join(root, 'existing.db');
  const previous = new DatabaseSync(file);
  previous.exec('PRAGMA auto_vacuum=NONE; CREATE TABLE original_marker(n INTEGER)');
  previous.close();
  const index = new FileIndex(file);
  const config = { ...search(), contentRoots: [files()] };
  index.configure(config);
  await index.settled();
  await rows(
    index,
    Array.from({ length: 400 }, (_, i) => 'old/file-' + i),
  );
  const item = {
    ...(await entry(files())),
    name: 'Kept.txt',
    path: path.join(files(), 'Kept.txt'),
    directory: false,
  };
  index.put(item, files(), 1, 'passage marker');
  index.configure({ ...config, exclusions: ['old'] }, true);
  await index.settled();
  expect(index.query({ query: 'marker', content: true }).evidence?.[0]?.path).toBe(item.path);
  await index.close();
  const db = new DatabaseSync(file);
  try {
    expect(db.prepare('PRAGMA auto_vacuum').get()?.auto_vacuum).toBe(2);
  } finally {
    db.close();
  }
});

it('keeps searchable text and its passage without storing the full preview document', async () => {
  const index = new FileIndex(path.join(root, 'search.db'));
  const item = await entry(files());
  const extra = 'irrelevant preview data'.repeat(50000);
  index.put(item, files(), 1, {
    path: item.path,
    text: 'find this passage',
    evidence: [{ source: 'text', text: 'find this passage' }],
    metadata: { extra },
    truncated: false,
  });
  expect(index.query({ query: 'passage', content: true }).evidence?.[0]?.quote).toContain(
    'passage',
  );
  await index.close();
  const db = new DatabaseSync(path.join(root, 'search.db'));
  try {
    expect(db.prepare('SELECT length(document) AS n FROM source_documents').get()?.n).toBeLessThan(
      1024,
    );
  } finally {
    db.close();
  }
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
      extension: path.extname(name).slice(1),
      parent: path.dirname(path.join(files(), name)),
      path: path.join(files(), name),
    })),
    files(),
  );
}
const found = (index: FileIndex, query: string) =>
  index.query({ query, root: files() }).entries.map((item) => path.relative(files(), item.path));

it.each(['retained', 'retained-📚'])(
  'retains matches in narrowed root %s while paused and drops data outside it',
  async (folder) => {
    const index = new FileIndex(':memory:');
    try {
      await index.configure(search());
      await index.settled();
      await rows(index, [folder + '/keep.txt', 'outside.txt']);
      expect(index.query({ query: 'ext:txt' }).entries).toHaveLength(2);
      const narrower = path.join(files(), folder);
      await index.configure({ ...search(), roots: [narrower] });
      await index.settled();
      expect(index.query({ query: 'ext:txt' }).entries.map((item) => item.name)).toEqual([
        'keep.txt',
      ]);
      expect(index.status().count).toBe(1);
    } finally {
      await index.close();
    }
  },
);

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

it('prunes stale files beside an unreadable subtree and retains rows inside it', async () => {
  const blocked = path.join(files(), 'blocked');
  await mkdir(blocked, { mode: 0o000 });
  const index = new FileIndex(':memory:');
  try {
    await rows(index, ['gone.txt', 'blocked/kept.txt']);
    index.configure({ ...search(), paused: false }, true);
    await index.settled();
    expect(index.status().roots[0]?.errors).toBeGreaterThan(0);
    expect(found(index, 'gone')).toEqual([]);
    expect(found(index, 'kept')).toEqual(['blocked/kept.txt']);
  } finally {
    await index.close();
    await chmod(blocked, 0o700);
  }
});

it('returns unused database pages after a rebuild of a smaller scope', async () => {
  const database = path.join(root, 'index.sqlite');
  const index = new FileIndex(database);
  await rows(
    index,
    Array.from({ length: 3000 }, (_, i) => 'large-index-name-' + i + '.txt'),
  );
  index.configure({ ...search(), roots: [] }, true);
  await index.settled();
  await index.close();
  const db = new DatabaseSync(database);
  try {
    expect(db.prepare('PRAGMA freelist_count').get()?.freelist_count).toBeLessThan(16);
  } finally {
    db.close();
  }
});
