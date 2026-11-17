import { afterEach, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FolderProbeResult, FolderGitMarker } from '../src/domain/workspaces/folder-facts';
import type { WorkspaceDefinition } from '../src/domain/workspaces/definitions/schema';
import { FoundWorkspaces } from '../src/desktop/workspaces/found-workspaces';
import { stateSchema } from '../src/desktop/persistence/storage';
import { temporaryRoot } from '../tools/temporary';
import { sampleWorkspace } from './workspace-definition-fixtures';
import { rekeyFoundLinks } from '../src/domain/workspaces/catalog';
import { foundKey } from '../src/domain/workspaces/found/keys';
import { probeFoundFolders } from '../src/desktop/workspaces/found-probes';

const services: FoundWorkspaces[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.useRealTimers();
});

interface Folder {
  markers: string[];
  git?: FolderGitMarker;
  ino: bigint;
  missing?: boolean;
  fail?: 'timeout' | 'quarantined';
}

async function fixture() {
  const directory = await temporaryRoot('viewer-found-recheck-');
  const home = path.join(directory, 'home');
  const folders = new Map<string, Folder>();
  let serial = 1000n;
  const folderFor = (folder: string): Folder => {
    let value = folders.get(folder);
    if (!value) {
      value = { markers: [], ino: serial++ };
      folders.set(folder, value);
    }
    return value;
  };
  let now = 1_800_000_000_000;
  const retained = new Set<string>();
  let explicit: WorkspaceDefinition[] = [];
  const state = stateSchema.parse({
    version: 13,
    workspaces: [sampleWorkspace()],
    activeWorkspace: 'open',
    favorites: [],
    recents: [],
    look: 'dark',
    visits: {},
  });
  let exhaustAfter = Infinity;
  let calls = 0;
  const probe = vi.fn(
    async (folder: string, pass = { exhausted: false }): Promise<FolderProbeResult> => {
      calls++;
      if (calls >= exhaustAfter) pass.exhausted = true;
      const value = folderFor(folder);
      if (value.fail) return { ok: false, reason: value.fail };
      if (value.missing) return { ok: false, reason: 'missing' };
      return {
        ok: true,
        path: folder,
        identity: { dev: 1n, ino: value.ino },
        markers: value.markers,
        capped: false,
        git: value.git,
        package: value.markers.includes('package.json')
          ? { name: path.basename(folder) }
          : undefined,
      };
    },
  );
  const rekey = vi.fn(async () => {});
  const ports = {
    facts: { pass: () => ({ relaunches: 0, exhausted: false }), probe },
    state: () => state,
    enabled: () => true,
    explicit: () => explicit,
    retained: (key: string) => retained.has(key),
    keepOnClear: (key: string) => retained.has(key),
    rekey,
    localVolumes: () => [],
    nonLocalRoots: () => [],
    now: () => now,
  };
  const service = new FoundWorkspaces(directory, home, ports);
  services.push(service);
  return {
    directory,
    home,
    folders,
    folderFor,
    state,
    probe,
    rekey,
    service,
    retained,
    ports,
    setExplicit: (value: WorkspaceDefinition[]) => {
      explicit = value;
    },
    exhaust: (count: number) => {
      calls = 0;
      exhaustAfter = count;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}
const keys = (service: FoundWorkspaces) =>
  Object.fromEntries(
    service.snapshot().definitions.map((item) => [item.root.replace(/^.*\/home/, '~'), item.key]),
  );

it('R1a an incomplete pass carries an established monorepo with its key', async () => {
  const f = await fixture();
  const mono = f.home + '/code/mono';
  const web = mono + '/packages/web';
  f.folderFor(mono).git = 'directory';
  f.folderFor(mono).markers = ['.git'];
  f.folderFor(web).markers = ['package.json'];
  f.state.visits = { [web + '/src']: { count: 5, last: f.now } };
  await f.service.run();
  const first = keys(f.service);
  // a week later the monorepo root cannot be read (FolderFacts quarantined the volume)
  f.advance(8 * 86_400_000);
  f.state.visits[web + '/src']!.last = f.now;
  f.folderFor(mono).fail = 'quarantined';
  await f.service.run();
  const second = keys(f.service);
  // a new deeper folder that the exhausted pass cannot read
  f.folderFor(mono).fail = undefined;
  f.state.visits[web + '/src/new/deeper'] = { count: 4, last: f.now };
  f.exhaust(1);
  f.advance(1000);
  await f.service.run();
  const third = keys(f.service);
  expect(second).toEqual(first);
  expect(third).toEqual(first);
});

it('R2 an incomplete first pass converges without new visits', async () => {
  const f = await fixture();
  for (let index = 0; index < 200; index++) {
    const root = f.home + '/code/p' + index;
    f.folderFor(root).markers = ['package.json'];
    f.state.visits![root + '/src'] = { count: 3, last: f.now - 3_600_000 };
  }
  await f.service.load();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await (f.service as unknown as { running?: Promise<void> }).running;
  const afterFirst = f.service.snapshot().definitions.length;
  expect(afterFirst).toBe(149);
  const passes = vi.spyOn(f.ports.facts, 'pass');
  for (let minute = 0; minute < 60; minute++) {
    f.service.historyChanged(); // workspace saves, all visits older than the last pass
    f.advance(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await (f.service as unknown as { running?: Promise<void> }).running;
  }
  const afterHour = f.service.snapshot().definitions.length;
  expect(afterHour).toBe(200);
  expect(passes).toHaveBeenCalledOnce();
});

it('R3a outside rename with the old path re-created as a different folder', async () => {
  const f = await fixture();
  const old = f.home + '/code/acme';
  f.folderFor(old).markers = ['package.json'];
  f.state.visits = { [old + '/src']: { count: 10, last: f.now } };
  await f.service.run();
  const key = keys(f.service)['~/code/acme']!;
  f.retained.add(key);
  const renamed = f.home + '/code/acme-old';
  f.folders.set(renamed, { ...f.folderFor(old) });
  f.folders.set(old, { markers: ['package.json'], ino: 9_999n }); // a fresh clone at the old path
  f.state.visits[renamed + '/src'] = { count: 3, last: f.now };
  f.advance(3_600_000);
  f.state.visits[old + '/src']!.last = f.now;
  f.state.visits[renamed + '/src']!.last = f.now;
  await f.service.run();
  const after = keys(f.service);
  expect(after['~/code/acme-old']).toBe(key);
  expect(after['~/code/acme']).toBeDefined();
  expect(after['~/code/acme']).not.toBe(key);
});

it('R3b swapping two project folders outside Viewer: keys follow identity', async () => {
  const f = await fixture();
  const a = f.home + '/code/alpha';
  const b = f.home + '/code/beta';
  f.folderFor(a).markers = ['package.json'];
  f.folderFor(b).markers = ['package.json'];
  f.state.visits = {
    [a + '/src']: { count: 5, last: f.now },
    [b + '/src']: { count: 5, last: f.now },
  };
  await f.service.run();
  const before = keys(f.service);
  const ia = f.folderFor(a).ino;
  f.folderFor(a).ino = f.folderFor(b).ino;
  f.folderFor(b).ino = ia;
  f.advance(3_600_000);
  for (const visit of Object.values(f.state.visits)) visit.last = f.now;
  await f.service.run();
  const after = keys(f.service);
  expect(after['~/code/alpha']).toBe(before['~/code/beta']);
  expect(after['~/code/beta']).toBe(before['~/code/alpha']);
});

it('R3c two renames in a row keep the key', async () => {
  const f = await fixture();
  const first = f.home + '/code/one';
  f.folderFor(first).markers = ['package.json'];
  f.state.visits = { [first + '/src']: { count: 5, last: f.now } };
  await f.service.run();
  const key = keys(f.service)['~/code/one']!;
  let current = first;
  for (const name of ['two', 'three']) {
    const next = f.home + '/code/' + name;
    f.folders.set(next, { ...f.folderFor(current) });
    f.folders.set(current, { markers: [], ino: 1n, missing: true });
    f.state.visits[next + '/src'] = { count: 3, last: f.now };
    f.advance(3_600_000);
    for (const visit of Object.values(f.state.visits)) visit.last = f.now;
    await f.service.run();
    current = next;
  }
  const after = keys(f.service);
  expect(after['~/code/three']).toBe(key);
});

it('R6 browsing outside known roots: passes and writes per hour', async () => {
  const f = await fixture();
  const root = f.home + '/code/sample';
  f.folderFor(root).markers = ['package.json'];
  f.state.visits = { [root + '/src']: { count: 3, last: f.now } };
  await f.service.load();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await (f.service as unknown as { running?: Promise<void> }).running;
  const before = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  const save = vi.spyOn(f.service.store, 'save');
  const passes = vi.spyOn(f.ports.facts, 'pass');
  for (let minute = 0; minute < 60; minute++) {
    f.advance(60_000);
    // the same Downloads folder visited again each minute
    f.state.visits[f.home + '/Downloads/inbox'] = { count: minute + 1, last: f.now };
    f.service.historyChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    await (f.service as unknown as { running?: Promise<void> }).running;
  }
  const revisitPasses = passes.mock.calls.length;
  const revisitWrites = save.mock.calls.length;
  expect(revisitPasses).toBeGreaterThan(1);
  expect(revisitWrites).toBeLessThanOrEqual(1);
  const after = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(after.entries).toEqual(before.entries);
});

it('R10 a disk that never comes back: its found entries after 200 days without visits', async () => {
  const f = await fixture();
  let mounted = true;
  const service = new FoundWorkspaces(f.directory + '/r10', f.home, {
    ...f.ports,
    localVolumes: () => (mounted ? ['/Volumes/Work'] : []),
  });
  services.push(service);
  f.folderFor('/Volumes/Work/acme').markers = ['package.json'];
  f.state.visits = { '/Volumes/Work/acme/src': { count: 3, last: f.now } };
  await service.run();
  mounted = false;
  f.state.visits = {};
  f.advance(200 * 86_400_000);
  await service.run();
  expect(service.snapshot().definitions).toEqual([]);
});

it('stops incomplete follow-ups when a pass makes no progress', async () => {
  const f = await fixture();
  const root = f.home + '/code/sample';
  f.folderFor(root).markers = ['package.json'];
  f.folderFor(f.home + '/code').fail = 'timeout';
  f.state.visits = { [root + '/src']: { count: 3, last: f.now } };
  await f.service.load();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await Reflect.get(f.service, 'running');
  const pass = vi.spyOn(f.ports.facts, 'pass');
  f.advance(300_000);
  await vi.advanceTimersByTimeAsync(300_000);
  await Reflect.get(f.service, 'running');
  expect(pass).toHaveBeenCalledOnce();
  f.advance(3_600_000);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(pass).toHaveBeenCalledOnce();
  expect(f.service.snapshot().definitions).toEqual([]);
});

it('does not count refreshing folders it already knew as progress', async () => {
  const f = await fixture();
  f.folderFor(f.home + '/code').fail = 'timeout';
  // 501 folders: the cap alone would allow two follow-ups, so only the progress rule stops them.
  f.state.visits = Object.fromEntries(
    Array.from({ length: 250 }, (_, index) => {
      const root = f.home + '/code/p' + index;
      f.folderFor(root).markers = ['package.json'];
      return [root + '/src', { count: 3, last: f.now }];
    }),
  );
  await f.service.run();
  f.advance(1000);
  await f.service.run();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const pass = vi.spyOn(f.ports.facts, 'pass');
  f.service.start();
  for (let round = 0; round < 4; round++) {
    // Every cached probe has expired by the next pass, so each pass only re-reads known folders.
    f.advance(8 * 86_400_000);
    await vi.advanceTimersByTimeAsync(300_000);
    await Reflect.get(f.service, 'running');
  }
  expect(pass).toHaveBeenCalledOnce();
});

it('gives a later incomplete pass its own follow-ups', async () => {
  const f = await fixture();
  const code = f.home + '/code';
  const first = code + '/first';
  const second = code + '/second';
  f.folderFor(first).markers = ['package.json'];
  f.folderFor(second).markers = ['package.json'];
  f.folderFor(code).fail = 'timeout';
  f.state.visits = { [first + '/src']: { count: 3, last: f.now } };
  await f.service.load();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await Reflect.get(f.service, 'running');
  // The first chain ends after one follow-up that learns nothing.
  f.advance(300_000);
  await vi.advanceTimersByTimeAsync(300_000);
  await Reflect.get(f.service, 'running');
  f.advance(3_600_000);
  await vi.advanceTimersByTimeAsync(3_600_000);
  f.state.visits[second + '/src'] = { count: 3, last: f.now };
  f.service.historyChanged();
  f.advance(30_000);
  await vi.advanceTimersByTimeAsync(30_000);
  await Reflect.get(f.service, 'running');
  expect(f.service.snapshot().definitions).toEqual([]);
  // The folder that timed out recovers before the new chain's follow-up.
  f.folderFor(code).fail = undefined;
  f.advance(300_000);
  await vi.advanceTimersByTimeAsync(300_000);
  await Reflect.get(f.service, 'running');
  expect(
    f.service
      .snapshot()
      .definitions.map((item) => item.root)
      .sort(),
  ).toEqual([first, second]);
});

it('bounds follow-ups when the probe cache cannot hold every candidate folder', async () => {
  const f = await fixture();
  // A hundred visits fourteen folders deep need 1,401 probes; the cache keeps 1,000.
  const deep = Array.from({ length: 13 }, (_, level) => 'l' + level).join('/');
  f.state.visits = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      f.home + '/deep/t' + index + '/' + deep,
      { count: 3, last: f.now },
    ]),
  );
  await f.service.load();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  const pass = vi.spyOn(f.ports.facts, 'pass');
  for (let round = 0; round < 24; round++) {
    await vi.advanceTimersByTimeAsync(300_000);
    await Reflect.get(f.service, 'running');
    f.advance(300_000);
  }
  // One pass, then at most one follow-up for each 300 probes the candidate folders need.
  expect(pass.mock.calls.length).toBeGreaterThan(1);
  expect(pass.mock.calls.length).toBeLessThanOrEqual(1 + Math.ceil(1401 / 300));
});

