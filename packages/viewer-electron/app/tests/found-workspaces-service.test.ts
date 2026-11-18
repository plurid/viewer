import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FolderProbeResult } from '../src/domain/workspaces/folder-facts';
import type { FoundWorkspacePorts } from '../src/desktop/workspaces/found-workspaces';
import type { OwnedWorker } from '../src/desktop/workers/utility-client';
import type { FolderFactsReply } from '../src/domain/workspaces/folder-facts';
import { FolderFacts } from '../src/desktop/workspaces/folder-facts';
import { FoundWorkspaces } from '../src/desktop/workspaces/found-workspaces';
import { stateSchema } from '../src/desktop/persistence/storage';
import { temporaryRoot } from '../tools/temporary';
import { sampleWorkspace } from './workspace-definition-fixtures';

const services: FoundWorkspaces[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.useRealTimers();
});
async function fixture() {
  const directory = await temporaryRoot('viewer-found-');
  const home = path.join(directory, 'home');
  const root = home + '/code/sample';
  const roots = new Set([root]);
  const identities = new Map<string, bigint>();
  const missing = new Set<string>();
  let serial = 10n;
  let enabled = true;
  let now = 1_800_000_000_000;
  let scope: string | undefined;
  const retained = new Set<string>();
  const state = stateSchema.parse({
    version: 13,
    workspaces: [sampleWorkspace()],
    activeWorkspace: 'open',
    favorites: [],
    recents: [],
    look: 'dark',
    visits: { [root + '/src']: { count: 3, last: now } },
  });
  const probe = vi.fn(async (folder: string): Promise<FolderProbeResult> => {
    if (missing.has(folder)) return { ok: false, reason: 'missing' };
    if (!identities.has(folder)) identities.set(folder, serial++);
    return {
      ok: true,
      path: folder,
      identity: { dev: 1n, ino: identities.get(folder)! },
      markers: roots.has(folder) ? ['package.json'] : [],
      capped: false,
      package: roots.has(folder) ? { name: 'sample-site' } : undefined,
    };
  });
  const ports: FoundWorkspacePorts = {
    facts: {
      pass: () => ({ relaunches: 0, exhausted: false }),
      probe,
      identity: (folder) => probe.getMockImplementation()!(folder),
    },
    state: () => state,
    enabled: () => enabled,
    explicit: () => [],
    retained: (key) => retained.has(key),
    localVolumes: () => [],
    now: () => now,
    scopeRoot: () => scope,
    access: (folder) => !scope || folder === scope || folder.startsWith(scope + '/'),
  };
  const service = new FoundWorkspaces(directory, home, ports);
  services.push(service);
  return {
    directory,
    home,
    root,
    roots,
    identities,
    missing,
    ports,
    state,
    probe,
    service,
    retained,
    enabled: (value: boolean) => {
      enabled = value;
    },
    time: (value: number) => {
      now = value;
    },
    scope: (value: string) => {
      scope = value;
    },
    now,
  };
}

it('loads quietly and waits ten seconds after history preparation before probing', async () => {
  const f = await fixture();
  await f.service.load();
  expect(await readdir(f.directory)).toEqual([]);
  expect(f.probe).not.toHaveBeenCalled();
  vi.useFakeTimers();
  f.service.start();
  await vi.advanceTimersByTimeAsync(9999);
  expect(f.probe).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await f.service.run();
  expect(f.service.snapshot().definitions).toHaveLength(1);
  expect((await stat(f.service.store.file)).mode & 0o777).toBe(0o600);
});

