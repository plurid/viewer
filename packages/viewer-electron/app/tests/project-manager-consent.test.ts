import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import * as fileStats from '../src/desktop/files/stats';
import * as fileIO from 'node:fs/promises';
import { schemas } from '../src/desktop/ipc/schemas';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { workspacesFileSchema } from '../src/domain/workspaces/definitions/schema';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import * as projectManager from '../src/desktop/workspaces/project-manager';
import * as watches from '../src/desktop/persistence/watch-file';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import { definitionWasRemoved } from '../src/domain/workspaces/catalog';
import type { Workspace } from '../src/domain/contracts';

vi.mock('node:fs/promises', { spy: true });

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function fixture(enabled?: boolean) {
  const directory = await temporaryRoot('viewer-project-consent-');
  const home = path.join(directory, 'home');
  const source = projectManager.projectManagerPath(home);
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(
    source,
    JSON.stringify([{ name: 'Sample > Site', rootPath: '/projects/sample' }]),
  );
  const access = vi.fn(async () => {});
  const emit = vi.fn();
  const service = new WorkspaceDefinitions(directory, home, {
    access,
    emit,
    settings: () => defaultSettings(home),
    checkRoot: async () => ({ directory: true }),
  });
  services.push(service);
  const text =
    '{\n  "version": 1,\n  // Keep the chosen source path.\n  "sources": { "projectManager": { "path": ' +
    JSON.stringify(source) +
    (enabled === undefined ? '' : ', "enabled": ' + enabled) +
    ' } },\n  // Keep independent definitions.\n  "workspaces": { "notes": { "root": "~/Notes" } }\n}\n';
  await writeFile(service.configuration.file, text);
  return { directory, home, source, access, emit, service, text };
}

it('keeps an absent Project Manager choice undecided in the schema', () => {
  expect(workspacesFileSchema.parse({ version: 1 }).sources.projectManager.enabled).toBeUndefined();
  expect(
    workspacesFileSchema.parse({
      version: 1,
      sources: { projectManager: { path: '~/Lists/projects.json' } },
    }).sources.projectManager,
  ).toEqual({ path: '~/Lists/projects.json' });
});

it('an undecided source checks existence without reading, counting, watching or requesting access', async () => {
  const f = await fixture();
  const read = vi.spyOn(projectManager, 'readProjectManager');
  const fileRead = vi.spyOn(fileIO, 'readFile');
  const watch = vi.spyOn(watches, 'watchFileChanges');
  await f.service.load();
  expect(read).not.toHaveBeenCalled();
  expect(fileRead.mock.calls.some(([file]) => file === f.source)).toBe(false);
  expect(f.access).not.toHaveBeenCalled();
  expect(watch.mock.calls.some(([file]) => file === f.source)).toBe(false);
  expect(f.service.snapshot().projectManager).toMatchObject({
    state: 'undecided',
    projects: 0,
    disabled: 0,
    remote: 0,
    duplicateKeys: 0,
  });
  expect(f.service.snapshot().definitions.map((entry) => entry.key)).toEqual(['notes']);
  expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
});

it('accepts only an explicit boolean choice without extra paths or commands at IPC', () => {
  for (const enabled of [true, false])
    expect(
      schemas.workspaceDefinitionFile.safeParse([{ kind: 'project-manager', enabled }]).success,
    ).toBe(true);
  for (const request of [
    { kind: 'project-manager' },
    { kind: 'project-manager', enabled: 'true' },
    { kind: 'project-manager', enabled: true, path: '/source/other.json' },
    { kind: 'project-manager', enabled: true, command: 'echo sample' },
    { kind: 'catalog', enabled: true },
  ])
    expect(schemas.workspaceDefinitionFile.safeParse([request]).success).toBe(false);
});