it('a Viewer move that cancels a pass schedules another', async () => {
  const f = await fixture();
  const first = f.home + '/code/first';
  const second = f.home + '/code/second';
  f.folderFor(first).markers = ['package.json'];
  f.folderFor(second).markers = ['package.json'];
  f.state.visits = { [first + '/src']: { count: 3, last: f.now } };
  await f.service.run();
  f.advance(600_000);
  f.state.visits[second + '/src'] = { count: 3, last: f.now - 1000 };
  let release!: (result: FolderProbeResult) => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.probe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
        entered();
      }),
  );
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await waiting;
  const key = f.service.snapshot().definitions[0]!.key;
  const moved = f.home + '/code/moved';
  // Viewer moves the folder; folder history follows the move.
  f.folders.set(moved, f.folderFor(first));
  f.folders.set(first, { markers: [], ino: 1n, missing: true });
  f.state.visits[moved + '/src'] = f.state.visits[first + '/src']!;
  delete f.state.visits[first + '/src'];
  await f.service.remap([{ source: first, destination: moved }]);
  release({ ok: false, reason: 'timeout' });
  await Reflect.get(f.service, 'running');
  expect(f.service.snapshot().definitions).toMatchObject([{ key, root: moved }]);
  f.advance(300_000);
  await vi.advanceTimersByTimeAsync(300_000);
  await Reflect.get(f.service, 'running');
  const found = new Map(f.service.snapshot().definitions.map((item) => [item.root, item.key]));
  expect(found.size).toBe(2);
  expect(found.get(moved)).toBe(key);
  expect(found.has(second)).toBe(true);
});

