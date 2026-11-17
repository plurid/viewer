import { afterEach, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import type { Pane, SavedState } from '../src/domain/contracts';
import type { FoundWorkspacePorts } from '../src/desktop/workspaces/found-workspaces';
import { FoundWorkspaces } from '../src/desktop/workspaces/found-workspaces';
import { probeFoundFolders, foundProbeExpiry } from '../src/desktop/workspaces/found-probes';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { DefinedWorkspaces } from '../src/desktop/workspaces/defined-workspaces';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { stateSchema } from '../src/desktop/persistence/storage';
import { defaultSettings } from '../src/domain/services';
import { captureDefinition, proposeDefinition } from '../src/domain/workspaces/definitions/capture';
import { definitionShares, mostlyIn, addsToDefinition } from '../src/domain/workspaces/ownership';
import { candidateFolders, qualifyingRoots } from '../src/domain/workspaces/found/candidates';
import { foundDefinitions } from '../src/domain/workspaces/found/catalog';
import { rootFor, allowedFoundFolder, rootAncestors } from '../src/domain/workspaces/found/roots';
import {
  definitionSourceNotice,
  definitionWasRemoved,
  withDefinitionOrigins,
} from '../src/domain/workspaces/catalog';
import { temporaryRoot } from '../tools/temporary';
import { sampleDefinition, sampleWorkspace, hashDefinition } from './workspace-definition-fixtures';
import {
  rankWorkspaceChoices,
  resolveWorkspaceQuery,
} from '../src/domain/workspaces/definitions/query';

const services: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.useRealTimers();
});
const folderPane = (id: string, path: string): Pane => ({
  id,
  type: 'folder',
  path,
  history: [path],
  historyIndex: 0,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
});
const spaceAt = (...paths: string[]) =>
  sampleWorkspace('open', {
    panes: paths.map((folder, index) => folderPane('p' + index, folder)),
    roots: paths.map((_, index) => 'p' + index),
  });

async function fixture() {
  const directory = await temporaryRoot('viewer-found-guards-');
  const home = directory + '/home';
  let now = 1_800_000_000_000;
  let enabled = true;
  let serial = 10n;
  const identities = new Map<string, bigint>();
  const roots = new Set<string>();
  const retained = new Set<string>();
  const state: SavedState = stateSchema.parse({
    version: 13,
    workspaces: [sampleWorkspace()],
    activeWorkspace: 'open',
    favorites: [],
    recents: [],
    look: 'dark',
    visits: {},
  });
  const probe = vi.fn(async (folder: string) => {
    if (!identities.has(folder)) identities.set(folder, serial++);
    return {
      ok: true as const,
      path: folder,
      identity: { dev: 1n, ino: identities.get(folder)! },
      markers: roots.has(folder) ? ['package.json'] : [],
      capped: false,
    };
  });
  const pass = vi.fn(() => ({ relaunches: 0, exhausted: false }));
  const ports: FoundWorkspacePorts = {
    facts: { pass, probe },
    state: () => state,
    enabled: () => enabled,
    explicit: () => [],
    retained: (key) => retained.has(key),
    localVolumes: () => [],
    now: () => now,
  };
  const create = (extra: Partial<FoundWorkspacePorts> = {}) => {
    const service = new FoundWorkspaces(directory, home, { ...ports, ...extra });
    services.push(service);
    return service;
  };
  const service = new FoundWorkspaces(directory, home, ports);
  services.push(service);
  const root = home + '/code/sample';
  const add = (folder = root) => {
    roots.add(folder);
    state.visits![folder + '/src'] = { count: 3, last: now };
  };
  return {
    directory,
    home,
    root,
    roots,
    retained,
    state,
    ports,
    probe,
    pass,
    service,
    create,
    add,
    get now() {
      return now;
    },
    advance: (ms: number) => {
      now += ms;
    },
    enabled: (value: boolean) => {
      enabled = value;
    },
  };
}
const emptyDocument = () => ({ version: 1, entries: [], hidden: [], probes: [], lastRun: [] });