it('requires evidence, bounds probes and persists no raw command text', async () => {
  const f = await fixture();
  f.state.visits = { [f.root]: { count: 2, last: f.now } };
  await f.service.run();
  expect(f.service.snapshot().definitions).toEqual([]);
  expect(await readdir(f.directory)).toEqual([]);
  f.state.visits = Object.fromEntries(
    Array.from({ length: 500 }, (_, index) => [
      f.home + '/projects/sample-' + index + '/src',
      { count: 3, last: f.now },
    ]),
  );
  f.state.visits[f.root] = { count: 30, last: f.now };
  f.probe.mockClear();
  await f.service.run();
  expect(f.probe.mock.calls.length).toBeLessThanOrEqual(300);
  const text = await readFile(f.service.store.file, 'utf8');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_000_000);
  expect(JSON.parse(text).probes.length).toBeLessThanOrEqual(1000);
  expect(JSON.parse(text)).not.toHaveProperty('lastRun');
  expect(text).not.toContain('command');
});

it('uses the probe cache for seven days, prunes it, and does not repeatedly probe known roots', async () => {
  const f = await fixture();
  await f.service.run();
  const count = f.probe.mock.calls.length;
  await f.service.run();
  expect(f.probe).toHaveBeenCalledTimes(count);
  f.time(f.now + 8 * 86_400_000);
  await f.service.run();
  expect(f.probe.mock.calls.length).toBeGreaterThan(count);
});

it('waits thirty seconds after a new visit and at least five minutes after the last pass', async () => {
  const f = await fixture();
  await f.service.load();
  vi.useFakeTimers();
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await f.service.run();
  const count = f.probe.mock.calls.length;
  f.state.visits = { ...f.state.visits, [f.home + '/new/src']: { count: 3, last: f.now + 1000 } };
  f.time(f.now + 1000);
  f.service.historyChanged();
  await vi.advanceTimersByTimeAsync(298_999);
  expect(f.probe).toHaveBeenCalledTimes(count);
  await vi.advanceTimersByTimeAsync(1);
  await f.service.run();
  expect(f.probe.mock.calls.length).toBeGreaterThan(count);
});

it('bounds never-answering probes, quarantines their volume and shuts down without waiting', async () => {
  const f = await fixture();
  const postMessage = vi.fn();
  const facts = new FolderFacts('unused', {
    worker: () =>
      ({
        postMessage,
        message: vi.fn(),
        exit: vi.fn(),
        thread: { on: vi.fn(), terminate: vi.fn(async () => 0) },
      }) as unknown as OwnedWorker<FolderFactsReply>,
  });
  f.ports.facts = facts;
  await f.service.load();
  vi.useFakeTimers();
  const running = f.service.run();
  await vi.advanceTimersByTimeAsync(151);
  await running;
  expect(postMessage).toHaveBeenCalledTimes(1);
  await f.service.run();
  expect(postMessage).toHaveBeenCalledTimes(1);
  await f.service.close();
  facts.close();
});

it('keeps keys through own moves and outside identity-preserving renames', async () => {
  const f = await fixture();
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  const moved = f.home + '/code/renamed';
  f.identities.set(moved, f.identities.get(f.root)!);
  await f.service.remap([{ source: f.root, destination: moved }]);
  expect(f.service.snapshot().definitions[0]).toMatchObject({ key, root: moved });
  f.roots.add(f.home + '/code/outside');
  f.identities.set(f.home + '/code/outside', f.identities.get(f.root)!);
  f.missing.add(moved);
  f.state.visits = { [f.home + '/code/outside/src']: { count: 3, last: f.now } };
  await f.service.run();
  expect(f.service.snapshot().definitions[0]).toMatchObject({
    key,
    root: f.home + '/code/outside',
  });
});

it('keeps exact large identities through persisted probes and outside renames', async () => {
  const f = await fixture();
  const inode = 18_446_744_073_709_551_600n;
  const original = f.probe.getMockImplementation()!;
  f.probe.mockImplementation(async (folder) => {
    const value = await original(folder);
    return value.ok && f.roots.has(folder)
      ? { ...value, identity: { dev: 1n, ino: inode } }
      : value;
  });
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  const written = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(written.entries[0].identity).toBe('1:18446744073709551600:u64');
  expect(
    written.probes.find((item: { folder: string }) => item.folder === f.root).value.identity,
  ).toBe('1:18446744073709551600:u64');
  await f.service.close();
  const fresh = new FoundWorkspaces(f.directory, f.home, {
    facts: f.ports.facts,
    state: () => f.state,
    enabled: () => true,
    explicit: () => [],
    retained: () => false,
    localVolumes: () => [],
    now: () => f.now,
  });
  services.push(fresh);
  f.probe.mockClear();
  await fresh.run();
  expect(f.probe).not.toHaveBeenCalled();
  const moved = f.home + '/code/renamed';
  f.roots.add(moved);
  f.missing.add(f.root);
  f.state.visits = { [moved + '/src']: { count: 3, last: f.now } };
  await fresh.run();
  expect(fresh.snapshot().definitions[0]).toMatchObject({ key, root: moved });
});