it.each(['open', 'remembered'] as const)(
  'keeps an unplugged %s entry after ninety days',
  async (owner) => {
    const f = await fixture();
    let mounted = true;
    const service = new FoundWorkspaces(f.directory + '/offline', f.home, {
      ...f.ports,
      localVolumes: () => (mounted ? ['/Volumes/Work'] : []),
      retained: (key) => owner === 'open' && f.retained.has(key),
      keepOnClear: (key) => f.retained.has(key),
    });
    services.push(service);
    f.folderFor('/Volumes/Work/sample').markers = ['package.json'];
    f.state.visits = { '/Volumes/Work/sample/src': { count: 3, last: f.now } };
    await service.run();
    const entry = service.snapshot().definitions[0]!;
    f.retained.add(entry.key);
    mounted = false;
    f.state.visits = {};
    f.advance(200 * 86_400_000);
    await service.run();
    expect(service.snapshot().definitions).toMatchObject([{ key: entry.key, root: entry.root }]);
    expect(service.available(entry.root)).toBe(false);
  },
);

it('coalesces fifty moves spaced thirty milliseconds apart and flushes on shutdown', async () => {
  const f = await fixture();
  for (let index = 0; index < 50; index++) {
    const root = f.home + '/code/p' + index;
    f.folderFor(root).markers = ['package.json'];
    f.state.visits![root + '/src'] = { count: 3, last: f.now };
  }
  await f.service.run();
  const save = vi.spyOn(f.service.store, 'save');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  for (let index = 0; index < 50; index++) {
    await f.service.remap([
      {
        source: f.home + '/code/p' + index,
        destination: f.home + '/archive/p' + index,
      },
    ]);
    await vi.advanceTimersByTimeAsync(30);
  }
  expect(save).not.toHaveBeenCalled();
  await f.service.close();
  expect(save).toHaveBeenCalledOnce();
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(stored.entries).toHaveLength(50);
  expect(stored.entries.every((entry: { root: string }) => entry.root.includes('/archive/'))).toBe(
    true,
  );
});

