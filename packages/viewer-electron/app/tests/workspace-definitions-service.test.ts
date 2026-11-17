import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { defaultSettings } from '../src/domain/services';
import { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { checkHistoryFolder } from '../src/desktop/files/folder-history';

const services: WorkspaceDefinitions[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

async function fixture(access = vi.fn(async (_files: readonly string[]) => {})) {
  const root = await temporaryRoot('viewer-workspace-definitions-');
  const home = path.join(root, 'home');
  const folder = path.join(root, 'project');
  const file = path.join(root, 'workspaces.jsonc');
  const source = path.join(root, 'projects.json');
  await mkdir(folder);
  const emit = vi.fn();
  const service = new WorkspaceDefinitions(root, home, {
    access,
    checkRoot: async (file) => {
      await access([file]);
      return checkHistoryFolder(file);
    },
    settings: () => defaultSettings(home),
    emit,
  });
  services.push(service);
  const write = (workspaces = {}, enabled = true) =>
    writeFile(
      file,
      JSON.stringify({
        version: 1,
        sources: { projectManager: { path: source, enabled } },
        workspaces,
      }),
    );
  const projects = (name = 'Sample > site') =>
    writeFile(source, JSON.stringify([{ name, rootPath: folder }]));
  return { root, home, folder, file, source, emit, service, write, projects, access };
}

describe('desktop workspace definition catalog', () => {
  it('keeps ungranted Project Manager overrides quiet while standalone entries work', async () => {
    const f = await fixture(
      vi.fn(async (files: readonly string[]) => {
        if (files[0]?.endsWith('/projects.json'))
          throw Object.assign(new Error('Access required'), { code: 'FILE_ACCESS_REQUIRED' });
      }),
    );
    await f.write({ 'Sample/site': {}, 'Sample/api': {}, independent: { root: f.folder } });
    await f.projects();
    await f.service.load();
    const catalog = f.service.snapshot();
    expect(catalog.projectManager).toMatchObject({ state: 'needs-access', projects: 0 });
    expect(catalog.definitions.map((item) => item.key)).toEqual(['independent']);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        level: 'note',
        message: '2 overrides wait for VS Code Project Manager.',
      }),
    ]);
  });
  it('drops a deleted source after a brief replacement grace and keeps standalone entries', async () => {
    const f = await fixture();
    await f.write({ 'Sample/site': {}, standalone: { root: f.folder } });
    await f.projects();
    await f.service.load();
    await rename(f.source, f.source + '.away');
    await f.service.reload();
    expect(f.service.snapshot().projectManager.state).toBe('unreadable');
    expect(f.service.entry('Sample/site')).toBeDefined();
    await vi.waitFor(() => expect(f.service.snapshot().projectManager.state).toBe('absent'));
    const catalog = f.service.snapshot();
    expect(catalog.projectManager.projects).toBe(0);
    expect(catalog.definitions.map((item) => item.key)).toEqual(['standalone']);
    expect(catalog.diagnostics.filter((issue) => issue.level === 'error')).toEqual([]);
  });
  it('keeps the last valid list during a rename replacement and reads its successor', async () => {
    const f = await fixture();
    await f.write();
    await f.projects();
    await f.service.load();
    await rename(f.source, f.source + '.away');
    await f.service.reload();
    expect(
      f.service
        .snapshot()
        .diagnostics.some(
          (issue) => issue.level === 'note' && issue.message.includes('last valid'),
        ),
    ).toBe(true);
    await f.projects('Successor');
    await f.service.reload();
    expect(f.service.snapshot().projectManager.state).toBe('read');
    expect(f.service.entry('Successor')).toBeDefined();
  });
  it('starts quietly with no definition file and writes its editor schema only', async () => {
    const f = await fixture();
    await f.service.load();
    expect(f.service.snapshot()).toMatchObject({
      file: { state: 'absent' },
      projectManager: { state: 'absent' },
      definitions: [],
    });
    expect(await readdir(f.root)).not.toContain('workspaces.jsonc');
    expect(await readdir(f.root)).toContain('workspaces.schema.json');
    const schema = JSON.parse(await readFile(path.join(f.root, 'workspaces.schema.json'), 'utf8'));
    expect(schema.properties.workspaces.additionalProperties.properties.planes).toBeDefined();
  });
  it('reloads both files live with debounced notifications', async () => {
    const f = await fixture();
    await f.write();
    await f.projects();
    await f.service.load();
    expect(f.service.entry('Sample/site')!.name).toBe('Sample site');
    await f.write({ 'Sample/site': { name: 'Friendly name' } });
    await vi.waitFor(() => expect(f.service.entry('Sample/site')!.name).toBe('Friendly name'), {
      timeout: 3500,
      interval: 50,
    });
    const revision = f.service.snapshot().revision;
    await f.projects('Other > app');
    await vi.waitFor(() => expect(f.service.entry('Other/app')).toBeDefined(), {
      timeout: 3500,
      interval: 50,
    });
    expect(f.service.snapshot().revision).toBeGreaterThan(revision);
    expect(f.emit).toHaveBeenCalled();
  });
  it('keeps last-valid definitions and the last good Project Manager list after parse errors', async () => {
    const f = await fixture();
    await f.write({ 'Sample/site': { name: 'Kept' } });
    await f.projects();
    await f.service.load();
    await writeFile(f.file, '{\n"version": invalid\n}');
    await writeFile(f.source, '[\ninvalid]');
    await f.service.reload();
    const catalog = f.service.snapshot();
    expect(catalog.file.state).toBe('last-valid');
    expect(catalog.projectManager.state).toBe('unreadable');
    expect(f.service.entry('Sample/site')!.name).toBe('Kept');
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ source: 'workspaces.jsonc', line: 2 }),
    );
    expect(
      catalog.diagnostics.some((problem) => problem.message.includes('last valid projects')),
    ).toBe(true);
    const second = new WorkspaceDefinitions(f.root, f.home, {
      access: f.access,
      checkRoot: async (file) => {
        await f.access([file]);
        return checkHistoryFolder(file);
      },
      settings: () => defaultSettings(f.home),
      emit: vi.fn(),
    });
    services.push(second);
    await second.load();
    expect(second.snapshot().file.state).toBe('last-valid');
  });
  it('validates each entry separately and reports missing roots', async () => {
    const f = await fixture();
    await f.write({
      'Sample/site': { typo: true },
      missing: { root: path.join(f.root, 'missing') },
    });
    await f.projects();
    await f.service.load();
    expect(f.service.entry('Sample/site')!.source).toBe('project-manager');
    f.service.searchRoots('missing', 1);
    await vi.waitFor(() => expect(f.service.entry('missing')!.rootState).toBe('missing'));
    expect(
      f.service
        .snapshot()
        .diagnostics.some((problem) => problem.key === 'Sample/site' && problem.line === 1),
    ).toBe(true);
  });
  it('keeps ungranted roots unknown and reports source access quietly', async () => {
    const access = vi.fn(async (files: readonly string[]) => {
      if (files.some((file) => file.endsWith('/project')))
        throw Object.assign(new Error('Grant required'), { code: 'FILE_ACCESS_REQUIRED' });
    });
    const f = await fixture(access);
    await f.write();
    await f.projects();
    await f.service.load();
    expect(f.service.entry('Sample/site')!.rootState).toBe('unknown');
    access.mockImplementation(async () => {
      throw Object.assign(new Error('Grant required'), { code: 'FILE_ACCESS_REQUIRED' });
    });
    await f.service.reload();
    expect(f.service.snapshot()).toMatchObject({
      projectManager: { state: 'needs-access', missing: 0 },
      definitions: [],
    });
  });
  it('watches a changed source path and stops using the disabled source', async () => {
    const f = await fixture();
    await f.write();
    await f.projects();
    await f.service.load();
    const other = path.join(f.root, 'other-projects.json');
    await writeFile(other, JSON.stringify([{ name: 'Other', rootPath: f.folder }]));
    await writeFile(
      f.file,
      JSON.stringify({ version: 1, sources: { projectManager: { path: other } }, workspaces: {} }),
    );
    await f.service.reload();
    expect(f.service.entry('Other')).toBeDefined();
    await f.write({}, false);
    await f.service.reload();
    expect(f.service.snapshot()).toMatchObject({
      projectManager: { state: 'off' },
      definitions: [],
    });
  });
  it('creates a commented starter only on Edit and keeps the existing bytes on later edits', async () => {
    const f = await fixture();
    await f.service.load();
    expect(await f.service.edit()).toBe(f.file);
    expect(await readFile(f.file, 'utf8')).toContain('// Definitions');
    const text = '// keep this comment\n{"version":1,"workspaces":{}}\n';
    await writeFile(f.file, text);
    await f.service.edit();
    expect(await readFile(f.file, 'utf8')).toBe(text);
  });
  it('returns detached snapshots and reads command text without running anything', async () => {
    const f = await fixture();
    await f.write({
      'Sample/site': { planes: [{ kind: 'terminal', path: '.', command: 'echo sample' }] },
    });
    await f.projects();
    await f.service.load();
    const catalog = f.service.snapshot();
    catalog.definitions[0]!.name = 'Changed copy';
    expect(f.service.entry('Sample/site')!.name).not.toBe('Changed copy');
    expect(f.service.command('Sample/site', 0)).toBe('echo sample');
    expect(f.service.command('Sample/site', 1)).toBeUndefined();
  });
});