it('Clear preserves linked or remembered entries, and Undo rediscovers the same deterministic key', async () => {
  const f = await fixture();
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.retained.add(key);
  await f.service.clearHistory();
  expect(f.service.snapshot().definitions[0]!.key).toBe(key);
  expect(JSON.parse(await readFile(f.service.store.file, 'utf8')).probes).toEqual([]);
  f.retained.clear();
  await f.service.clearHistory();
  expect(f.service.snapshot().definitions).toEqual([]);
  await f.service.run();
  expect(f.service.snapshot().definitions[0]!.key).toBe(key);
});

it('turning the setting off rewrites entries and probes, keeping hidden roots', async () => {
  const f = await fixture();
  await f.service.run();
  const value = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  value.hidden = [f.home + '/hidden'];
  await writeFile(f.service.store.file, JSON.stringify(value));
  await f.service.close();
  const fresh = new FoundWorkspaces(f.directory, f.home, {
    facts: { pass: () => ({ relaunches: 0, exhausted: false }), probe: f.probe },
    state: () => f.state,
    enabled: () => false,
    explicit: () => [],
    retained: () => false,
    localVolumes: () => [],
  });
  services.push(fresh);
  await fresh.load();
  expect(fresh.snapshot().state).toMatchObject({ state: 'off', hidden: 1 });
  expect(JSON.parse(await readFile(fresh.store.file, 'utf8')).entries).toHaveLength(1);
  await fresh.run();
  const stored = JSON.parse(await readFile(fresh.store.file, 'utf8'));
  expect(stored.entries).toEqual([]);
  expect(stored.probes).toEqual([]);
  expect(stored.hidden).toEqual(value.hidden);
});

it('moves unreadable metadata aside and never creates metadata just for an empty pass', async () => {
  const f = await fixture();
  await writeFile(f.service.store.file, 'broken');
  await f.service.load();
  expect(await readFile(f.service.store.file, 'utf8')).toBe('broken');
  await f.service.run();
  expect(
    (await readdir(f.directory)).some((name) =>
      name.startsWith('found-workspaces-v1.json.unreadable-'),
    ),
  ).toBe(true);
  expect(f.service.recovery).toContain('kept aside');
});

it('Store probes borrow only the existing scope and include its root', async () => {
  const f = await fixture();
  f.scope(f.home + '/code');
  await f.service.run();
  expect(
    f.probe.mock.calls.every(
      ([folder]) => folder === f.home + '/code' || folder.startsWith(f.home + '/code/'),
    ),
  ).toBe(true);
  expect(f.service.snapshot().definitions).toHaveLength(1);
});

it('protects retained unreadable metadata instead of overwriting it', async () => {
  const f = await fixture();
  await mkdir(f.service.store.file);
  await f.service.load();
  await f.service.run();
  expect((await stat(f.service.store.file)).isDirectory()).toBe(true);
  expect(f.service.recovery).toContain('protected');
});

it('loads legacy run references without retaining them in found metadata', async () => {
  const f = await fixture();
  await writeFile(
    f.service.store.file,
    JSON.stringify({
      version: 1,
      entries: [],
      hidden: [],
      probes: [],
      lastRun: Array.from({ length: 200 }, (_, index) => ({
        root: f.root + index,
        source: 'package.json',
        name: 'dev',
        at: f.now,
      })),
    }),
  );
  await f.service.load();
  expect(f.service.recovery).toBeUndefined();
  await f.service.run();
  expect(JSON.parse(await readFile(f.service.store.file, 'utf8'))).not.toHaveProperty('lastRun');
});