it('Use writes only the choice with comments kept; Don’t use drops stubs and stops watching', async () => {
  const f = await fixture();
  const stops = new Map<string, ReturnType<typeof vi.fn>>();
  const watch = vi.spyOn(watches, 'watchFileChanges').mockImplementation((file) => {
    const stop = vi.fn();
    stops.set(file, stop);
    return stop;
  });
  await f.service.load();
  await f.service.setProjectManager(true);
  expect(
    parse(await readFile(f.service.configuration.file, 'utf8')).sources.projectManager,
  ).toEqual({ path: f.source, enabled: true });
  expect(f.service.entry('Sample/Site')).toBeDefined();
  const text = await readFile(f.service.configuration.file, 'utf8');
  expect(text).toContain('// Keep the chosen source path.');
  expect(text).toContain('// Keep independent definitions.');
  expect(text.slice(text.indexOf('  // Keep independent definitions.'))).toBe(
    f.text.slice(f.text.indexOf('  // Keep independent definitions.')),
  );
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await f.service.setProjectManager(false);
  expect(read).not.toHaveBeenCalled();
  expect(stops.get(f.source)).toHaveBeenCalledOnce();
  expect(watch.mock.calls.filter(([file]) => file === f.source)).toHaveLength(1);
  expect(f.service.snapshot().projectManager).toMatchObject({
    state: 'off',
    enabled: false,
    projects: 0,
  });
  expect(f.service.snapshot().definitions.map((item) => item.key)).toEqual(['notes']);
});

it('Don’t use decides without ever reading a list', async () => {
  const f = await fixture();
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await f.service.load();
  await f.service.setProjectManager(false);
  expect(read).not.toHaveBeenCalled();
  expect(f.service.snapshot().projectManager.state).toBe('off');
  expect(
    parse(await readFile(f.service.configuration.file, 'utf8')).sources.projectManager.enabled,
  ).toBe(false);
});

it.each([true, false])(
  'preserves an existing explicit choice and its bytes (%s)',
  async (enabled) => {
    const f = await fixture(enabled);
    const read = vi.spyOn(projectManager, 'readProjectManager');
    await f.service.load();
    expect(f.service.snapshot().projectManager).toMatchObject({
      enabled,
      state: enabled ? 'read' : 'off',
    });
    expect(read).toHaveBeenCalledTimes(enabled ? 1 : 0);
    await f.service.edit();
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  },
);

it('starts quietly, and Edit creates an undecided starter without reading the existing list', async () => {
  const f = await fixture();
  await rename(f.service.configuration.file, f.service.configuration.file + '.kept');
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await f.service.load();
  expect(await readdir(f.directory)).not.toContain('workspaces.jsonc');
  expect(f.service.snapshot().definitions).toEqual([]);
  expect(f.service.snapshot().diagnostics).toEqual([]);
  expect(
    f.emit.mock.calls.every(
      ([catalog]) => catalog.definitions.length === 0 && catalog.projectManager.projects === 0,
    ),
  ).toBe(true);
  await f.service.edit();
  const text = await readFile(f.service.configuration.file, 'utf8');
  expect(text).toContain('// "sources":');
  expect(workspacesFileSchema.parse(parse(text)).sources.projectManager.enabled).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
  await f.service.edit();
  expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
});

it.each([true, false])(
  'an explicit choice creates the starter when the file is absent (%s)',
  async (enabled) => {
    const f = await fixture();
    await rename(f.service.configuration.file, f.service.configuration.file + '.kept');
    await f.service.load();
    await f.service.setProjectManager(enabled);
    const text = await readFile(f.service.configuration.file, 'utf8');
    expect(text).toContain('// Definitions are searched');
    expect(parse(text).sources.projectManager.enabled).toBe(enabled);
    expect(text.match(/"sources"/g)).toHaveLength(1);
    expect(text.indexOf('"sources"')).toBeLessThan(text.indexOf('"workspaces"'));
    expect(text).not.toContain('// "sources":');
  },
);

it('shows no offer when absent, and detects a list created later without watching its contents', async () => {
  const f = await fixture();
  const kept = f.source + '.kept';
  await rename(f.source, kept);
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await f.service.load();
  expect(f.service.snapshot().projectManager.state).toBe('absent');
  await rename(kept, f.source);
  await f.service.refreshSourceOffer();
  expect(f.service.snapshot().projectManager.state).toBe('undecided');
  expect(read).not.toHaveBeenCalled();
  await rename(f.source, kept);
  await f.service.refreshSourceOffer();
  expect(f.service.snapshot().projectManager.state).toBe('absent');
});