it.each(['Library/secret', '.hidden/secret'])(
  'refuses a probe whose realpath enters %s',
  async (suffix) => {
    const f = await fixture();
    const result = await probeFoundFolders({
      facts: {
        pass: f.pass,
        probe: vi.fn(async () => ({
          ok: true as const,
          path: f.home + '/' + suffix,
          identity: { dev: 1n, ino: 20n },
          markers: ['package.json'],
          capped: false,
        })),
      },
      records: [],
      folders: [f.root],
      context: { home: f.home },
      now: () => f.now,
      signal: new AbortController().signal,
    });
    expect(result.facts.has(f.root)).toBe(false);
    expect(result.cache.has(f.root)).toBe(false);
  },
);

it('hides cached rows at once when Store access is revoked', async () => {
  const f = await fixture();
  let allowed = true;
  f.ports.access = () => allowed;
  f.add();
  await f.service.run();
  expect(f.service.snapshot().definitions).toHaveLength(1);
  f.probe.mockClear();
  allowed = false;
  expect(f.service.snapshot().definitions).toEqual([]);
  expect(f.probe).not.toHaveBeenCalled();
});

it('keeps a loaded hidden root out of the catalog', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const document = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  document.hidden = [f.root];
  await writeFile(f.service.store.file, JSON.stringify(document));
  const fresh = f.create();
  await fresh.load();
  expect(fresh.snapshot().definitions).toEqual([]);
  expect(fresh.snapshot().state.hidden).toBe(1);
});

it('keeps a retained entry when there are no probe facts or visits', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.retained.add(key);
  await f.service.clearHistory();
  f.state.visits = {};
  await f.service.run();
  expect(f.service.snapshot().definitions).toMatchObject([{ key, root: f.root }]);
});

it('ignores pristine planes and gives presence its ranking weight', () => {
  const home = '/Users/sample';
  const pristine = { ...spaceAt(home), name: 'Workspace' };
  expect(
    candidateFolders({
      home,
      now: 100,
      visits: {},
      recents: [],
      workspaces: [pristine],
      openWindows: ['open'],
    }),
  ).toEqual([]);
  const a = home + '/code/a';
  const z = home + '/code/z';
  expect(
    qualifyingRoots(
      [a, z],
      [
        { folder: a, count: 3, last: 100, score: 3, plane: false },
        { folder: z, count: 3, last: 100, score: 3, plane: true },
      ],
      100,
    )[0],
  ).toBe(z);
});

it('retains all linked roots in addition to two hundred ordinary roots', () => {
  const roots = Array.from({ length: 205 }, (_, index) => '/Users/sample/r' + index);
  const retained = new Set(roots.slice(0, 5));
  const evidence = roots.map((folder) => ({ folder, count: 3, last: 100, score: 3, plane: false }));
  const ranked = qualifyingRoots(roots, evidence, 100, retained);
  expect(ranked).toHaveLength(205);
  expect(new Set(ranked.slice(0, 5))).toEqual(retained);
});

it('waits thirty seconds for a new visit even after the five-minute interval elapsed', async () => {
  const f = await fixture();
  f.add();
  await f.service.load();
  vi.useFakeTimers();
  f.service.start();
  await vi.advanceTimersByTimeAsync(10_000);
  await f.service.run();
  const passes = f.pass.mock.calls.length;
  f.advance(600_000);
  f.add(f.home + '/code/new');
  f.service.historyChanged();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(f.pass).toHaveBeenCalledTimes(passes);
  await vi.advanceTimersByTimeAsync(1);
  await f.service.run();
  expect(f.pass.mock.calls.length).toBeGreaterThan(passes);
});

