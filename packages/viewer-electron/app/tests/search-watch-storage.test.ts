import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { SearchBatch, SavedState, DesktopEvent } from '../src/domain/contracts';
import { Search } from '../src/desktop/search/search';
import { Watchers } from '../src/desktop/files/watchers';
import { Storage } from '../src/desktop/persistence/storage';
import { folderPane } from '../src/renderer/state/store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-services-');
});
afterEach(async () => {
  await trashTemporary(root);
});
describe('search, subscriptions and persistence', () => {
  const earlierState = (): SavedState => ({
    version: 1,
    activeWorkspace: 'work',
    workspaces: [
      {
        id: 'work',
        name: 'Work',
        panes: [folderPane(root, { visible: false, width: 270 })],
        roots: [],
        arrangement: { engine: '{"tree":"preserve"}' },
      },
    ],
    favorites: [{ name: 'Fixture', path: root }],
    recents: [root],
    look: 'dark',
  });
  it('backs up the exact pre-migration layout before saving, then preserves subsequent visibility', async () => {
    const storage = new Storage(path.join(root, 'state.json'));
    const original = earlierState();
    original.workspaces[0].roots = [original.workspaces[0].panes[0].id];
    const bytes = JSON.stringify(original, null, 2);
    await writeFile(storage.file, bytes);
    const loaded = (await storage.load()).state!;
    expect(await readFile(storage.file, 'utf8')).toBe(bytes);
    const backups = (await readdir(root)).filter((name) =>
      name.includes('before-plane-navigation-v3'),
    );
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(root, backups[0]), 'utf8')).toBe(bytes);
    expect((await stat(path.join(root, backups[0]))).mode & 0o777).toBe(0o600);
    expect(loaded.workspaces[0].panes[0]).toMatchObject({ sidebar: { visible: true, width: 270 } });
    expect(loaded.workspaces[0].arrangement).toEqual(original.workspaces[0].arrangement);
    const pane = loaded.workspaces[0].panes[0];
    if (pane.type !== 'folder') throw new Error('Expected folder');
    pane.sidebar!.visible = false;
    await storage.save(loaded);
    expect((await storage.load()).state!.workspaces[0].panes[0]).toMatchObject({
      sidebar: { visible: false },
    });
    expect(
      (await readdir(root)).filter((name) => name.includes('before-plane-navigation-v3')),
    ).toEqual(backups);
  });
  it('never treats a valid layout as corrupt when the required migration backup cannot be written', async () => {
    const storage = new Storage(path.join(root, 'state.json'));
    const original = JSON.stringify(earlierState());
    await writeFile(storage.file, original);
    await chmod(root, 0o500);
    try {
      await expect(storage.load()).rejects.toMatchObject({ code: 'EACCES' });
      expect(await readFile(storage.file, 'utf8')).toBe(original);
      expect(await readdir(root)).toEqual(['state.json']);
    } finally {
      await chmod(root, 0o700);
    }
  });
  it('streams subtree names, skips hidden paths, and avoids symlink cycles', async () => {
    await mkdir(path.join(root, 'nested'));
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, 'nested', 'Résumé.txt'), '');
    await writeFile(path.join(root, '.hidden', 'Résumé-secret.txt'), '');
    await symlink(root, path.join(root, 'nested', 'cycle'));
    const batches: SearchBatch[] = [];
    const search = new Search((batch) => batches.push(batch), null);
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
    }, null);
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
  it('refreshes shallow folders after writes, atomic replacement, rename and moving a file out', async () => {
    const file = path.join(root, 'Watched.txt');
    await writeFile(file, 'Initial');
    const events: DesktopEvent[] = [];
    const watchers = new Watchers((event) => events.push(event));
    const changes = () => events.filter((event) => event.type === 'folder-changed').length;
    await watchers.add(root, 'plane');
    try {
      await writeFile(file, 'Updated');
      await vi.waitFor(() => expect(changes()).toBeGreaterThan(0), { timeout: 5000 });
      let previous = changes();
      const temporary = file + '.tmp';
      await writeFile(temporary, 'Replacement');
      await rename(temporary, file);
      await vi.waitFor(() => expect(changes()).toBeGreaterThan(previous), { timeout: 5000 });
      previous = changes();
      const renamed = path.join(root, 'Renamed.txt');
      await rename(file, renamed);
      await vi.waitFor(() => expect(changes()).toBeGreaterThan(previous), { timeout: 5000 });
      previous = changes();
      const retained = await temporaryRoot('viewer-watch-retained-');
      await rename(renamed, path.join(retained, 'Retained.txt'));
      await vi.waitFor(() => expect(changes()).toBeGreaterThan(previous), { timeout: 5000 });
      expect(events.filter((event) => event.type === 'watch-error')).toEqual([]);
    } finally {
      await watchers.close();
    }
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
    // One damaged workspace no longer discards the others.
    const damaged = structuredClone(state.workspaces[0]);
    damaged.id = 'damaged';
    damaged.roots = ['missing-pane'];
    const mixed = {
      ...state,
      workspaces: [damaged, state.workspaces[0]],
      activeWorkspace: 'damaged',
    };
    await writeFile(storage.file, JSON.stringify(mixed));
    const salvaged = await storage.load();
    expect(salvaged.state?.workspaces.map((workspace) => workspace.id)).toEqual(['work']);
    expect(salvaged.state?.activeWorkspace).toBe('work');
    expect(salvaged.recovery).toContain('1 saved workspace was damaged');
    const kept = (await readdir(root)).filter((name) => name.includes('unreadable'));
    expect(kept).toHaveLength(2);
  });
});
describe('folder search with Spotlight', () => {
  it('shows Spotlight matches first, then completes the walk without repeating them', async () => {
    const folder = path.join(root, 'spotlight');
    await mkdir(path.join(folder, 'nested'), { recursive: true });
    await writeFile(path.join(folder, 'Report one.txt'), 'a');
    await writeFile(path.join(folder, 'nested', 'report two.txt'), 'b');
    await writeFile(path.join(folder, '.report hidden'), 'c');
    const batches: SearchBatch[] = [];
    const spotlight = vi.fn(async () => [
      path.join(folder, 'Report one.txt'),
      path.join(folder, '.report hidden'),
      '/elsewhere/report.txt',
      path.join(folder, 'unrelated.txt'),
    ]);
    const search = new Search((batch) => batches.push(batch), spotlight);
    search.start({ id: 'spot', root: folder, query: 'report', showHidden: false });
    await vi.waitFor(() => expect(batches.at(-1)?.done).toBe(true));
    const names = batches.flatMap((batch) => batch.entries.map((item) => item.name));
    expect(names[0]).toBe('Report one.txt');
    expect(names.toSorted()).toEqual(['Report one.txt', 'report two.txt']);
    await search.close();
  });
});