it('an affected Viewer move cancels a pass before its pending facts can replace the remap', async () => {
  const f = await fixture();
  const root = f.home + '/code/sample';
  f.folderFor(root).markers = ['package.json'];
  f.state.visits = { [root + '/src']: { count: 3, last: f.now } };
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.advance(8 * 86_400_000);
  f.state.visits[root + '/src']!.last = f.now;
  let release!: (result: FolderProbeResult) => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.probe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
        entered();
      }),
  );
  const running = f.service.run();
  await waiting;
  const moved = f.home + '/code/moved';
  await f.service.remap([{ source: root, destination: moved }]);
  release({ ok: false, reason: 'missing' });
  await running;
  expect(f.service.snapshot().definitions).toMatchObject([{ key, root: moved }]);
});

it('re-keys only found-origin links', () => {
  const sources = ['found', 'standalone', 'project-manager', 'override', undefined] as const;
  const spaces = sources.map((source, index) =>
    sampleWorkspace('w' + index, {
      definition: { key: 'old', basis: 'basis', source },
    }),
  );
  const result = rekeyFoundLinks(spaces, [{ from: 'old', to: 'new' }]);
  expect(result[0]!.definition?.key).toBe('new');
  for (let index = 1; index < spaces.length; index++) expect(result[index]).toBe(spaces[index]);
});