it('trims large probe data to the one MB bound and preserves fixed markers', async () => {
  const f = await fixture();
  const original = f.probe.getMockImplementation()!;
  f.probe.mockImplementation(async (folder) => {
    const value = await original(folder);
    return value.ok
      ? {
          ...value,
          markers: [
            ...Array.from({ length: 150 }, (_, index) => 'b'.repeat(200) + index + '.xcodeproj'),
            ...value.markers,
          ],
        }
      : value;
  });
  f.state.visits = Object.fromEntries(
    Array.from({ length: 150 }, (_, index) => [
      f.root + '/packages/p' + index,
      { count: 3, last: f.now },
    ]),
  );
  await f.service.run();
  const text = await readFile(f.service.store.file, 'utf8');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_000_000);
  expect(JSON.parse(text).probes.length).toBeLessThan(150);
  expect(
    JSON.parse(text).probes.find((probe: { folder: string }) => probe.folder === f.root).value
      .markers,
  ).toContain('package.json');
});

it('Not a Workspace hides a root, and Undo brings back its entry and key after a pass', async () => {
  const f = await fixture();
  await f.service.run();
  const [definition] = f.service.snapshot().definitions;
  expect(definition!.root).toBe(f.root);
  const changed = vi.fn();
  f.service.subscribe(changed);
  await f.service.hide(f.root);
  expect(changed).toHaveBeenCalled();
  expect(f.service.snapshot().definitions).toEqual([]);
  expect(f.service.snapshot().state.hidden).toBe(1);
  expect(JSON.parse(await readFile(f.service.store.file, 'utf8')).hidden).toEqual([f.root]);
  // a pass looks past the hidden root: its entry goes
  await f.service.run();
  expect(JSON.parse(await readFile(f.service.store.file, 'utf8')).entries).toEqual([]);
  await f.service.show([f.root]);
  expect(f.service.snapshot().definitions.map((item) => item.key)).toEqual([definition!.key]);
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(stored.hidden).toEqual([]);
  expect(stored.entries.map((entry: { key: string }) => entry.key)).toEqual([definition!.key]);
});

it('keeps hidden roots through Clear recent folders until every one is shown again', async () => {
  const f = await fixture();
  await f.service.run();
  await f.service.hide(f.root);
  await f.service.hide(f.home + '/code/other');
  await f.service.clearHistory();
  expect(f.service.snapshot().state.hidden).toBe(2);
  await f.service.show();
  expect(f.service.snapshot().state.hidden).toBe(0);
  // the hidden entry was evidence from the cleared history: a later pass finds it again
  expect(f.service.snapshot().definitions).toEqual([]);
  await f.service.run();
  expect(f.service.snapshot().definitions.map((item) => item.root)).toEqual([f.root]);
});

it('caps hidden roots at 500, dropping the oldest', async () => {
  const f = await fixture();
  const hidden = Array.from({ length: 500 }, (_, index) => f.home + '/code/hidden-' + index);
  await writeFile(
    f.service.store.file,
    JSON.stringify({ version: 1, entries: [], hidden, probes: [] }),
  );
  await f.service.hide(f.home + '/code/hidden-500');
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(stored.hidden).toHaveLength(500);
  expect(stored.hidden[0]).toBe(f.home + '/code/hidden-1');
  expect(stored.hidden.at(-1)).toBe(f.home + '/code/hidden-500');
});

/** Holds every probe of the next pass until `release()`. */
function holdProbes(f: Awaited<ReturnType<typeof fixture>>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const original = f.probe.getMockImplementation()!;
  let held = 0;
  f.probe.mockImplementation(async (folder: string) => {
    held++;
    await gate;
    return original(folder);
  });
  return { release, held: () => held };
}
const stored = async (f: Awaited<ReturnType<typeof fixture>>) =>
  JSON.parse(await readFile(f.service.store.file, 'utf8')) as {
    entries: { key: string; root: string }[];
    hidden: string[];
  };