it.each([true, false])(
  'deciding after Edit fills the starter source slot in place (%s)',
  async (enabled) => {
    const f = await fixture();
    await rename(f.service.configuration.file, f.service.configuration.file + '.kept');
    await f.service.load();
    await f.service.edit();
    const before = await readFile(f.service.configuration.file, 'utf8');
    await f.service.setProjectManager(enabled);
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(
      before.replace(
        '// "sources": { "projectManager": { "enabled": true } },',
        '"sources": { "projectManager": { "enabled": ' + enabled + ' } },',
      ),
    );
  },
);

const earlierStarter = `// Definitions are searched by name and opened as whole workspaces.
// VS Code Project Manager is read live. An entry with the same key overrides its project.
{
  "$schema": "workspaces.schema.json",
  "version": 1,
  "sources": { "projectManager": { "enabled": true } },
  "workspaces": {
    // Keep a handwritten entry.
    "notes": { "root": "~/Notes" }
  }
}
`;

it.each([true, false])(
  'keeps a CRLF earlier starter undecided until the person chooses (%s)',
  async (enabled) => {
    const f = await fixture();
    const text = earlierStarter.replace(/\n/g, '\r\n');
    await writeFile(f.service.configuration.file, text);
    const read = vi.spyOn(projectManager, 'readProjectManager');
    await f.service.load();
    expect(f.service.snapshot().projectManager.enabled).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
    await f.service.setProjectManager(enabled);
    await f.service.reload();
    expect(f.service.snapshot().projectManager.enabled).toBe(enabled);
    const after = await readFile(f.service.configuration.file, 'utf8');
    expect(after).toContain('\r\n');
    expect(after.slice(after.indexOf('  "workspaces"'))).toBe(
      text.slice(text.indexOf('  "workspaces"')),
    );
  },
);

it.each([true, false])(
  'keeps a source path and its comments added after Edit (%s)',
  async (enabled) => {
    const f = await fixture();
    await rename(f.service.configuration.file, f.service.configuration.file + '.kept');
    await f.service.load();
    await f.service.edit();
    const starter = await readFile(f.service.configuration.file, 'utf8');
    const text = starter.replace(
      '  "workspaces": {',
      `  "sources": { "projectManager": {
    // Keep the chosen list.
    "path": "~/Lists/projects.json"
  } },
  "workspaces": {`,
    );
    await writeFile(f.service.configuration.file, text);
    await f.service.reload();
    await f.service.setProjectManager(enabled);
    const after = await readFile(f.service.configuration.file, 'utf8');
    expect(parse(after).sources.projectManager).toEqual({ path: '~/Lists/projects.json', enabled });
    expect(after.match(/"sources"/g)).toHaveLength(1);
    expect(after).toContain('// Keep the chosen list.');
  },
);

it.each([true, false])(
  'asks again for the exact earlier starter until a choice is written (%s)',
  async (enabled) => {
    const f = await fixture();
    await writeFile(f.service.configuration.file, earlierStarter);
    const read = vi.spyOn(projectManager, 'readProjectManager');
    await f.service.load();
    await f.service.edit();
    expect(f.service.snapshot().projectManager).toMatchObject({ state: 'undecided' });
    expect(f.service.snapshot().projectManager.enabled).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(await readFile(f.service.configuration.file, 'utf8')).toBe(earlierStarter);
    expect(
      parse(await readFile(f.service.configuration.file + '.last-valid', 'utf8')).sources
        .projectManager.enabled,
    ).toBeUndefined();
    await f.service.setProjectManager(enabled);
    const after = await readFile(f.service.configuration.file, 'utf8');
    expect(after.match(/"sources"/g)).toHaveLength(1);
    expect(after.indexOf('"sources"')).toBeLessThan(after.indexOf('"workspaces"'));
    expect(after.slice(after.indexOf('  "workspaces"'))).toBe(
      earlierStarter.slice(earlierStarter.indexOf('  "workspaces"')),
    );
    await f.service.reload();
    expect(f.service.snapshot().projectManager).toMatchObject({
      enabled,
      state: enabled ? 'read' : 'off',
    });
  },
);