it('bounds the growing probe cache and refreshes oldest observations first with spread expiry', async () => {
  const f = await fixture();
  const probes = Array.from({ length: 1000 }, (_, index) => ({
    folder: f.home + '/cache/p' + index,
    at: f.now - 8 * 86_400_000,
    value: {
      path: f.home + '/cache/p' + index,
      identity: '1:' + (index + 1000),
      markers: [],
      capped: false,
    },
  }));
  await writeFile(f.service.store.file, JSON.stringify({ ...emptyDocument(), probes }));
  for (let index = 0; index < 180; index++) f.add(f.home + '/code/p' + index);
  await f.service.run();
  const document = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(document.probes).toHaveLength(1000);
  const fresh = document.probes.filter((item: { at: number }) => item.at === f.now);
  expect(new Set(fresh.map((item: { expires: number }) => item.expires)).size).toBeGreaterThan(1);
  const oldest = [...probes.slice(0, 2)].reverse();
  oldest[0]!.at--;
  const facts = { pass: f.pass, probe: f.probe };
  f.probe.mockClear();
  await probeFoundFolders({
    facts,
    records: oldest,
    folders: oldest.map((item) => item.folder).reverse(),
    context: { home: f.home },
    now: () => f.now,
    signal: new AbortController().signal,
  });
  expect(f.probe.mock.calls[0]![0]).toBe(oldest[0]!.folder);
  expect(foundProbeExpiry(oldest[0]!)).toBeLessThanOrEqual(oldest[0]!.at + 7 * 86_400_000);
});

it('coalesces affected remaps and preserves unrelated cached probes', async () => {
  const f = await fixture();
  f.add();
  f.add(f.home + '/code/other');
  await f.service.run();
  const before = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  const other = before.probes.find(
    (item: { folder: string }) => item.folder === f.home + '/code/other',
  );
  const save = vi.spyOn(f.service.store, 'save');
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      f.service.remap([
        {
          source: f.root,
          destination: f.home + '/code/renamed-' + index,
        },
      ]),
    ),
  );
  await f.service.close();
  expect(save).toHaveBeenCalledTimes(1);
  const after = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(after.probes).toContainEqual(other);
  expect(after.probes).toHaveLength(before.probes.length);
});

it('keeps remembered entries on Clear without making old memory qualifying evidence', async () => {
  const f = await fixture();
  f.add();
  f.ports.keepOnClear = () => true;
  await f.service.run();
  f.advance(100 * 86_400_000);
  f.state.visits = {};
  await f.service.clearHistory();
  expect(f.service.snapshot().definitions).toHaveLength(1);
  await f.service.run();
  expect(f.service.snapshot().definitions).toHaveLength(0);
});

it('re-keys the stored entry, its live link and memory when an explicit key takes over', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const definition = f.service.snapshot().definitions[0]!;
  const memory = new DefinedWorkspaces(f.directory + '/memory');
  services.push(memory);
  const workspace = spaceAt(f.root);
  workspace.definition = { key: definition.key, basis: definition.basis, source: 'found' };
  const state = { ...f.state, workspaces: [workspace] };
  const sessions = new WorkspaceSessions();
  sessions.seed(state);
  const stale = sessions.open(1, f.home);
  sessions.reserveDefinition(1, definition.key);
  await memory.remember(workspace, state);
  await memory.opened(definition.key);
  const openedAt = memory.openedAt(definition.key);
  f.ports.state = () => sessions.snapshot();
  f.ports.retained = vi.fn((key) => !!sessions.findByDefinition(key) || !!memory.summary(key));
  f.ports.rekey = async (changes) => {
    await memory.rekeyFound(changes);
    await sessions.rekeyFound(changes, async () => {});
  };
  f.ports.explicit = () => [sampleDefinition(definition.key, { root: f.home + '/different' })];
  await f.service.run();
  const next = f.service.snapshot().definitions[0]!;
  expect(next.key).not.toBe(definition.key);
  expect(next.root).toBe(f.root);
  expect(sessions.findByDefinition(next.key)?.id).toBe(workspace.id);
  expect(sessions.definitionOwner(next.key)).toBe(1);
  expect(sessions.definitionOwner(definition.key)).toBeUndefined();
  expect(memory.get(next.key)?.workspace.definition?.key).toBe(next.key);
  expect(memory.get(definition.key)).toBeUndefined();
  expect(memory.openedAt(next.key)).toBe(openedAt);
  expect(memory.openedAt(definition.key)).toBeUndefined();
  expect(f.ports.retained).toHaveBeenCalledWith(definition.key);
  stale.workspaces[0]!.name = 'Renamed while re-keying';
  const saved = sessions.save(1, stale);
  expect(saved.workspaces[0]!.definition?.key).toBe(next.key);
  expect(JSON.parse(await readFile(f.service.store.file, 'utf8')).entries[0].key).toBe(next.key);
});

