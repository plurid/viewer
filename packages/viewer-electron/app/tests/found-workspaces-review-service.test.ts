import { afterEach, expect, it, vi } from 'vitest';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Worker } from 'node:worker_threads';
import type {
  FolderProbeResult,
  FolderFactsReply,
  FolderFactsMessage,
  FolderFactsRequest,
  FolderGitMarker,
} from '../src/domain/workspaces/folder-facts';
import { FoundWorkspaces } from '../src/desktop/workspaces/found-workspaces';
import { FolderFacts } from '../src/desktop/workspaces/folder-facts';
import type { OwnedWorker } from '../src/desktop/workers/utility-client';
import { stateSchema } from '../src/desktop/persistence/storage';
import { temporaryRoot } from '../tools/temporary';
import { sampleWorkspace } from './workspace-definition-fixtures';

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
  delay?: number;
}

async function fixture() {
  const directory = await temporaryRoot('viewer-found-review-');
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
    async (
      folder: string,
      pass: { exhausted: boolean } = { exhausted: false },
    ): Promise<FolderProbeResult> => {
      calls++;
      if (calls >= exhaustAfter) pass.exhausted = true;
      const value = folderFor(folder);
      if (value.delay) await new Promise((resolve) => setTimeout(resolve, value.delay));
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
  const ports = {
    facts: {
      pass: () => ({ relaunches: 0, exhausted: false }),
      probe,
      identity: (folder: string) => probe.getMockImplementation()!(folder),
    },
    state: () => state,
    enabled: () => true,
    explicit: () => [],
    retained: (key: string) => retained.has(key),
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
    service,
    retained,
    ports,
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
  Object.fromEntries(service.snapshot().definitions.map((item) => [item.root, item.key]));

it('S1 keeps a retained found key when a new root with a colliding slug outranks it', async () => {
  const f = await fixture();
  const first = f.home + '/code/Бета';
  const second = f.home + '/code/Альфа';
  f.folderFor(first).markers = ['package.json'];
  f.folderFor(second).markers = ['package.json'];
  f.state.visits = { [first + '/src']: { count: 3, last: f.now } };
  await f.service.run();
  const before = keys(f.service);

  const key = before[first]!;
  f.retained.add(key); // linked to an open workspace
  f.state.visits = {
    [first + '/src']: { count: 3, last: f.now },
    [second + '/src']: { count: 40, last: f.now },
  };
  await f.service.run();
  const after = keys(f.service);

  expect(after[first]).toBe(key);
  expect(after[second]).not.toBe(key);
});

it('S2a carries the key to an outside rename even while the old root is retained', async () => {
  const f = await fixture();
  const old = f.home + '/code/old-name';
  f.folderFor(old).markers = ['package.json'];
  f.state.visits = { [old + '/src']: { count: 10, last: f.now } };
  await f.service.run();
  const key = keys(f.service)[old]!;
  f.retained.add(key);
  // renamed outside Viewer: the same {dev, ino} now lives at the new path
  const renamed = f.home + '/code/new-name';
  f.folders.set(renamed, { ...f.folderFor(old) });
  f.folders.set(renamed + '/src', { ...f.folderFor(old + '/src') });
  f.folders.set(old, { markers: [], ino: 1n, missing: true });
  f.folders.set(old + '/src', { markers: [], ino: 2n, missing: true });
  f.state.visits = {
    [old + '/src']: { count: 10, last: f.now - 60_000 },
    [renamed + '/src']: { count: 3, last: f.now },
  };
  f.advance(8 * 86_400_000); // past the probe cache, so the old root reads as missing
  f.state.visits[old + '/src']!.last = f.now - 60_000;
  f.state.visits[renamed + '/src']!.last = f.now;
  await f.service.run();
  const after = keys(f.service);

  expect(after[renamed]).toBe(key);
});

it('S2b an outside rename inside the seven-day cache keeps the old root and drops the new one', async () => {
  const f = await fixture();
  const old = f.home + '/code/old-name';
  f.folderFor(old).markers = ['package.json'];
  f.state.visits = { [old + '/src']: { count: 10, last: f.now } };
  await f.service.run();
  const key = keys(f.service)[old]!;
  const renamed = f.home + '/code/new-name';
  f.folders.set(renamed, { ...f.folderFor(old) });
  f.folders.set(old, { markers: [], ino: 1n, missing: true });
  f.state.visits = {
    [old + '/src']: { count: 10, last: f.now },
    [renamed + '/src']: { count: 3, last: f.now },
  };
  f.advance(3_600_000); // one hour later, inside the cache
  await f.service.run();
  const after = keys(f.service);

  expect(after[renamed]).toBe(key);
  expect(after[old]).toBeUndefined();
});

it('S3 an exhausted pass picks an inner manifest root, and the next pass re-keys the monorepo', async () => {
  const f = await fixture();
  const mono = f.home + '/code/mono';
  const web = mono + '/packages/web';
  f.folderFor(mono).git = 'directory';
  f.folderFor(mono).markers = ['.git', 'pnpm-workspace.yaml'];
  f.folderFor(web).markers = ['package.json'];
  f.state.visits = { [web + '/src']: { count: 5, last: f.now } };
  f.exhaust(2); // FolderFacts exhausts a pass after its relaunch budget
  await f.service.run();
  const first = keys(f.service);
  f.exhaust(Infinity);
  await f.service.run();
  const second = keys(f.service);

  expect(first).toEqual({});
  expect(second[mono]).toBeDefined();
});

it('S3b one slow folder on the boot volume quarantines it and the pass decides from partial facts', async () => {
  const f = await fixture();
  const mono = f.home + '/code/mono';
  const web = mono + '/packages/web';
  f.folderFor(mono).git = 'directory';
  f.folderFor(mono).markers = ['.git'];
  f.folderFor(mono).delay = 200; // a cold or busy folder answers after 150 ms
  f.folderFor(web).markers = ['package.json'];
  f.state.visits = { [web + '/src']: { count: 5, last: f.now } };
  await f.service.run();
  const first = keys(f.service);

  expect(Object.keys(first)).not.toContain(web);
});

it('S4 an unrelated rename wipes every probe, writes the file and forces a full re-probe', async () => {
  const f = await fixture();
  for (let index = 0; index < 20; index++) {
    const root = f.home + '/code/p' + index;
    f.folderFor(root).markers = ['package.json'];
    f.state.visits![root + '/src'] = { count: 3, last: f.now };
  }
  await f.service.run();
  const firstCalls = f.probe.mock.calls.length;
  const save = vi.spyOn(f.service.store, 'save');
  await f.service.remap([
    { source: f.home + '/Downloads/a.txt', destination: f.home + '/Downloads/b.txt' },
  ]);
  const stored = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(stored.probes).toHaveLength(firstCalls);

  f.probe.mockClear();
  await f.service.run();

  expect(save).not.toHaveBeenCalled();
  expect(f.probe.mock.calls.length).toBe(0);
});

it('S4b with 200 roots, an unrelated rename (or the 7-day expiry) makes found workspaces vanish', async () => {
  const f = await fixture();
  for (let index = 0; index < 200; index++) {
    const root = f.home + '/code/p' + index;
    f.folderFor(root).markers = ['package.json'];
    f.state.visits![root + '/src'] = { count: 3, last: f.now };
  }
  await f.service.run();
  const one = f.service.snapshot().definitions.length;
  f.advance(1000);
  await f.service.run();
  const two = f.service.snapshot().definitions.length;
  await f.service.remap([
    { source: f.home + '/Downloads/a.txt', destination: f.home + '/Downloads/b.txt' },
  ]);
  await f.service.run();
  const afterRename = f.service.snapshot().definitions.length;
  await f.service.run();
  const recovered = f.service.snapshot().definitions.length;
  expect(one).toBeGreaterThan(0);
  expect(one).toBeLessThanOrEqual(two);
  expect(recovered).toBe(two);
  f.advance(8 * 86_400_000);
  await f.service.run();
  const afterExpiry = f.service.snapshot().definitions.length;

  expect(afterRename).toBe(two);
  expect(afterExpiry).toBe(two);
});

it('S5 passes and writes keep happening every five minutes without any new visit', async () => {
  const f = await fixture();
  const root = f.home + '/code/sample';
  f.folderFor(root).markers = ['package.json'];
  f.state.visits = {
    [root + '/src']: { count: 3, last: f.now },
    [f.home + '/Downloads']: { count: 1, last: f.now },
  };
  await f.service.load();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await (f.service as unknown as { running?: Promise<void> }).running;
  const save = vi.spyOn(f.service.store, 'save');
  const passes = vi.spyOn(f.ports.facts, 'pass');
  for (let minute = 0; minute < 60; minute++) {
    f.service.historyChanged(); // every workspace save calls this, visits unchanged
    f.advance(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await (f.service as unknown as { running?: Promise<void> }).running;
  }

  expect(passes.mock.calls.length).toBe(0);
  expect(save).not.toHaveBeenCalled();
});

class FakeWorker implements OwnedWorker<FolderFactsReply> {
  receive?: (reply: FolderFactsReply) => void;
  requests: FolderFactsRequest[] = [];
  terminate = vi.fn(async () => 0);
  thread = { terminate: this.terminate, on: vi.fn() } as unknown as Worker;
  constructor(
    private answer: (
      request: FolderFactsRequest,
    ) => { delay: number; value: FolderProbeResult } | undefined,
  ) {}
  postMessage(value: unknown) {
    const message = value as FolderFactsMessage;
    if (message.kind === 'allow') return;
    this.requests.push(message);
    const reply = this.answer(message);
    if (reply)
      setTimeout(() => this.receive?.({ id: message.id, value: reply.value }), reply.delay);
  }
  message(listener: (reply: FolderFactsReply) => void) {
    this.receive = listener;
  }
  exit() {}
}

it('S6 one interactive read ahead in the queue makes a found probe time out and quarantines the boot volume', async () => {
  const f = await fixture();
  const roots = Array.from({ length: 5 }, (_, index) => f.home + '/code/p' + index);
  for (const root of roots) f.state.visits![root + '/src'] = { count: 3, last: f.now };
  const workers: FakeWorker[] = [];
  const facts = new FolderFacts('unused', {
    worker: () => {
      const worker = new FakeWorker((request) => ({
        // each request stays inside FolderFacts' own 150 ms bound
        delay: request.kind === 'read' ? 100 : 60,
        value:
          request.kind === 'read'
            ? ({ ok: true, path: request.path, bytes: new Uint8Array() } as never)
            : {
                ok: true,
                path: request.path,
                identity: { dev: 1n, ino: BigInt(request.id) },
                markers: roots.includes(request.path) ? ['package.json'] : [],
                capped: false,
              },
      }));
      workers.push(worker);
      return worker;
    },
  });
  const service = new FoundWorkspaces(f.directory + '/s6', f.home, { ...f.ports, facts });
  services.push(service);
  // Run command… reads package.json, Makefile and justfile while the pass runs.
  const reads = (async () => {
    if (process.env.S6_CONTROL) return;
    for (let index = 0; index < 3; index++)
      await facts.read(f.home + '/code/p0/package.json', 1000);
  })();
  await service.run();
  await reads;
  const found = service.snapshot().definitions.map((item) => item.root);

  facts.close();
  expect(found.length).toBe(roots.length);
});

it('S6b positive: a hung probe never holds an interactive read past the 150 ms bound', async () => {
  const facts = new FolderFacts('unused', {
    worker: () =>
      new FakeWorker((request) =>
        request.kind === 'probe' && request.path.endsWith('/hung')
          ? undefined
          : {
              delay: 1,
              value: { ok: true, path: request.path, bytes: new Uint8Array() } as never,
            },
      ),
  });
  const started = Date.now();
  const hung = facts.probe('/Volumes/Sleepy/hung');
  const read = facts.read('/Users/sample/code/p0/package.json', 1000);
  const [hungResult, readResult] = await Promise.all([hung, read]);
  const elapsed = Date.now() - started;

  facts.close();
  expect(hungResult).toEqual({ ok: false, reason: 'timeout' });
  expect(readResult.ok).toBe(true);
  expect(elapsed).toBeLessThan(400);
});

it('S7 Clear then Undo with a colliding pair returns different keys when ranks moved', async () => {
  const f = await fixture();
  const a = f.home + '/code/項目';
  const b = f.home + '/code/工具';
  f.folderFor(a).markers = ['package.json'];
  f.folderFor(b).markers = ['package.json'];
  f.state.visits = {
    [a + '/src']: { count: 9, last: f.now },
    [b + '/src']: { count: 3, last: f.now },
  };
  await f.service.run();
  const before = keys(f.service);
  // b gains a plane in a non-pristine open workspace (presence + 1) before Clear
  f.retained.add(before[b]!);
  await f.service.clearHistory();
  f.retained.clear();
  f.state.visits = {
    [a + '/src']: { count: 9, last: f.now },
    [b + '/src']: { count: 30, last: f.now },
  };
  await f.service.run();
  const after = keys(f.service);

  expect(after).toEqual(before);
});

it('S8 load at launch moves an unreadable file aside (a write at launch)', async () => {
  const f = await fixture();
  await writeFile(f.service.store.file, '{"version":1,"entries":[');
  await f.service.load();
  expect(await readdir(f.directory)).toEqual(['found-workspaces-v1.json']);
  await f.service.run();
  expect((await readdir(f.directory)).some((name) => name.includes('.unreadable-'))).toBe(true);
});

it('S9 launch: reading a full file, and the setting-off rewrite, happen on the bootstrap path', async () => {
  const f = await fixture();
  const entries = Array.from({ length: 200 }, (_, index) => ({
    key: 'code/p' + index,
    root: f.home + '/code/' + 'p'.repeat(60) + index,
    realpath: f.home + '/code/' + 'p'.repeat(60) + index,
    identity: '1:' + (index + 10),
    names: ['@acme/' + 'n'.repeat(60) + index],
    at: f.now,
  }));
  const probes = Array.from({ length: 1000 }, (_, index) => ({
    folder: f.home + '/code/' + 'q'.repeat(60) + index,
    at: f.now,
    value: {
      path: f.home + '/code/' + 'q'.repeat(60) + index,
      identity: '1:' + (index + 1000),
      markers: ['package.json', '.git', 'pnpm-lock.yaml', 'Makefile'],
      capped: false,
      git: 'directory' as const,
      package: { name: '@acme/' + 'n'.repeat(40), workspaces: true, packageManager: 'pnpm@10.0.0' },
    },
  }));
  const document = { version: 1, entries, hidden: [], probes, lastRun: [] };
  await writeFile(f.service.store.file, JSON.stringify(document));
  const bytes = Buffer.byteLength(JSON.stringify(document));
  await f.service.store.load();
  const started = performance.now();
  await f.service.load();
  const elapsed = performance.now() - started;

  const off = new FoundWorkspaces(f.directory, f.home, { ...f.ports, enabled: () => false });
  services.push(off);
  const before = (await readFile(off.store.file, 'utf8')).length;
  await off.load();
  const after = JSON.parse(await readFile(off.store.file, 'utf8'));
  expect(after).toEqual(document);
  expect(before).toBe(bytes);
  expect(elapsed).toBeGreaterThanOrEqual(0);
  await off.run();
  expect(JSON.parse(await readFile(off.store.file, 'utf8')).entries).toEqual([]);
});

it('S10 an unplugged local volume removes its found definitions outright (no missing state)', async () => {
  const f = await fixture();
  let mounted = true;
  const service = new FoundWorkspaces(f.directory + '/s10', f.home, {
    ...f.ports,
    localVolumes: () => (mounted ? ['/Volumes/Work'] : []),
  });
  services.push(service);
  f.folderFor('/Volumes/Work/acme').markers = ['package.json'];
  f.state.visits = { '/Volumes/Work/acme/src': { count: 3, last: f.now } };
  await service.run();
  const before = service.snapshot().definitions.map((item) => item.key);
  mounted = false;
  const after = service.snapshot();
  expect(after.definitions.map((item) => item.key)).toEqual(before);
  expect(after.definitions[0]!.rootState).toBe('unknown');
  await service.run();
  expect(service.snapshot().definitions.map((item) => item.key)).toEqual(before);
});
it('S6c keeps the shared probe quarantine for thirty seconds rather than one', async () => {
  vi.useFakeTimers();
  const facts = new FolderFacts('unused', {
    worker: () =>
      new FakeWorker((request) =>
        request.path.endsWith('/hung')
          ? undefined
          : {
              delay: 1,
              value: {
                ok: true,
                path: request.path,
                identity: { dev: 1n, ino: 44n },
                markers: [],
                capped: false,
              },
            },
      ),
  });
  const hung = facts.probe('/Volumes/Sleepy/hung');
  await vi.advanceTimersByTimeAsync(151);
  expect(await hung).toEqual({ ok: false, reason: 'timeout' });
  await vi.advanceTimersByTimeAsync(1001);
  expect(await facts.probe('/Volumes/Sleepy/other')).toEqual({ ok: false, reason: 'quarantined' });
  await vi.advanceTimersByTimeAsync(30_001);
  const available = facts.probe('/Volumes/Sleepy/other');
  await vi.advanceTimersByTimeAsync(1);
  expect(await available).toMatchObject({ ok: true });
  facts.close();
});
