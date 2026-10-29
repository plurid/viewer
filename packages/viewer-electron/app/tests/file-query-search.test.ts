/**
 * The file query language in the index and the walk: the index narrows in SQL and the
 * query decides each row, paging the matches; the search through subfolders reads only what it
 * must; both look up Finder tags before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileIndex } from '../src/desktop/search/index-core';
import { Search } from '../src/desktop/search/search';
import { entry } from '../src/desktop/files/filesystem';
import type { FileEntry, SearchBatch } from '../src/domain/contracts';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-file-query-');
});
afterEach(async () => {
  await trashTemporary(root);
});
const day = 86_400_000;

describe('the index', () => {
  const ingest = async (index: FileIndex) => {
    const base = await entry(root);
    const file = (name: string, extra: Partial<FileEntry> = {}): FileEntry => {
      const extension = name.split('.').pop()!;
      return {
        ...base,
        path: path.join(root, name),
        parent: root,
        name,
        extension,
        kind: 'file',
        directory: false,
        hidden: false,
        size: 100,
        modified: Date.now() - day,
        created: Date.now() - 400 * day,
        mime: extension === 'png' ? 'image/png' : 'application/octet-stream',
        ...extra,
      };
    };
    const files = [
      file('draft notes.md'),
      file('notes.md', { created: Date.now() - 2 * day }),
      file('Report.pdf', { size: 5 * 1024 ** 2 }),
      file('photo.png'),
      file('Viewer.app', { directory: true, extension: 'app', kind: 'directory' }),
      file('Projects', { directory: true, extension: '', kind: 'directory' }),
      ...Array.from({ length: 1200 }, (_, index) => file(`Record ${index}.txt`)),
    ];
    index.ingest(files, root);
  };
  const names = (index: FileIndex, query: string, extra = {}) =>
    index.query({ query, root, ...extra }).entries.map((item) => item.name);
  it('reads OR, -, kinds, created dates and patterns', async () => {
    const index = new FileIndex(':memory:');
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      await ingest(index);
      expect(names(index, 'ext:md OR ext:pdf')).toEqual([
        'draft notes.md',
        'notes.md',
        'Report.pdf',
      ]);
      expect(names(index, 'notes -draft')).toEqual(['notes.md']);
      expect(names(index, 'notes draft')).toEqual(['draft notes.md']);
      expect(names(index, 'kind:image')).toEqual(['photo.png']);
      expect(names(index, 'kind:folder')).toEqual(['Projects']);
      expect(names(index, 'size>1mb')).toEqual(['Report.pdf']);
      expect(names(index, 'created<7d')).toEqual(['notes.md']);
      expect(names(index, '~^rep')).toEqual(['Report.pdf']);
    } finally {
      await index.close();
    }
  });
  it('pages what the query decides, without repeating one', async () => {
    const index = new FileIndex(':memory:');
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      await ingest(index);
      const first = index.query({ query: 'record OR notes', root, limit: 500 });
      const second = index.query({ query: 'record OR notes', root, limit: 500, offset: 500 });
      expect(first.more).toBe(true);
      expect(new Set([...first.entries, ...second.entries].map((item) => item.path)).size).toBe(
        1000,
      );
    } finally {
      await index.close();
    }
  });
  it('asks the tags looked up for it', async () => {
    const index = new FileIndex(':memory:');
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      await ingest(index);
      expect(
        names(index, 'tag:red ext:md', { tagged: { red: [path.join(root, 'notes.md')] } }),
      ).toEqual(['notes.md']);
      expect(names(index, 'tag:red')).toEqual([]);
    } finally {
      await index.close();
    }
  });
  it('reports a bounded candidate scan without inventing another result page', async () => {
    const index = new FileIndex(':memory:');
    try {
      index.configure({ roots: [root], exclusions: [], contentRoots: [], paused: true });
      await index.settled();
      const base = await entry(root);
      index.ingest(
        Array.from({ length: 20001 }, (_, number) => ({
          ...base,
          name: `Item ${number}`,
          path: path.join(root, `Item ${number}`),
        })),
        root,
      );
      const found = index.query({ query: '~^absent', root });
      expect(found.entries).toEqual([]);
      expect(found.scanLimited).toBe(true);
      expect(found.more).toBe(false);
      expect(() => index.snapshot({ query: '~^absent', root })).toThrow();
    } finally {
      await index.close();
    }
    // indexing 20,001 names takes seconds, and longer while the whole suite runs
  }, 60_000);
});

describe('the search through subfolders', () => {
  it('reads terms, sizes needing a stat, and tags', async () => {
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'notes.md'), 'x'.repeat(2048));
    await writeFile(path.join(root, 'draft notes.md'), '');
    await writeFile(path.join(root, 'photo.png'), '');
    const run = async (query: string, tagged = async () => [] as string[]) => {
      const batches: SearchBatch[] = [];
      const search = new Search((batch) => batches.push(batch), null, tagged);
      search.start({ id: 'search', root, query, showHidden: false });
      await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
      await search.close();
      return batches
        .flatMap((batch) => batch.entries)
        .map((item) => item.name)
        .sort();
    };
    expect(await run('ext:md -draft')).toEqual(['notes.md']);
    expect(await run('size>1kb')).toEqual(['notes.md']);
    expect(await run('kind:folder')).toEqual(['nested']);
    expect(await run('tag:red', async () => [path.join(root, 'photo.png')])).toEqual(['photo.png']);
  });
  it('refuses a query that does not read, saying why', () => {
    const search = new Search(() => {}, null);
    expect(() =>
      search.start({ id: 'search', root, query: 'size>lots', showHidden: false }),
    ).toThrow(/size>10mb/);
  });
});