it('keeps a pending re-key on disk if carrying its owners fails and retries it', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.ports.explicit = () => [sampleDefinition(key, { root: f.home + '/different' })];
  f.ports.rekey = vi.fn(async () => {
    throw new Error('memory unavailable');
  });
  await expect(f.service.run()).rejects.toThrow('memory unavailable');
  const document = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  expect(document.rekeys).toHaveLength(1);
  const rekey = vi.fn(async () => {});
  const fresh = f.create({ rekey });
  await fresh.run();
  expect(rekey).toHaveBeenCalledWith(document.rekeys);
  expect(JSON.parse(await readFile(fresh.store.file, 'utf8')).rekeys).toBeUndefined();
});

it('never uses found roots as capture tokens, and proposes a found root without projectName', () => {
  const home = '/Users/sample';
  const own = sampleDefinition('own', { root: home + '/code/own' });
  const found = sampleDefinition('found-only', {
    root: home + '/code/foreign',
    source: 'found',
    projectName: undefined,
  });
  const workspace = spaceAt(found.root + '/src');
  expect(proposeDefinition(workspace, [own, found], home).key).toBe('found-only');
  const captured = captureDefinition({
    workspace,
    order: ['p0'],
    definition: own,
    entry: { root: '~/code/own' },
    definitions: [own, found],
    home,
  });
  expect(captured.entry.planes).toEqual([{ kind: 'folder', path: '~/code/foreign/src' }]);
});

it('deduplicates realpaths against explicit and earlier found entries, reserving explicit keys', () => {
  const home = '/Users/sample';
  const root = home + '/code/a';
  const alias = home + '/alias';
  const entries = [
    { key: 'code/a', root, realpath: root, identity: '1:2', names: [], at: 1 },
    { key: 'alias', root: alias, realpath: root, identity: '1:2', names: [], at: 1 },
  ];
  expect(foundDefinitions(entries, [], home, hashDefinition)).toHaveLength(1);
  expect(
    foundDefinitions(
      entries,
      [sampleDefinition('explicit', { root: alias })],
      home,
      hashDefinition,
      () => root,
    ),
  ).toEqual([]);
  const result = foundDefinitions(
    entries,
    [sampleDefinition('code/a', { root: home + '/elsewhere' })],
    home,
    hashDefinition,
  );
  expect(result).toHaveLength(1);
  expect(result[0]!.key).not.toBe('code/a');
});

it('chooses the outermost git directory unless it is an umbrella for two inner repositories', () => {
  const home = '/Users/sample';
  const outer = home + '/code';
  const inner = outer + '/one';
  const facts = new Map([
    [outer, { markers: ['.git'], git: 'directory' as const }],
    [inner, { markers: ['.git'], git: 'directory' as const }],
  ]);
  expect(rootFor(inner, facts, { home })).toBe(outer);
  facts.set(outer + '/two', { markers: ['.git'], git: 'directory' });
  expect(rootFor(inner, facts, { home })).toBe(inner);
  expect(rootFor(outer + '/two', facts, { home })).toBe(outer + '/two');
});