it('reserves an existing key before a higher-ranked new path can mint it', async () => {
  const f = await fixture();
  const root = f.home + '/code/original';
  const newcomer = f.home + '/code/newcomer';
  const key = foundKey(newcomer, f.home);
  const old = f.folderFor(root);
  old.markers = ['package.json'];
  f.folderFor(newcomer).markers = ['package.json'];
  await writeFile(
    f.service.store.file,
    JSON.stringify({
      version: 1,
      entries: [{ key, root, realpath: root, identity: '1:' + old.ino, names: [], at: f.now }],
      probes: [],
      hidden: [],
      lastRun: [],
    }),
  );
  f.state.visits = {
    [root + '/src']: { count: 3, last: f.now },
    [newcomer + '/src']: { count: 30, last: f.now },
  };
  await f.service.run();
  expect(keys(f.service)[root.replace(f.home, '~')]).toBe(key);
  expect(keys(f.service)[newcomer.replace(f.home, '~')]).not.toBe(key);
  expect(f.service.snapshot().definitions).toHaveLength(2);
});

it('ignores obsolete lastRun data without keeping or writing it', async () => {
  const f = await fixture();
  const root = f.home + '/code/sample';
  await writeFile(
    f.service.store.file,
    JSON.stringify({
      version: 1,
      entries: [],
      hidden: [],
      probes: [],
      lastRun: [{ obsolete: 'ignored' }],
    }),
  );
  await f.service.load();
  expect(f.service.recovery).toBeUndefined();
  f.folderFor(root).markers = ['package.json'];
  f.state.visits = { [root + '/src']: { count: 3, last: f.now } };
  await f.service.run();
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(stored.entries).toHaveLength(1);
  expect(stored).not.toHaveProperty('lastRun');
  expect(f.service).not.toHaveProperty('recordRun');
});

