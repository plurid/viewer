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