it('keeps project names out and target, excludes their generated children and folds APFS boundary case', () => {
  const home = '/Users/sample';
  for (const name of ['out', 'target']) {
    const root = home + '/code/' + name;
    expect(rootFor(root, new Map([[root, { markers: ['package.json'] }]]), { home })).toBe(root);
    const project = home + '/code/sample';
    const generated = project + '/' + name + '/child';
    expect(
      rootFor(
        generated,
        new Map([
          [project, { markers: ['package.json'] }],
          [generated, { markers: ['package.json'] }],
        ]),
        { home },
      ),
    ).toBeUndefined();
  }
  expect(allowedFoundFolder(home + '/library/x', { home })).toBe(false);
  expect(rootAncestors(home + '/documents/notes', { home })).toEqual([home + '/documents/notes']);
});

it('keeps standalone origins and uses the found-off notice without unlocking deletion', () => {
  const found = sampleDefinition('shared', { source: 'standalone' });
  const standalone = {
    ...spaceAt('/sample'),
    definition: { key: 'missing', basis: found.basis, source: 'standalone' as const },
  };
  const spaces = [standalone];
  const catalog = {
    revision: 1,
    file: { path: '/data/workspaces.jsonc', state: 'read' as const },
    projectManager: {
      path: '/source/projects.json',
      state: 'unreadable' as const,
      enabled: true,
      projects: 0,
      missing: 0,
      disabled: 0,
      remote: 0,
      duplicateKeys: 0,
    },
    definitions: [sampleDefinition('missing')],
    diagnostics: [],
  };
  expect(withDefinitionOrigins(spaces, catalog)).toBe(spaces);
  expect(withDefinitionOrigins(spaces, catalog)[0]!.definition!.source).toBe('standalone');
  expect(definitionWasRemoved(standalone, { ...catalog, definitions: [] })).toBe(true);
  const linked = {
    ...standalone,
    definition: { ...standalone.definition, source: 'found' as const },
  };
  const off = {
    ...catalog,
    definitions: [],
    found: { state: 'off' as const, count: 0, hidden: 0 },
  };
  expect(definitionSourceNotice(linked, off)).toBe('Finding workspaces is off.');
  expect(definitionWasRemoved(linked, off)).toBe(false);
  expect(definitionWasRemoved(linked, catalog)).toBe(true);
});

it('pins ownership ties, the sixty-percent threshold, global searches, tiling and inherited terminal profiles', () => {
  const home = '/Users/sample';
  const found = sampleDefinition('found', {
    root: home + '/a',
    source: 'found',
    projectName: undefined,
  });
  const explicit = sampleDefinition('explicit', { root: home + '/a/longer' });
  expect(
    definitionShares(spaceAt(found.root, found.root + '/b', explicit.root, explicit.root + '/b'), [
      found,
      explicit,
    ])[0]!.definition,
  ).toBe(explicit);
  expect(
    mostlyIn(spaceAt(found.root, found.root + '/b', home + '/other', home + '/elsewhere'), [found]),
  ).toBeUndefined();
  const global = {
    id: 'search',
    type: 'search' as const,
    path: found.root,
    query: 'x',
    name: 'All',
    allLocations: true,
    recursive: true,
    content: false,
  };
  expect(
    mostlyIn({ ...spaceAt(found.root), panes: [folderPane('p0', found.root), global] }, [found]),
  ).toBeUndefined();
  const simple = {
    ...found,
    planes: [{ index: 0, plane: { kind: 'folder' as const, path: found.root } }],
  };
  expect(
    addsToDefinition(
      { ...spaceAt(found.root), tiling: { panes: ['p0'], layout: 'tiled', main: 0.5 } },
      simple,
    ),
  ).toBe(true);
  const terminal = {
    ...found,
    terminalProfile: 'login',
    planes: [{ index: 0, plane: { kind: 'terminal' as const, path: found.root } }],
  };
  expect(
    addsToDefinition(
      {
        ...spaceAt(found.root),
        panes: [{ id: 't', type: 'terminal', path: found.root, profileID: 'other' }],
      },
      terminal,
    ),
  ).toBe(true);
});

