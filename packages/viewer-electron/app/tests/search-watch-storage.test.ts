import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SearchBatch, SavedState, DesktopEvent } from '../src/domain/contracts';
import { Search } from '../src/desktop/search';
import { Watchers } from '../src/desktop/watchers';
import { Storage } from '../src/desktop/storage';
import { folderPane } from '../src/renderer/state/store';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-services-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('search, subscriptions and persistence', () => {
  const legacyState = (): SavedState => ({
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
    const original = legacyState();
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
    const original = JSON.stringify(legacyState());
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
  it('refreshes shallow folders after file writes, atomic replacement, rename and deletion', async () => {
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
      await rm(renamed);
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
  });
});