it('keeps an entry Undo put back while a pass ran, and never after Clear or finding off', async () => {
  // Undo during a pass: the pass decided without the root, yet its entry stays
  const kept = await fixture();
  await kept.service.run();
  const [definition] = kept.service.snapshot().definitions;
  await kept.service.hide(kept.root);
  const gate = holdProbes(kept);
  const pass = kept.service.run();
  await vi.waitFor(() => expect(gate.held()).toBeGreaterThan(0));
  expect(await kept.service.show([kept.root])).toBe(1);
  gate.release();
  await pass;
  expect(kept.service.snapshot().definitions.map((item) => item.key)).toEqual([definition!.key]);
  expect((await stored(kept)).entries.map((entry) => entry.key)).toEqual([definition!.key]);
  // Undo, then Clear recent folders or finding off, while a pass runs: nothing comes back
  for (const after of ['clear', 'off'] as const) {
    const f = await fixture();
    await f.service.run();
    await f.service.hide(f.root);
    const held = holdProbes(f);
    const running = f.service.run();
    await vi.waitFor(() => expect(held.held()).toBeGreaterThan(0));
    await f.service.show([f.root]);
    if (after === 'clear') await f.service.clearHistory();
    else {
      f.enabled(false);
      await f.service.configure();
    }
    held.release();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await stored(f)).entries, after).toEqual([]);
  }
});

it('hides a root once, shows only the roots asked for, and Undo of Show all hides them again', async () => {
  const f = await fixture();
  await f.service.run();
  const other = f.home + '/code/other';
  await f.service.hide(f.root);
  await f.service.hide(f.root);
  await f.service.hide(other);
  expect((await stored(f)).hidden).toEqual([f.root, other]);
  expect(await f.service.show([other])).toBe(1);
  expect((await stored(f)).hidden).toEqual([f.root]);
  expect(await f.service.show([other])).toBe(0);
  await f.service.hide(other);
  expect(await f.service.show()).toBe(2);
  expect(f.service.snapshot().state.hidden).toBe(0);
  expect(await f.service.hideAgain()).toBe(2);
  expect((await stored(f)).hidden).toEqual([f.root, other]);
  expect(f.service.snapshot().definitions).toEqual([]);
  // Undo applies once
  expect(await f.service.hideAgain()).toBe(0);
});

it('forgets the entry kept for Undo when finding is turned off', async () => {
  const f = await fixture();
  await f.service.run();
  await f.service.hide(f.root);
  f.enabled(false);
  await f.service.configure();
  f.enabled(true);
  await f.service.configure();
  await f.service.show([f.root]);
  // the hidden list empties; the entry, evidence from history, is not put back
  expect((await stored(f)).hidden).toEqual([]);
  expect((await stored(f)).entries).toEqual([]);
});

it('follows a root Viewer moved within the Undo time', async () => {
  const f = await fixture();
  await f.service.run();
  const [definition] = f.service.snapshot().definitions;
  await f.service.hide(f.root);
  const moved = f.home + '/code/renamed';
  await f.service.remap([{ source: f.root, destination: moved }]);
  // Manage's Undo sends the root as it hid it
  expect(await f.service.show([f.root])).toBe(1);
  expect(f.service.snapshot().state.hidden).toBe(0);
  expect(f.service.snapshot().definitions.map((item) => [item.key, item.root])).toEqual([
    [definition!.key, moved],
  ]);
});

it('runs a pass after hiding, so roots inside a hidden one can be found', async () => {
  const f = await fixture();
  await f.service.run();
  vi.useFakeTimers();
  f.service.start();
  // the first pass of start, then the one hiding asks for, five minutes after the last
  await vi.advanceTimersByTimeAsync(10_000);
  const run = vi.spyOn(f.service, 'run');
  await f.service.hide(f.root);
  await vi.advanceTimersByTimeAsync(299_000);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(run).toHaveBeenCalledOnce();
});