it('re-reads a cached claimant before trusting an old identity match', async () => {
  const f = await fixture();
  const root = f.home + '/code/original';
  const claimant = f.home + '/code/claimant';
  f.folderFor(root).markers = ['package.json'];
  f.folders.set(claimant, { ...f.folderFor(root) });
  f.state.visits = {
    [root + '/src']: { count: 3, last: f.now },
    [claimant + '/src']: { count: 1, last: f.now },
  };
  await f.service.run();
  expect(f.service.snapshot().definitions).toHaveLength(1);
  f.folderFor(claimant).ino = 99_999n;
  f.advance(1000);
  f.state.visits[claimant + '/src'] = { count: 3, last: f.now };
  f.probe.mockClear();
  await f.service.run();
  expect(f.probe.mock.calls.some(([folder]) => folder === claimant)).toBe(true);
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(stored.entries.find((entry: { root: string }) => entry.root === claimant)?.identity).toBe(
    '1:99999',
  );
});

async function nearLimitDocument(f: Awaited<ReturnType<typeof fixture>>) {
  const entries = Array.from({ length: 201 }, (_, index) => {
    const root = f.home + '/code/p' + index + '-' + 'a'.repeat(2200);
    return {
      key: 'entry-' + index,
      root,
      realpath: root,
      identity: '1:' + index,
      names: [],
      at: f.now,
    };
  });
  const document = { version: 1, entries, hidden: [], probes: [] };
  for (const entry of entries) {
    const room = Math.floor((999_950 - Buffer.byteLength(JSON.stringify(document))) / 2);
    if (room < 1) break;
    const extra = 'a'.repeat(Math.min(room, 3500 - entry.root.length));
    entry.root += extra;
    entry.realpath += extra;
  }
  expect(Buffer.byteLength(JSON.stringify(document))).toBeLessThanOrEqual(1_000_000);
  expect(Buffer.byteLength(JSON.stringify(document))).toBeGreaterThan(999_900);
  await writeFile(f.service.store.file, JSON.stringify(document));
  return document;
}

it('retains a linked entry when remapping forces the one MB trim', async () => {
  const f = await fixture();
  const document = await nearLimitDocument(f);
  const retained = document.entries.at(-1)!;
  f.retained.add(retained.key);
  await f.service.load();
  const destination = f.home + '/archive/' + 'b'.repeat(300);
  await f.service.remap([{ source: f.home + '/code', destination }]);
  await f.service.close();
  const text = await readFile(f.service.store.file, 'utf8');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_000_000);
  const stored = JSON.parse(text);
  expect(stored.entries.length).toBeLessThan(document.entries.length);
  expect(stored.entries.find((entry: { key: string }) => entry.key === retained.key)?.root).toBe(
    retained.root.replace(f.home + '/code', destination),
  );
});

it('retains the new key during trimming while its old found owner is pending', async () => {
  const f = await fixture();
  const document = await nearLimitDocument(f);
  const retained = document.entries.at(-1)!;
  f.retained.add(retained.key);
  f.setExplicit([{ key: retained.key } as WorkspaceDefinition]);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.rekey.mockImplementation(async () => {
    entered();
    await gate;
  });
  const repairing = f.service.reconcileKeys();
  await waiting;
  try {
    const pending = JSON.parse(await readFile(f.service.store.file, 'utf8'));
    const to = pending.rekeys.find((change: { from: string }) => change.from === retained.key).to;
    expect(pending.entries.find((entry: { key: string }) => entry.key === to)?.root).toBe(
      retained.root,
    );
    expect(pending.entries.length).toBeLessThan(document.entries.length);
  } finally {
    release();
    await repairing;
  }
});