it('passes setting changes into the finder and leaves offline roots unknown without checking them', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const settings = defaultSettings(f.home);
  const checkRoot = vi.fn(async () => ({ directory: false, missing: true }));
  const definitions = new WorkspaceDefinitions(f.directory + '/configuration', f.home, {
    found: f.service,
    settings: () => settings,
    access: async () => {},
    checkRoot,
    emit: () => {},
  });
  services.push(definitions);
  await definitions.load();
  settings.browsing.findWorkspaces = false;
  f.enabled(false);
  await definitions.reload();
  expect(JSON.parse(await readFile(f.service.store.file, 'utf8')).entries).toEqual([]);
  const offline = sampleDefinition('offline', {
    source: 'found',
    root: '/Volumes/Work/sample',
    rootState: 'unknown',
  });
  const port = {
    load: async () => {},
    configure: async () => {},
    subscribe: () => () => {},
    snapshot: () => ({
      definitions: [offline],
      state: { state: 'ready' as const, count: 1, hidden: 0 },
    }),
    available: () => false,
  };
  const other = new WorkspaceDefinitions(f.directory + '/offline', f.home, {
    found: port,
    settings: () => settings,
    access: async () => {},
    checkRoot,
    emit: () => {},
  });
  services.push(other);
  await other.load();
  expect(await other.checkRoot('offline')).toBe('unknown');
  expect(checkRoot).not.toHaveBeenCalled();
});
it('does not hide an explicit choice or resolve it to the found workspace that used its key', () => {
  const definition = sampleDefinition('taken-key', { name: 'Explicit workspace' });
  const workspace = {
    ...spaceAt('/old'),
    name: 'Original folder',
    definition: { key: definition.key, basis: definition.basis, source: 'found' as const },
  };
  const choices = rankWorkspaceChoices([workspace], [definition], 'explicit');
  expect(choices.some((item) => item.kind === 'defined' && item.key === definition.key)).toBe(true);
  expect(resolveWorkspaceQuery([workspace], [definition], 'taken-key')).toEqual({
    kind: 'defined',
    key: definition.key,
  });
});

it('does not put a found snapshot on an explicit definition while its key migration waits', async () => {
  const f = await fixture();
  const definition = sampleDefinition('taken-key');
  const workspace = {
    ...spaceAt(f.root),
    definition: { key: definition.key, basis: definition.basis, source: 'found' as const },
  };
  const memory = new DefinedWorkspaces(f.directory + '/memory');
  services.push(memory);
  await memory.remember(workspace, f.state);
  const catalog = new WorkspaceDefinitions(f.directory, f.home, {
    memory,
    access: async () => {},
    checkRoot: async () => ({ directory: true }),
    settings: () => defaultSettings(f.home),
    emit: () => {},
  });
  services.push(catalog);
  await writeFile(
    catalog.configuration.file,
    JSON.stringify({
      version: 1,
      workspaces: { [definition.key]: { root: '~/different' } },
    }),
  );
  await catalog.load();
  expect(catalog.entry(definition.key)?.remembered).toBeUndefined();
});

it('shares concurrent key repairs and carries a reservation only for its found owner', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.ports.explicit = () => [sampleDefinition(key, { root: f.home + '/other' })];
  const rekey = vi.fn(async () => {});
  f.ports.rekey = rekey;
  await Promise.all([f.service.reconcileKeys(), f.service.reconcileKeys()]);
  expect(rekey).toHaveBeenCalledTimes(1);
});
it('a person turning finding off clears probes and preserves the loaded hide list', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const document = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  document.hidden = [f.home + '/code/ignore'];
  await writeFile(f.service.store.file, JSON.stringify(document));
  const fresh = f.create();
  await fresh.load();
  f.enabled(false);
  await fresh.configure();
  const off = JSON.parse(await readFile(fresh.store.file, 'utf8'));
  expect(off.entries).toEqual([]);
  expect(off.probes).toEqual([]);
  expect(off.hidden).toEqual(document.hidden);
});
it('Clear also cancels a pass waiting before its probe controller exists', async () => {
  const f = await fixture();
  f.add();
  f.state.workspaces = [spaceAt(f.root)];
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reconcile = f.service.reconcileKeys.bind(f.service);
  vi.spyOn(f.service, 'reconcileKeys').mockImplementation(async () => {
    entered();
    await gate;
    await reconcile();
  });
  const running = f.service.run();
  await waiting;
  f.state.visits = {};
  await f.service.clearHistory();
  release();
  await running;
  expect(f.probe).not.toHaveBeenCalled();
  expect(f.service.snapshot().definitions).toEqual([]);
});
it('Clear keeps the old link while a new key is waiting for its owners', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const key = f.service.snapshot().definitions[0]!.key;
  f.retained.add(key);
  f.ports.keepOnClear = (candidate) => f.retained.has(candidate);
  f.ports.explicit = () => [sampleDefinition(key, { root: f.home + '/other' })];
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.ports.rekey = async (changes) => {
    entered();
    await gate;
    for (const change of changes) {
      f.retained.delete(change.from);
      f.retained.add(change.to);
    }
  };
  const repairing = f.service.reconcileKeys();
  await waiting;
  await f.service.clearHistory();
  release();
  await repairing;
  expect(f.service.snapshot().definitions).toMatchObject([{ root: f.root }]);
});

