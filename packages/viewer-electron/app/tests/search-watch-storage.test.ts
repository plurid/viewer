import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SearchBatch, SavedState, DesktopEvent } from '../src/domain/contracts';
import { Search } from '../src/desktop/search';
import { Watchers } from '../src/desktop/watchers';
import { Storage } from '../src/desktop/storage';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-services-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('search, subscriptions and persistence', () => {
  it('streams subtree names, skips hidden paths, and avoids symlink cycles', async () => {
    await mkdir(path.join(root, 'nested'));
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, 'nested', 'Résumé.txt'), '');
    await writeFile(path.join(root, '.hidden', 'Résumé-secret.txt'), '');
    await symlink(root, path.join(root, 'nested', 'cycle'));
    const batches: SearchBatch[] = [];
    const search = new Search((batch) => batches.push(batch));
    search.start({ id: 'search', root, query: 'résumé', showHidden: false });
    await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
    expect(batches.flatMap((batch) => batch.entries).map((entry) => entry.name)).toEqual([
      'Résumé.txt',
    ]);
    search.close();
  });
  it('cancels a streaming search', async () => {
    const batches: SearchBatch[] = [];
    const search = new Search((batch) => {
      batches.push(batch);
      if (!batch.done) search.cancel('search');
    });
    for (let index = 0; index < 100; index++)
      await writeFile(path.join(root, `match-${index}`), '');
    search.start({ id: 'search', root, query: 'match', showHidden: false });
    await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
    expect(batches.flatMap((batch) => batch.entries).length).toBeLessThan(100);
  });
  it('shares folder watches, moves subscriptions, and closes the last subscriber', async () => {
    const events: DesktopEvent[] = [];
    const watchers = new Watchers((event) => events.push(event));
    const second = path.join(root, 'second');
    await mkdir(second);
    await watchers.add(root, 'one');
    await watchers.add(root, 'two');
    expect(watchers.count).toBe(1);
    await watchers.add(second, 'one');
    expect(watchers.count).toBe(2);
    await watchers.remove('two');
    expect(watchers.count).toBe(1);
    await watchers.remove('one');
    expect(watchers.count).toBe(0);
    await watchers.close();
  });
  it('does not resurrect subscriptions when rapid navigation overlaps unwatching', async () => {
    const watchers = new Watchers(() => undefined);
    const second = path.join(root, 'second');
    await mkdir(second);
    await watchers.add(root, 'plane');
    await Promise.all([watchers.add(second, 'plane'), watchers.remove('plane')]);
    expect(watchers.count).toBe(0);
    await watchers.close();
  });
  it('writes atomic versioned state and retains corrupted state as a backup', async () => {
    const storage = new Storage(path.join(root, 'state.json'));
    const state: SavedState = {
      version: 1,
      activeWorkspace: 'work',
      workspaces: [
        {
          id: 'work',
          name: 'Work',
          panes: [
            {
              id: 'folder',
              type: 'folder',
              path: root,
              mode: 'list',
              sort: 'name',
              descending: false,
              showHidden: false,
              history: [root],
              historyIndex: 0,
            },
          ],
          roots: ['folder'],
          arrangement: { engine: '{"camera":true}' },
        },
      ],
      favorites: [],
      recents: [],
      look: 'dark',
    };
    await Promise.all([storage.save(state), storage.save({ ...state, look: 'light' })]);
    expect((await storage.load()).state?.look).toBe('light');
    expect(JSON.parse(await readFile(storage.file, 'utf8')).version).toBe(1);
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await writeFile(storage.file, '{broken');
    const recovered = await storage.load();
    expect(recovered.state).toBeNull();
    expect(recovered.recovery).toContain('backup');
    expect((await readdir(root)).some((name) => name.includes('unreadable'))).toBe(true);
  });
});
