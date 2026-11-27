import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SearchBatch } from '../src/domain/contracts';
import { entry } from '../src/desktop/files/filesystem';
import { parseFileQuery, matchesQuery, queryTypes } from '../src/domain/search/query';
import { Search } from '../src/desktop/search/search';
import { temporaryRoot } from '../tools/temporary';

function runSearch(
  root: string,
  query: string,
  tagged: (root: string, tag: string, signal: AbortSignal) => Promise<string[]> = async () => [],
): Promise<{ batches: SearchBatch[]; paths: string[] }> {
  return new Promise((resolve) => {
    const batches: SearchBatch[] = [];
    const paths: string[] = [];
    const search = new Search(
      (batch) => {
        batches.push(batch);
        for (const item of batch.entries) paths.push(item.path);
        if (batch.done) resolve({ batches, paths });
      },
      null,
      tagged,
    );
    search.start({ id: 'q1', root, query, showHidden: false });
  });
}

describe('live search file kinds', () => {
  it('finds a real PDF for kind:document and a real folder for kind:folder', async () => {
    const root = await temporaryRoot('viewer-probe-search-ctrl-');
    await writeFile(path.join(root, 'notes.pdf'), 'pdf');
    await mkdir(path.join(root, 'proj'));
    const docs = await runSearch(root, 'kind:document');
    expect(docs.paths).toContain(path.join(root, 'notes.pdf'));
    const folders = await runSearch(root, 'kind:folder');
    expect(folders.paths).toContain(path.join(root, 'proj'));
  });

  it('excludes a 2 KB .key file from kind:document in live scan', async () => {
    const root = await temporaryRoot('viewer-probe-search-key-');
    await writeFile(path.join(root, 'server.key'), 'k'.repeat(2048));
    const docs = await runSearch(root, 'kind:document');
    expect(docs.paths).not.toContain(path.join(root, 'server.key'));
  });

  it('matches a symlink pointing to a folder under kind:folder and excludes it from kind:file', async () => {
    const root = await temporaryRoot('viewer-probe-search-link-');
    const target = path.join(root, 'proj');
    await mkdir(target);
    const link = path.join(root, 'proj-link');
    await symlink(target, link);
    const folders = await runSearch(root, 'kind:folder');
    const files = await runSearch(root, 'kind:file');
    expect(folders.paths).toContain(link);
    expect(files.paths).not.toContain(link);
  });
});

it('reports a Finder tag lookup failure in the final batch', async () => {
  const root = await temporaryRoot('viewer-live-tags-');
  const { batches } = await runSearch(root, 'tag:review', async () => {
    throw new Error('Spotlight unavailable');
  });
  expect(batches.at(-1)).toMatchObject({ done: true, error: expect.stringContaining('Spotlight') });
});

it('agrees with full metadata for positive and negated file kinds', async () => {
  const root = await temporaryRoot('viewer-search-kinds-');
  const names = ['short.key', 'large.key', 'report.pdf', 'folder', 'link'];
  await writeFile(path.join(root, names[0]!), 'x');
  await writeFile(path.join(root, names[1]!), 'x'.repeat(20000));
  await writeFile(path.join(root, names[2]!), '');
  await mkdir(path.join(root, 'folder'));
  await symlink(path.join(root, 'folder'), path.join(root, 'link'));
  const entries = await Promise.all(names.map((name) => entry(path.join(root, name))));
  for (const kind of queryTypes)
    for (const prefix of ['', '-']) {
      const query = prefix + 'kind:' + kind;
      const expected = entries
        .filter((item) => matchesQuery(parseFileQuery(query), item))
        .map((item) => item.path)
        .sort();
      expect((await runSearch(root, query)).paths.sort(), query).toEqual(expected);
    }
});