it('finishes an older key handoff before handling another explicit collision', async () => {
  const f = await fixture();
  f.add();
  await f.service.run();
  const definition = f.service.snapshot().definitions[0]!;
  const workspace = {
    ...spaceAt(f.root),
    definition: { key: definition.key, basis: definition.basis, source: 'found' as const },
  };
  const memory = new DefinedWorkspaces(f.directory + '/memory');
  services.push(memory);
  await memory.remember(workspace, f.state);
  const sessions = new WorkspaceSessions();
  sessions.seed({ ...f.state, workspaces: [workspace] });
  sessions.open(1, f.home);
  f.ports.state = () => sessions.snapshot();
  f.ports.retained = (key) => !!sessions.findByDefinition(key) || !!memory.summary(key);
  const explicit = [sampleDefinition(definition.key, { root: f.home + '/other' })];
  f.ports.explicit = () => explicit;
  f.ports.rekey = async () => {
    throw new Error('try later');
  };
  await expect(f.service.reconcileKeys()).rejects.toThrow('try later');
  const pending = JSON.parse(await readFile(f.service.store.file, 'utf8'));
  const intermediate = pending.entries[0].key;
  explicit.push(sampleDefinition(intermediate, { root: f.home + '/another' }));
  f.ports.rekey = async (changes) => {
    await memory.rekeyFound(changes);
    await sessions.rekeyFound(changes, async () => {});
  };
  await f.service.reconcileKeys();
  const current = f.service.snapshot().definitions[0]!;
  expect(current.key).not.toBe(intermediate);
  expect(memory.get(current.key)?.workspace.id).toBe(workspace.id);
  expect(sessions.findByDefinition(current.key)?.id).toBe(workspace.id);
});
it('publishes unknown for a known found root when the volume signal removes its mount', async () => {
  const f = await fixture();
  let mounted = true;
  let changed!: () => void;
  const definition = sampleDefinition('on-disk', {
    source: 'found',
    root: '/Volumes/Work/sample',
    rootState: 'unknown',
  });
  const checkRoot = vi.fn(async () => ({ directory: true }));
  const service = new WorkspaceDefinitions(f.directory + '/volumes', f.home, {
    found: {
      load: async () => {},
      configure: async () => {},
      subscribe: () => () => {},
      snapshot: () => ({
        definitions: [definition],
        state: { state: 'ready', count: 1, hidden: 0 },
      }),
      available: () => mounted,
    },
    settings: () => defaultSettings(f.home),
    access: async () => {},
    checkRoot,
    emit: () => {},
    watchVolumes: (callback) => {
      changed = callback;
      return () => {};
    },
  });
  services.push(service);
  await service.load();
  expect(await service.checkRoot(definition.key)).toBe('present');
  checkRoot.mockClear();
  mounted = false;
  changed();
  expect(service.entry(definition.key)?.rootState).toBe('unknown');
  expect(checkRoot).not.toHaveBeenCalled();
});