it.each([
  earlierStarter.replace('"enabled": true', '"enabled": false'),
  earlierStarter.replace('"enabled": true', '"enabled":  true'),
  earlierStarter.replace('VS Code Project Manager is read live.', 'Use my VS Code projects.'),
  earlierStarter.replace('"enabled": true', '"enabled": true, "path": "~/Lists/projects.json"'),
])('keeps an edited earlier starter as an explicit decision', async (text) => {
  const f = await fixture();
  await writeFile(f.service.configuration.file, text);
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await f.service.load();
  const enabled = parse(text).sources.projectManager.enabled;
  expect(f.service.snapshot().projectManager.enabled).toBe(enabled);
  expect(read).toHaveBeenCalledTimes(enabled ? 1 : 0);
  await f.service.edit();
  expect(await readFile(f.service.configuration.file, 'utf8')).toBe(text);
});

it('protects an existing project link while undecided, enabled and disabled again', async () => {
  const f = await fixture();
  const linked = {
    id: 'open',
    name: 'Site',
    definition: { key: 'Sample/Site', basis: 'a'.repeat(64) },
    panes: [],
    roots: [],
    arrangement: {},
  } as Workspace;
  await f.service.load();
  expect(definitionWasRemoved(linked, f.service.snapshot())).toBe(false);
  await f.service.setProjectManager(true);
  expect(f.service.entry(linked.definition!.key)).toBeDefined();
  expect(definitionWasRemoved(linked, f.service.snapshot())).toBe(false);
  await f.service.setProjectManager(false);
  expect(f.service.entry(linked.definition!.key)).toBeUndefined();
  expect(definitionWasRemoved(linked, f.service.snapshot())).toBe(false);
  await f.service.setProjectManager(true);
  expect(f.service.entry(linked.definition!.key)).toBeDefined();
  expect(linked.definition).toEqual({ key: 'Sample/Site', basis: 'a'.repeat(64) });
});

it.each(['EPERM', 'EACCES'])(
  'offers a sandbox-refused list without reading or requesting access (%s)',
  async (code) => {
    const f = await fixture();
    const original = fileStats.stat;
    vi.spyOn(fileStats, 'stat').mockImplementation(async (file) => {
      if (file === f.source) throw Object.assign(new Error('Access refused'), { code });
      return original(file);
    });
    const read = vi.spyOn(projectManager, 'readProjectManager');
    f.access.mockRejectedValue(
      Object.assign(new Error('Access required'), { code: 'FILE_ACCESS_REQUIRED' }),
    );
    await f.service.load();
    expect(f.service.snapshot().projectManager.state).toBe('undecided');
    expect(read).not.toHaveBeenCalled();
    expect(f.access).not.toHaveBeenCalled();
    await f.service.setProjectManager(true);
    expect(f.access).toHaveBeenCalledOnce();
    expect(f.service.snapshot().projectManager.state).toBe('needs-access');
  },
);

it('does not offer a directory at the list path', async () => {
  const f = await fixture();
  await rename(f.source, f.source + '.kept');
  await mkdir(f.source);
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await f.service.load();
  expect(f.service.snapshot().projectManager.state).toBe('absent');
  expect(read).not.toHaveBeenCalled();
});

it('keeps at most two raw presence checks in flight across different paths', async () => {
  const finishes: Array<(value: Awaited<ReturnType<typeof fileStats.stat>>) => void> = [];
  const stat = vi
    .spyOn(fileStats, 'stat')
    .mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
  const first = projectManager.projectManagerExists('/fixtures/first/projects.json');
  const second = projectManager.projectManagerExists('/fixtures/second/projects.json');
  expect(await projectManager.projectManagerExists('/fixtures/third/projects.json')).toBe(false);
  expect(stat).toHaveBeenCalledTimes(2);
  for (const finish of finishes) finish({ isFile: () => true } as never);
  expect(await Promise.all([first, second])).toEqual([true, true]);
});

