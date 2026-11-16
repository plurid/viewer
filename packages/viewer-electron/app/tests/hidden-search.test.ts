import { expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, SearchBatch } from '../src/domain/contracts';
import type { CompletionSources } from '../src/renderer/command-line/complete';
import { defaultSettings } from '../src/domain/services';
import { fileVisibility } from '../src/desktop/files/visibility';
import { Search } from '../src/desktop/search/search';
import { FileIndex } from '../src/desktop/search/index-core';
import { lineCompletions } from '../src/renderer/command-line/complete';
import { temporaryRoot } from '../tools/temporary';

it('uses the same hidden ancestry in walks, Spotlight hits and the index', async () => {
  const root = await temporaryRoot('viewer-hidden-search-');
  const names = ['Visible/needle.txt', 'Flagged/Child/needle.txt', '.Dot/needle.txt', 'needle flagged.txt'];
  const files = names.map((name) => path.join(root, name));
  for (const file of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'fixture', { flag: 'wx' });
  }
  const flags = vi.spyOn(fileVisibility, 'hiddenEntries').mockImplementation(async (folder) =>
    folder === root ? ['Flagged', 'needle flagged.txt'] : [],
  );
  const single = vi.spyOn(fileVisibility, 'fileHidden');
  const index = new FileIndex(':memory:');
  const searches: Search[] = [];
  try {
    index.configure(defaultSettings(root).search);
    await index.settled();
    for (const showHidden of [false, true]) {
      for (const query of ['needle', 'needle is:hidden']) {
        const expected = files.filter((file, position) =>
          (showHidden || position === 0) && (!query.includes('is:hidden') || position !== 0),
        ).sort();
        const indexed = index.query({ root, query, showHidden }).entries;
        expect(indexed.map((item) => item.path).sort()).toEqual(expected);
        for (const spotlight of [null, async () => files]) {
          const batches: SearchBatch[] = [];
          const search = new Search((batch) => batches.push(batch), spotlight);
          searches.push(search);
          search.start({ id: 'visibility', root, query, showHidden });
          await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
          const entries = batches.flatMap((batch) => batch.entries);
          expect(entries.map((item) => item.path).sort()).toEqual(expected);
          expect(entries.filter((item) => item.path !== files[0]).every((item) => item.hidden)).toBe(true);
        }
      }
    }
    expect(single).not.toHaveBeenCalled();
  } finally {
    for (const search of searches) await search.close();
    await index.close();
    flags.mockRestore();
    single.mockRestore();
  }
});

it('completes flag-hidden system folders while keeping the existing dot-name rule', () => {
  const folder = (name: string, parent: string): FileEntry => ({
    name, parent, path: path.join(parent, name), directory: true, hidden: true,
    kind: 'directory', identity: '1:' + name, extension: '', mime: 'application/octet-stream',
    size: 0, created: 0, modified: 0,
  });
  const sources: CompletionSources = {
    commands: [], family: () => [], workspaces: [], value: () => undefined,
    places: { home: '/fixtures/Home', folder: '/' },
    listing: { directory: '/', entries: ['usr', 'tmp', 'Volumes', '.hidden'].map((name) => folder(name, '/')) },
  };
  for (const [text, expected] of [[':cd /u', ':cd /usr/'], [':cd /t', ':cd /tmp/'], [':cd /V', ':cd /Volumes/']])
    expect(lineCompletions(text!, sources).completions.map((item) => item.insert)).toContain(expected);
  expect(lineCompletions(':cd /', sources).completions.map((item) => item.label)).not.toContain('.hidden/');
  sources.listing = { directory: '/fixtures/Home', entries: [folder('Library', '/fixtures/Home')] };
  expect(lineCompletions(':cd ~/Li', sources).completions.map((item) => item.insert)).toEqual([':cd ~/Library/']);
});