it('does not turn stale facts from an unavailable ancestor into a new inner workspace', async () => {
  const f = await fixture();
  const mono = f.home + '/code/mono';
  const inner = mono + '/packages/web';
  f.folderFor(inner).markers = ['package.json'];
  f.state.visits = { [inner + '/src']: { count: 2, last: f.now } };
  await f.service.run();
  expect(f.service.snapshot().definitions).toEqual([]);
  f.advance(8 * 86_400_000);
  f.folderFor(mono).fail = 'timeout';
  f.state.visits[inner + '/src'] = { count: 3, last: f.now };
  await f.service.run();
  expect(f.service.snapshot().definitions).toEqual([]);
});

it('does not hand an entry to a new claimant while the original still holds its identity', async () => {
  const f = await fixture();
  const root = f.home + '/code/original';
  const alias = f.home + '/code/claimant';
  f.folderFor(root).markers = ['package.json'];
  f.state.visits = { [root + '/src']: { count: 3, last: f.now } };
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.folders.set(alias, { ...f.folderFor(root) });
  f.state.visits[alias + '/src'] = { count: 3, last: f.now };
  await f.service.run();
  expect(f.service.snapshot().definitions).toMatchObject([{ key, root }]);
  expect(f.service.snapshot().definitions).toHaveLength(1);
});

it('an unrelated Viewer move leaves a running pass in progress', async () => {
  const f = await fixture();
  const root = f.home + '/code/sample';
  f.folderFor(root).markers = ['package.json'];
  f.state.visits = { [root + '/src']: { count: 3, last: f.now } };
  await f.service.run();
  f.advance(8 * 86_400_000);
  f.state.visits[root + '/src']!.last = f.now;
  const original = f.probe.getMockImplementation()!;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.probe.mockClear();
  f.probe.mockImplementationOnce(async (folder, pass) => {
    entered();
    await gate;
    return original(folder, pass);
  });
  const running = f.service.run();
  await waiting;
  await f.service.remap([
    {
      source: f.home + '/Downloads/one.txt',
      destination: f.home + '/Downloads/two.txt',
    },
  ]);
  release();
  await running;
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(f.probe.mock.calls.length).toBeGreaterThan(1);
  expect(stored.probes.every((probe: { at: number }) => probe.at === f.now)).toBe(true);
});

it('keeps stale fallback facts beyond the pass budget without allowing a 301st read', async () => {
  const f = await fixture();
  const stale = f.home + '/code/stale';
  const result = await probeFoundFolders({
    facts: f.ports.facts,
    records: [
      {
        folder: stale,
        at: f.now - 8 * 86_400_000,
        value: { path: stale, identity: '1:999', markers: ['package.json'], capped: false },
      },
    ],
    folders: [stale, ...Array.from({ length: 300 }, (_, index) => f.home + '/new/p' + index)],
    context: { home: f.home },
    now: () => f.now,
    signal: new AbortController().signal,
  });
  expect(result.facts.get(stale)?.identity).toBe('1:999');
  expect(f.probe.mock.calls.some(([folder]) => folder === stale)).toBe(false);
  expect(await result.read(f.home + '/new/extra', true)).toBe(false);
  expect(f.probe).toHaveBeenCalledTimes(300);
});

it('counts identity checks of cached roots within the 300-request budget', async () => {
  const f = await fixture();
  const cached = [f.home + '/code/one', f.home + '/code/two'];
  const result = await probeFoundFolders({
    facts: f.ports.facts,
    records: cached.map((folder) => ({
      folder,
      at: f.now,
      value: {
        path: folder,
        identity: '1:' + f.folderFor(folder).ino,
        markers: ['package.json'],
        capped: false,
      },
    })),
    folders: Array.from({ length: 299 }, (_, index) => f.home + '/new/p' + index),
    verify: cached,
    context: { home: f.home },
    now: () => f.now,
    signal: new AbortController().signal,
  });
  expect(f.probe).toHaveBeenCalledTimes(300);
  expect(f.probe.mock.calls.filter(([folder]) => cached.includes(folder))).toHaveLength(1);
  expect(result.exhausted).toBe(true);
});
