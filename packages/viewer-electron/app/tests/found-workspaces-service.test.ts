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
    facts: { pass: () => ({ relaunches: 0, exhausted: false }), probe },
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
  f.probe.mockClear();
  await f.service.run();
  expect(f.probe.mock.calls.length).toBeLessThanOrEqual(300);
  await f.service.recordRun(f.root, { source: 'package.json', name: 'dev', at: f.now });
  const text = await readFile(f.service.store.file, 'utf8');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_000_000);
  expect(JSON.parse(text).probes.length).toBeLessThanOrEqual(1000);
  expect(JSON.parse(text).lastRun).toEqual([
    { root: f.root, source: 'package.json', name: 'dev', at: f.now },
  ]);
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
  f.state.visits = { ...f.state.visits, [f.home + '/new/src']: { count: 3, last: f.now } };
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
    worker: () => ({ postMessage, message: vi.fn(), exit: vi.fn(), thread: { on: vi.fn(), terminate: vi.fn() } }) as unknown as OwnedWorker<FolderFactsReply>,
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
    return value.ok && f.roots.has(folder) ? { ...value, identity: { dev: 1n, ino: inode } } : value;
  });
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  const written = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(written.entries[0].identity).toBe('1:18446744073709551600:u64');
  expect(written.probes.find((item: { folder: string }) => item.folder === f.root).value.identity).toBe('1:18446744073709551600:u64');
  await f.service.close();
  const fresh = new FoundWorkspaces(f.directory, f.home, {
    facts: { pass: () => ({ relaunches: 0, exhausted: false }), probe: f.probe },
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
  expect(f.probe.mock.calls.every(([folder]) => folder === f.home + '/code' || folder.startsWith(f.home + '/code/'))).toBe(true);
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

it('keeps only two hundred run references and refuses command text fields', async () => {
  const f = await fixture();
  await f.service.load();
  const save = vi.spyOn(f.service.store, 'save').mockResolvedValue();
  for (let index = 0; index < 201; index++)
    await f.service.recordRun(f.root + index, {
      source: 'package.json',
      name: 'dev',
      at: f.now + index,
    });
  const last = save.mock.calls.at(-1)![0];
  expect(last.lastRun).toHaveLength(200);
  expect(last.lastRun[0]!.root).toBe(f.root + '200');
  await expect(
    f.service.recordRun(f.root, {
      source: 'package.json',
      name: 'dev',
      at: f.now,
      line: 'secret',
    } as never),
  ).rejects.toThrow();
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