it('gives way the oldest hidden roots, and says so, when they would pass 1 MB', async () => {
  const f = await fixture();
  const long = (index: number) => f.home + '/' + 'x'.repeat(2900) + '/' + index;
  const hidden = Array.from({ length: 345 }, (_, index) => long(index));
  await writeFile(
    f.service.store.file,
    JSON.stringify({ version: 1, entries: [], hidden: hidden.slice(0, 320), probes: [] }),
  );
  await f.service.load();
  for (const root of hidden.slice(320)) await f.service.hide(root);
  const text = await readFile(f.service.store.file, 'utf8');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_000_000);
  const saved = JSON.parse(text).hidden as string[];
  expect(saved.at(-1)).toBe(hidden[344]);
  expect(saved[0]).not.toBe(hidden[0]);
  // each hide past the limit gives way one more
  expect(f.service.recovery).toBe(
    'Found workspaces reached their 1 MB limit, so the oldest hidden folder shows again.',
  );
});

it('never puts back an entry Clear recent folders forgot', async () => {
  const f = await fixture();
  await f.service.run();
  await f.service.hide(f.root);
  await f.service.clearHistory();
  expect(await f.service.show([f.root])).toBe(1);
  expect(f.service.snapshot().definitions).toEqual([]);
  expect((await stored(f)).entries).toEqual([]);
});

it('drops the entry Undo kept for a pass that a move cancelled', async () => {
  const f = await fixture();
  await f.service.run();
  await f.service.hide(f.root);
  const gate = holdProbes(f);
  const pass = f.service.run();
  await vi.waitFor(() => expect(gate.held()).toBeGreaterThan(0));
  await f.service.show([f.root]);
  // a Viewer move cancels that pass; the folder is then no longer one the person uses
  await f.service.remap([{ source: f.root + '/src', destination: f.root + '/lib' }]);
  gate.release();
  await pass;
  f.state.visits = {};
  await f.service.run();
  // the next pass decides with everything known: no evidence, no entry
  expect((await stored(f)).entries).toEqual([]);
});

it('Undo of Show all hides them again beside a Not a Workspace made since, older first', async () => {
  const f = await fixture();
  await f.service.run();
  const other = f.home + '/code/other';
  const later = f.home + '/code/later';
  await f.service.hide(f.root);
  await f.service.hide(other);
  expect(await f.service.show()).toBe(2);
  // within Settings' eight seconds the person hides another one in Manage
  await f.service.hide(later);
  expect(await f.service.hideAgain()).toBe(2);
  expect((await stored(f)).hidden).toEqual([f.root, other, later]);
});

it('Undo of Show all follows a root Viewer moved meanwhile', async () => {
  const f = await fixture();
  await f.service.run();
  await f.service.hide(f.root);
  expect(await f.service.show()).toBe(1);
  const moved = f.home + '/code/renamed';
  await f.service.remap([{ source: f.root, destination: moved }]);
  expect(await f.service.hideAgain()).toBe(1);
  expect((await stored(f)).hidden).toEqual([moved]);
});

it('drops the entry Undo kept once the pass it ran in has finished', async () => {
  const f = await fixture();
  await f.service.run();
  await f.service.hide(f.root);
  // the next pass decides without the root and saves; Undo comes while that save is under way
  let release!: () => void;
  const saving = new Promise<void>((resolve) => (release = resolve));
  const save = f.service.store.save.bind(f.service.store);
  const held = vi.spyOn(f.service.store, 'save').mockImplementationOnce(async (value) => {
    await saving;
    return save(value);
  });
  const pass = f.service.run();
  await vi.waitFor(() => expect(held).toHaveBeenCalled());
  const shown = f.service.show([f.root]);
  release();
  await Promise.all([pass, shown]);
  // a later pass that finds no evidence leaves no entry
  f.state.visits = {};
  await f.service.run();
  expect((await stored(f)).entries).toEqual([]);
});
