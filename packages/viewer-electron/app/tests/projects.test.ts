import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Projects, decodeProject } from '../src/desktop/projects';
import {
  projectDefinitionSchema,
  projectReference,
  resolveProjectPath,
  type ProjectDefinition,
} from '../src/domain/project';
import { Storage } from '../src/desktop/storage';
import {
  activeWorkspace,
  flushState,
  folderPresentation,
  getState,
  initialize,
  installProject,
  newWorkspace,
  previewValues,
  receiveSettings,
  savePreviewValue,
  updateFolderPresentation,
} from '../src/renderer/state/store';

const project = (): ProjectDefinition => ({
  version: 1,
  id: 'project',
  name: 'Studio',
  bindings: [{ name: 'assets', label: 'Shared assets' }],
  planes: [
    { id: 'folder', type: 'folder', target: { path: 'Documents' } },
    {
      id: 'preview',
      type: 'preview',
      target: { binding: 'assets', path: 'model.stl' },
      state: { zoom: 1.4 },
    },
    { id: 'terminal', type: 'terminal', target: { path: '.' }, profileID: 'shell' },
  ],
  folders: [{ target: { path: 'Documents' }, view: { mode: 'columns' } }],
  layout: {
    placements: ['folder', 'preview', 'terminal'].map((id, index) => ({
      id,
      parent: index === 1 ? 'folder' : undefined,
      location: { translateX: index * 500, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
      width: 900,
      height: 600,
      show: true,
    })),
    active: 'folder',
    docked: 'folder',
  },
  arrangements: {},
});
let root: string;
const access = vi.fn(async (_files: readonly string[]) => {});
// Unit coverage for storage/CAS. Native coordination is covered in packaged acceptance.
const coordination = { run: async <T>(_intents: unknown, work: () => Promise<T>) => work() };
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-project-'));
  access.mockClear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});