it.each([true, false])('refreshing an offer never reverts a decision (%s)', async (enabled) => {
  const f = await fixture(enabled);
  await f.service.load();
  const exists = vi.spyOn(projectManager, 'projectManagerExists');
  await f.service.refreshSourceOffer();
  expect(f.service.snapshot().projectManager).toMatchObject({
    enabled,
    state: enabled ? 'read' : 'off',
  });
  expect(exists).not.toHaveBeenCalled();
});

it('ignores an undecided presence result that finishes after a decision', async () => {
  const f = await fixture();
  await f.service.load();
  let finish!: (exists: boolean) => void;
  vi.spyOn(projectManager, 'projectManagerExists').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const refresh = f.service.refreshSourceOffer();
  await f.service.setProjectManager(true);
  const revision = f.service.snapshot().revision;
  finish(true);
  await refresh;
  expect(f.service.snapshot().projectManager).toMatchObject({ enabled: true, state: 'read' });
  expect(f.service.snapshot().revision).toBe(revision);
});

it('stops the source watcher when the person writes false in the file', async () => {
  const f = await fixture(true);
  const stop = vi.fn();
  vi.spyOn(watches, 'watchFileChanges').mockImplementation((file) =>
    file === f.source ? stop : vi.fn(),
  );
  await f.service.load();
  const read = vi.spyOn(projectManager, 'readProjectManager');
  await writeFile(
    f.service.configuration.file,
    f.text.replace('"enabled": true', '"enabled": false'),
  );
  await f.service.reload();
  expect(stop).toHaveBeenCalledOnce();
  expect(read).not.toHaveBeenCalled();
  expect(f.service.snapshot().projectManager.state).toBe('off');
});

it('stops watching synchronously when Don’t use is chosen', async () => {
  const f = await fixture(true);
  const stop = vi.fn();
  vi.spyOn(watches, 'watchFileChanges').mockImplementation((file) =>
    file === f.source ? stop : vi.fn(),
  );
  await f.service.load();
  const deciding = f.service.setProjectManager(false);
  const stoppedBeforeWriting = stop.mock.calls.length;
  await deciding;
  expect(stoppedBeforeWriting).toBe(1);
});

it('rechecks the human inside the choice update before writing', async () => {
  const f = await fixture();
  await f.service.load();
  const human = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw new Error('Human only');
    });
  await expect(f.service.setProjectManager(true, human)).rejects.toThrow('Human only');
  expect(human).toHaveBeenCalledTimes(2);
  expect(await readFile(f.service.configuration.file, 'utf8')).toBe(f.text);
  expect(f.service.snapshot().projectManager.state).toBe('undecided');
});

it('bounds stalled existence checks and shares pending metadata reads', async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof fileStats.stat>>) => void;
  const stat = vi.spyOn(fileStats, 'stat').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = projectManager.projectManagerExists('/fixtures/stalled/projects.json');
  const second = projectManager.projectManagerExists('/fixtures/stalled/projects.json');
  await vi.advanceTimersByTimeAsync(151);
  expect(await first).toBe(false);
  expect(await second).toBe(false);
  expect(stat).toHaveBeenCalledOnce();
  finish({ isFile: () => true } as never);
});

it('Store access is checked only after Use, with the choice already on disk', async () => {
  const f = await fixture();
  f.access.mockImplementation(async () => {
    expect(
      parse(await readFile(f.service.configuration.file, 'utf8')).sources.projectManager.enabled,
    ).toBe(true);
    throw Object.assign(new Error('Access required'), { code: 'FILE_ACCESS_REQUIRED' });
  });
  await f.service.load();
  expect(f.access).not.toHaveBeenCalled();
  await f.service.setProjectManager(true);
  expect(f.access).toHaveBeenCalledOnce();
  expect(f.service.snapshot().projectManager).toMatchObject({
    state: 'needs-access',
    enabled: true,
  });
  expect(f.service.snapshot().definitions.map((item) => item.key)).toEqual(['notes']);
});