describe('portable project definitions', () => {
  it('relocates local paths and keeps external paths behind named bindings', () => {
    expect(projectReference('/one/project', '/one/project/模型/a.stl', {})).toEqual({
      path: '模型/a.stl',
    });
    expect(resolveProjectPath('/two/project', { path: '模型/a.stl' }, {})).toBe(
      '/two/project/模型/a.stl',
    );
    expect(projectReference('/project', '/assets/a.stl', { shared: '/assets' })).toEqual({
      binding: 'shared',
      path: 'a.stl',
    });
    expect(
      resolveProjectPath('/project', { binding: 'shared', path: 'a.stl' }, {}),
    ).toBeUndefined();
    expect(() => projectReference('/project', '/project-other/a', {})).toThrow('Bind');
    for (const invalid of ['../secret', '/etc/passwd', 'a/../../secret', 'C:/private'])
      expect(() => resolveProjectPath('/project', { path: invalid }, {})).toThrow();
  });
  it('rejects engine references, cycles, undeclared bindings and executable project fields', () => {
    const cyclic = project();
    cyclic.layout.placements[0].parent = 'preview';
    expect(projectDefinitionSchema.safeParse(cyclic).success).toBe(false);
    const unbound = project();
    unbound.bindings = [];
    expect(projectDefinitionSchema.safeParse(unbound).success).toBe(false);
    expect(
      projectDefinitionSchema.safeParse({ ...project(), credentials: { key: 'secret' } }).success,
    ).toBe(false);
    expect(
      projectDefinitionSchema.safeParse({
        ...project(),
        planes: [{ ...project().planes[2], command: 'rm' }],
      }).success,
    ).toBe(false);
  });
  it('preserves comments and refuses stale saves without modifying the project', async () => {
    const service = new Projects(access, coordination),
      file = path.join(root, 'viewer.project.jsonc');
    const created = await service.save(file, '', project());
    const initial = await readFile(file, 'utf8');
    await writeFile(file, initial + '// User notes stay here.\n');
    const read = await service.read(file);
    expect(await readFile(file, 'utf8')).toBe(initial + '// User notes stay here.\n');
    await expect(
      service.save(file, created.revision, { ...project(), name: 'Stale' }),
    ).rejects.toThrow('changed on disk');
    const saved = await service.save(file, read.revision, { ...project(), name: 'Renamed' });
    const text = await readFile(file, 'utf8');
    expect(text).toContain('// User notes stay here.');
    expect(decodeProject(text).name).toBe('Renamed');
    expect(saved.revision).not.toBe(read.revision);
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
  it('requires access for every read/save and rejects symlink substitution', async () => {
    const file = path.join(root, 'viewer.project.jsonc');
    const service = new Projects(access, coordination);
    await service.save(file, '', project());
    access.mockRejectedValueOnce(new Error('revoked'));
    await expect(service.read(file)).rejects.toThrow('revoked');
    access.mockRejectedValueOnce(new Error('revoked'));
    await expect(service.save(file, '', project())).rejects.toThrow('revoked');
    await renameToLink(file);
    await expect(service.read(file)).rejects.toThrow('regular project');
  });
});
async function renameToLink(file: string) {
  const bytes = await readFile(file);
  await rm(file);
  await writeFile(file + '.original', bytes);
  await symlink(file + '.original', file);
}
describe('project sessions', () => {
  it('keeps project views private, retains overrides after settings reload and restores preview state cold', async () => {
    const save = vi.fn(async () => {}),
      settingsPatch = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), viewer: { save, settingsPatch } });
    initialize({ home: root, platform: 'darwin', locations: [], state: null, openPaths: [] });
    await installProject(
      { file: root + '/viewer.project.jsonc', root, revision: 'r', definition: project() },
      { assets: root + '/Assets' },
    );
    expect(activeWorkspace().panes.find((pane) => pane.type === 'terminal')).toMatchObject({
      startOnOpen: false,
    });
    expect(folderPresentation(root + '/Documents').mode).toBe('columns');
    updateFolderPresentation(root + '/Documents', { mode: 'gallery' });
    expect(folderPresentation(root + '/Documents').mode).toBe('gallery');
    expect(settingsPatch).not.toHaveBeenCalled();
    expect(activeWorkspace().project?.definition.folders[0].view.mode).toBe('columns');
    expect(activeWorkspace().project?.dirty).toBe(true);
    receiveSettings({ ...getState().settings, revision: getState().settings.revision + 1 });
    expect(folderPresentation(root + '/Documents').mode).toBe('gallery');
    expect(previewValues('preview').zoom).toBe(1.4);
    savePreviewValue('preview', 'camera', [1, 2, 3]);
    await flushState(false);
    const saved = getState().saved;
    initialize({ home: root, platform: 'darwin', locations: [], state: saved, openPaths: [] });
    expect(previewValues('preview').camera).toEqual([1, 2, 3]);
    await newWorkspace('General');
    expect(folderPresentation(root + '/Documents').mode).toBe('list');
    await flushState(false);
  });
  it('backs up v3 before migrating to v4 without rewriting the original on read', async () => {
    const storage = new Storage(root + '/state.json');
    const original = JSON.stringify({
      version: 3,
      workspaces: [
        { id: 'w', name: 'Work', panes: [], roots: [], arrangement: { engine: 'opaque' } },
      ],
      activeWorkspace: 'w',
      favorites: [],
      recents: [],
      look: 'dark',
    });
    await writeFile(storage.file, original);
    const state = (await storage.load()).state!;
    expect(state.version).toBe(4);
    expect(await readFile(storage.file, 'utf8')).toBe(original);
    const backup = (await readdir(root)).find((file) => file.includes('before-projects-v4'))!;
    expect(await readFile(root + '/' + backup, 'utf8')).toBe(original);
    await storage.save(state);
    expect((await storage.load()).state?.version).toBe(4);
  });
});
