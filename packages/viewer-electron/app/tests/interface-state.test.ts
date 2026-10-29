import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { OperationJob, OperationProgress } from '../src/domain/contracts';
import type { CommandContext } from '../src/renderer/commands/registry';
import { setWorkspaceOverride } from '../src/renderer/state/workspaces';
import { stateSchema } from '../src/desktop/persistence/storage';
import { normalizePreferences, reorder } from '../src/domain/preferences/ui';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { windowCommands, type WindowActions } from '../src/renderer/commands/window';
import {
  activeWorkspace,
  addRootFolder,
  addFavorite,
  addPane,
  changePreferences,
  deleteWorkspace,
  flushState,
  folderPane,
  getState,
  initialize,
  needsOperations,
  newWorkspace,
  receiveJob,
  receiveSettings,
  receiveProgress,
  setJobs,
  setActivePane,
  updatePane,
  renameShortcut,
  restoreWorkspace,
  setOperationsOpen,
  storageAdapter,
  removePanes,
} from '../src/renderer/state/store';

const operate = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      save: vi.fn(async (state) => {
        stateSchema.parse(state);
      }),
      operate,
    },
  });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    locations: [
      { path: '/fixtures', name: 'Home' },
      { path: '/fixtures/Downloads', name: 'Downloads' },
    ],
    state: null,
    openPaths: [],
  });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('layout-only changes', () => {
  it('can discover the real command catalog outside each command’s guarded context', () => {
    const actions = {
      workspace: {
        parentPaneID: () => undefined,
        isDocked: () => false,
        arrangementHistory: () => ({ canUndo: false, canRedo: false }),
        hasRepeatedPreviews: () => false,
      },
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const registry = new CommandRegistry();
    const context: CommandContext = {
      scope: 'folder',
      workspaceID: activeWorkspace().id,
      paneID: getState().activePane,
      folder: activeWorkspace().panes[0] as never,
      selection: [],
      clipboard: null,
      jobs: [],
    };
    registry.register('window', {
      context: () => context,
      definitions: () => windowCommands(actions),
    });
    for (const scope of ['folder', 'files', 'preview', 'sidebar', 'window'] as const) {
      expect(() => registry.discover({ scope })).not.toThrow();
      const rows = registry.discover({ scope });
      expect(rows.length).toBeGreaterThan(40);
      for (const command of rows)
        expect(registry.label(command.id, { ...context, scope })).toBeTruthy();
    }
  });
  it('uses independent first-plane and populated-workspace folder preferences', () => {
    const snapshot = getState().settings;
    receiveSettings({
      ...snapshot,
      revision: snapshot.revision + 1,
      settings: {
        ...snapshot.settings,
        browsing: {
          ...snapshot.settings.browsing,
          newPlaneLocation: 'current',
          emptyWorkspaceLocation: 'downloads',
        },
      },
    });
    removePanes(activeWorkspace().panes.map((pane) => pane.id));
    const first = addRootFolder()!;
    expect(first.path).toBe('/fixtures/Downloads');
    const second = addRootFolder({ paneID: first.id, path: '/fixtures/Documents' })!;
    expect(second.path).toBe('/fixtures/Documents');
    expect(addRootFolder({ paneID: second.id })?.path).toBe('/fixtures/Documents');
    expect(activeWorkspace().roots).toHaveLength(3);
    expect(operate).not.toHaveBeenCalled();
  });
  it('binds every default shortcut and menu command to a registered command', async () => {
    const { folderCommands } = await import('../src/renderer/commands/folder');
    const { programCommands } = await import('../src/renderer/commands/programs');
    const { readFile } = await import('node:fs/promises');
    const { defaultShortcuts, shortcutCommandID } =
      await import('../src/domain/preferences/shortcuts');
    const actions = {
      workspace: {
        newRootFolder: addRootFolder,
        parentPaneID: () => undefined,
        isDocked: () => false,
        arrangementHistory: () => ({ canUndo: false, canRedo: false }),
        hasRepeatedPreviews: () => false,
      },
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const registered = new Set(
      [
        ...windowCommands(actions),
        ...folderCommands({} as never),
        // the App registers these too: terminals, configuration, custom actions
        ...programCommands(actions.workspace, async () => false),
      ].map((command) => command.id),
    );
    const missing = Object.keys(defaultShortcuts)
      .map(shortcutCommandID)
      .filter((id) => !registered.has(id));
    expect(missing).toEqual([]);
    const menu = [...(await readFile('src/main.ts', 'utf8')).matchAll(/command\('([^']+)'\)/g)]
      .map((match) => match[1])
      .filter((id) => !registered.has(id));
    expect(menu).toEqual([]);
  });
  it('rebuilds the native menu when a listed custom action changes, and only then', async () => {
    const { nativeMenuBindings } = await import('../src/domain/preferences/shortcuts');
    const { defaultSettings } = await import('../src/domain/services');
    const settings = defaultSettings('/fixtures');
    const action = {
      id: 'zip-it',
      name: 'Zip it',
      aliases: [],
      icon: 'command',
      shortcut: '',
      order: 0,
      pinned: false,
      when: { target: 'any' as const, extensions: [], min: 0, max: 10000 },
      executor: { kind: 'builtin' as const, command: 'compress' },
    };
    const signatures = [nativeMenuBindings(settings)];
    settings.customActions.push(action);
    signatures.push(nativeMenuBindings(settings));
    action.name = 'Compress selection';
    signatures.push(nativeMenuBindings(settings));
    action.shortcut = 'Cmd+Alt+Z';
    signatures.push(nativeMenuBindings(settings));
    action.order = 2;
    signatures.push(nativeMenuBindings(settings));
    expect(new Set(signatures).size).toBe(signatures.length);
    settings.previews.thumbnailSize = 512;
    expect(nativeMenuBindings(settings)).toBe(signatures.at(-1));
  });
  it('creates a root from captured command ownership even if the active pane changes', async () => {
    const owner = activeWorkspace().panes[0];
    const workspaceID = activeWorkspace().id;
    const other = addPane('/fixtures/other', 'folder', true);
    const actions = {
      workspace: {
        newRootFolder: addRootFolder,
        parentPaneID: () => undefined,
        isDocked: () => false,
        arrangementHistory: () => ({ canUndo: false, canRedo: false }),
        hasRepeatedPreviews: () => false,
      },
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => ({
        scope: 'window',
        workspaceID: activeWorkspace().id,
        paneID: getState().activePane,
        selection: [],
        clipboard: null,
        jobs: [],
      }),
      definitions: () => windowCommands(actions),
      valid: (invocation) => invocation.workspaceID === activeWorkspace().id,
    });
    const request = {
      paneID: owner.id,
      scope: 'folder' as const,
      context: { paneID: owner.id, workspaceID },
    };
    const command = registry.list(request).find((command) => command.id === 'new-root-folder')!;
    setActivePane(other.id);
    expect(await registry.run(command)).toBe(true);
    expect(activeWorkspace().panes.at(-1)?.path).toBe(owner.path);
    expect(activeWorkspace().roots).toHaveLength(3);
    await registry.invoke('shortcut-new-root', {
      scope: 'sidebar',
      context: {
        paneID: owner.id,
        workspaceID,
        sidebar: { section: 'favorites', path: '/fixtures/shortcut' },
      },
    });
    expect(activeWorkspace().panes.at(-1)?.path).toBe('/fixtures/shortcut');
    expect(activeWorkspace().roots).toHaveLength(4);
    await newWorkspace('Elsewhere');
    const elsewhere = activeWorkspace().panes;
    expect(await registry.run(command)).toBe(false);
    expect(activeWorkspace().panes).toEqual(elsewhere);
    expect(operate).not.toHaveBeenCalled();
  });
  it('deletes and restores a workspace with its arrangement, preserving jobs and paths', async () => {
    addPane('/fixtures/project.glb', 'preview', false);
    const id = activeWorkspace().id;
    storageAdapter(id).setItem('engine', 'layout');
    await newWorkspace('Second');
    const second = activeWorkspace().id;
    const job = { id: 'job', status: 'running' } as OperationJob;
    receiveJob(job);
    await deleteWorkspace(id);
    expect(getState().saved.workspaces.map((space) => space.id)).toEqual([second]);
    expect(getState().jobs).toEqual([job]);
    expect(operate).not.toHaveBeenCalled();
    await restoreWorkspace();
    expect(activeWorkspace().id).toBe(id);
    expect(activeWorkspace().panes.map((pane) => pane.path)).toEqual([
      '/fixtures',
      '/fixtures/project.glb',
    ]);
    expect(storageAdapter(id).getItem('engine')).toBe('layout');
    expect(getState().jobs).toEqual([job]);
    expect(operate).not.toHaveBeenCalled();
  });
  it('restores a deleted workspace once when Undo is asked for twice (2026-10-20)', async () => {
    // A second Undo during the first one's flush restored it again: two workspaces with one ID,
    // after which every state save failed.
    const id = activeWorkspace().id;
    await newWorkspace('Second');
    await deleteWorkspace(id);
    await Promise.all([restoreWorkspace(), restoreWorkspace()]);
    const ids = getState().saved.workspaces.map((space) => space.id);
    expect(ids.filter((value) => value === id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('replaces the last workspace with an empty one and restores without orphaning it', async () => {
    const id = activeWorkspace().id;
    await deleteWorkspace(id);
    expect(getState().saved.workspaces).toHaveLength(1);
    expect(activeWorkspace().panes).toEqual([]);
    const replacement = activeWorkspace().id;
    await restoreWorkspace();
    expect(activeWorkspace().id).toBe(id);
    expect(getState().saved.workspaces.some((space) => space.id === replacement)).toBe(false);
    expect(stateSchema.safeParse(getState().saved).success).toBe(true);
    expect(operate).not.toHaveBeenCalled();
  });
  it('retains work added to a replacement workspace when restoring the deleted layout', async () => {
    const id = activeWorkspace().id;
    await deleteWorkspace(id);
    addPane('/fixtures/new', 'folder', true);
    const replacement = activeWorkspace().id;
    await restoreWorkspace();
    expect(getState().saved.workspaces.map((space) => space.id)).toEqual([id, replacement]);
  });
  it('reorders and renames shortcuts without moving files; Recents remain chronological', async () => {
    addFavorite('/fixtures/one', 'One');
    addFavorite('/fixtures/two', 'Two');
    addFavorite('/fixtures/two', 'Two', '/fixtures/one');
    renameShortcut('/fixtures/two', 'Projects');
    expect(getState().saved.favorites.map((item) => item.path)).toEqual([
      '/fixtures/two',
      '/fixtures/one',
    ]);
    expect(getState().saved.ui.sidebar.labels['/fixtures/two']).toBe('Projects');
    const recents = [...getState().saved.recents];
    const actions = {
      workspace: {
        isDocked: () => false,
        arrangementHistory: () => ({ canUndo: false, canRedo: false }),
        hasRepeatedPreviews: () => false,
      },
      ready: false,
      tool: null,
    } as unknown as WindowActions;
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => ({
        scope: 'sidebar',
        workspaceID: activeWorkspace().id,
        selection: [],
        clipboard: null,
        jobs: [],
        sidebar: { section: 'locations', path: '/fixtures/Downloads', name: 'Downloads' },
      }),
      definitions: () => windowCommands(actions),
    });
    await registry.invoke('shortcut-up', { sources: ['window'] });
    await registry.invoke('section-collapse', { sources: ['window'] });
    await registry.invoke('section-down', { sources: ['window'] });
    expect(getState().saved.ui.sidebar.locations[0]).toBe('/fixtures/Downloads');
    expect(getState().saved.ui.sidebar.collapsed).toEqual(['locations']);
    expect(getState().saved.ui.sidebar.order).toEqual(['favorites', 'locations', 'recents']);
    expect(getState().saved.recents).toEqual(recents);
    expect(operate).not.toHaveBeenCalled();
  });
  it('loads state without interface preferences and falls back independently for invalid ones', () => {
    const { ui: _ui, ...earlier } = getState().saved;
    const parsed = stateSchema.parse(earlier);
    expect(parsed.ui.space).not.toHaveProperty('backs');
    const corrupt = stateSchema.parse({
      ...earlier,
      ui: {
        sidebar: { visible: false, width: 'wide', order: ['recents', 'recents', 'bad'] },
        space: { backs: false, minimap: true },
        recentCommands: ['rename', 'rename', 9],
      },
    });
    expect(corrupt.workspaces).toEqual(earlier.workspaces);
    expect(corrupt.ui.sidebar.visible).toBe(false);
    expect(corrupt.ui.sidebar.width).toBe(210);
    expect(corrupt.ui.sidebar.order).toEqual(['recents', 'locations', 'favorites']);
    expect(corrupt.ui.space).toEqual(normalizePreferences().space);
    expect(corrupt.ui.recentCommands).toEqual(['rename']);
    expect(normalizePreferences('broken')).toEqual(normalizePreferences());
  });
  it('restores spatial aids once, then preserves explicit off choices across reloads', async () => {
    const migrated = normalizePreferences({
      space: { toolbar: false, minimap: false, viewcube: false },
    });
    expect(migrated.version).toBe(3);
    expect(migrated.space).toMatchObject({ toolbar: true, minimap: true, viewcube: true });
    changePreferences((ui) => ({
      ...ui,
      space: { ...ui.space, toolbar: false, minimap: false, viewcube: false },
    }));
    await flushState(false);
    initialize({ ...getState().bootstrap, state: stateSchema.parse(getState().saved) });
    expect(getState().saved.ui.space).toMatchObject({
      toolbar: false,
      minimap: false,
      viewcube: false,
    });
    expect(
      stateSchema.parse({
        ...getState().saved,
        ui: { version: 2, space: { minimap: 'bad', viewcube: false } },
      }).ui.space,
    ).toMatchObject({ minimap: true, viewcube: false });
  });
  it('saves independent plane navigation and applies its default only to newly created folders', async () => {
    const first = activeWorkspace().panes[0];
    changePreferences((ui) => ({ ...ui, sidebar: { ...ui.sidebar, inNewPlanes: true } }));
    const second = addPane('/fixtures/second', 'folder', true);
    updatePane(second.id, { sidebar: { visible: true, width: 280 } });
    expect(first.type === 'folder' && first.sidebar?.visible).toBe(true);
    expect(getState().saved.ui.sidebar.width).toBe(210);
    await flushState(false);
    const parsed = stateSchema.parse(getState().saved);
    expect(parsed.workspaces[0].panes[1]).toMatchObject({ sidebar: { visible: true, width: 280 } });
    const corrupt = structuredClone(parsed);
    Object.assign(corrupt.workspaces[0].panes[1], { sidebar: { visible: true, width: 'wide' } });
    expect(stateSchema.parse(corrupt).workspaces[0].panes[1]).toMatchObject({
      sidebar: { visible: true, width: 210 },
    });
    expect(operate).not.toHaveBeenCalled();
  });
  it('uses the resolved navigation default for task folders and ordinary new planes', () => {
    setWorkspaceOverride('ui.sidebar.inNewPlanes', false);
    expect(getState().saved.ui.sidebar.inNewPlanes).toBe(true);
    expect(folderPane('/fixtures/task').sidebar?.visible).toBe(false);
    const next = addPane('/fixtures/next', 'folder', true);
    expect(next.type === 'folder' && next.sidebar?.visible).toBe(false);
  });
  it('remembers Hide/Show navigation for the workspace folders and future planes without changing their widths', async () => {
    const first = activeWorkspace().panes[0]!;
    const second = addPane('/fixtures/second', 'folder', true);
    updatePane(second.id, { sidebar: { visible: true, width: 280 } });
    const actions = {
      workspace: {
        isDocked: () => false,
        arrangementHistory: () => ({ canUndo: false, canRedo: false }),
        hasRepeatedPreviews: () => false,
      },
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const toggle = async () => {
      const folder = activeWorkspace().panes.find((pane) => pane.id === first.id)!;
      const context = {
        scope: 'plane',
        workspaceID: activeWorkspace().id,
        paneID: folder.id,
        pane: folder,
        folder,
        selection: [],
        clipboard: null,
        jobs: [],
      } as unknown as CommandContext;
      await windowCommands(actions)
        .find((command) => command.id === 'plane-sidebar')!
        .run(context);
    };
    await toggle();
    expect(
      activeWorkspace()
        .panes.filter((pane) => pane.type === 'folder')
        .every((pane) => pane.sidebar?.visible === false),
    ).toBe(true);
    expect(getState().saved.ui.sidebar.inNewPlanes).toBe(false);
    expect(activeWorkspace().panes.find((pane) => pane.id === second.id)).toMatchObject({
      sidebar: { visible: false, width: 280 },
    });
    const future = addPane('/fixtures/future', 'folder', true);
    expect(future.type === 'folder' && future.sidebar?.visible).toBe(false);
    await flushState(false);
    const saved = stateSchema.parse(getState().saved);
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: saved,
      locations: [],
      openPaths: [],
    });
    const reopened = addPane('/fixtures/reopened', 'folder', true);
    expect(reopened.type === 'folder' && reopened.sidebar?.visible).toBe(false);
    await toggle();
    expect(
      activeWorkspace()
        .panes.filter((pane) => pane.type === 'folder')
        .every((pane) => pane.sidebar?.visible === true),
    ).toBe(true);
    expect(getState().saved.ui.sidebar.inNewPlanes).toBe(true);
  });
  it('migrates navigation once across all workspaces, retaining layout and spatial choices', async () => {
    await newWorkspace('Second');
    const original = structuredClone(getState().saved);
    const version2 = {
      ...original,
      ui: {
        ...original.ui,
        version: 2,
        sidebar: { ...original.ui.sidebar, visible: true, inNewPlanes: false, width: 280 },
        space: {
          ...original.ui.space,
          backs: false,
          toolbar: false,
          minimap: false,
          viewcube: false,
        },
      },
      workspaces: original.workspaces.map((space) => ({
        ...space,
        panes: space.panes.map((pane) => ({ ...pane, sidebar: { visible: false, width: 300 } })),
      })),
    };
    const unchanged = JSON.stringify(version2);
    const migrated = stateSchema.parse(version2);
    expect(JSON.stringify(version2)).toBe(unchanged);
    expect(migrated.ui).toMatchObject({
      version: 3,
      sidebar: { visible: false, inNewPlanes: true, width: 280 },
      space: { toolbar: false, minimap: false, viewcube: false },
    });
    expect(migrated.ui.space).not.toHaveProperty('backs');
    for (const [index, space] of migrated.workspaces.entries()) {
      expect(space.roots).toEqual(original.workspaces[index].roots);
      expect(space.arrangement).toEqual(original.workspaces[index].arrangement);
      expect(space.panes[0]).toMatchObject({ sidebar: { visible: true, width: 300 } });
    }
    initialize({ ...getState().bootstrap, state: migrated });
    const pane = activeWorkspace().panes[0];
    updatePane(pane.id, { sidebar: { visible: false, width: 260 } });
    changePreferences((ui) => ({
      ...ui,
      sidebar: { ...ui.sidebar, visible: true, inNewPlanes: false },
    }));
    await flushState(false);
    const reloaded = stateSchema.parse(getState().saved);
    expect(reloaded.ui.sidebar).toMatchObject({ visible: true, inNewPlanes: false });
    expect(reloaded.workspaces[1].panes[0]).toMatchObject({
      sidebar: { visible: false, width: 260 },
    });
    expect(operate).not.toHaveBeenCalled();
  });
  it('persists intentional preview copies independently of reused preview records', async () => {
    addPane('/fixtures/image.png', 'preview', false);
    addPane('/fixtures/image.png', 'preview', false, { keepSeparate: true });
    await flushState(false);
    const parsed = stateSchema.parse(getState().saved);
    expect(parsed.workspaces[0].panes[1]).toMatchObject({ keepSeparate: undefined });
    expect(parsed.workspaces[0].panes[2]).toMatchObject({ keepSeparate: true });
    const corrupt = structuredClone(parsed);
    Object.assign(corrupt.workspaces[0].panes[2], { keepSeparate: 'bad' });
    expect(stateSchema.parse(corrupt).workspaces[0].panes[2]).toMatchObject({
      keepSeparate: undefined,
    });
    expect(operate).not.toHaveBeenCalled();
  });
  it('persists hiding, width, collapses and section order with existing favorites intact', async () => {
    addFavorite('/fixtures/one', 'One');
    changePreferences((ui) => ({
      ...ui,
      sidebar: {
        ...ui.sidebar,
        visible: false,
        width: 280,
        order: reorder(ui.sidebar.order, 'recents', 'locations'),
        collapsed: ['favorites'],
      },
    }));
    await flushState(false);
    const saved = getState().saved;
    initialize({ ...getState().bootstrap, state: saved });
    expect(getState().saved.ui.sidebar).toMatchObject({
      visible: false,
      width: 280,
      order: ['recents', 'locations', 'favorites'],
      collapsed: ['favorites'],
    });
    expect(getState().saved.favorites).toEqual([{ path: '/fixtures/one', name: 'One' }]);
  });
});
describe('conditional operations', () => {
  it('merges sequenced progress, requests resync for gaps, and rejects stale snapshots', () => {
    const job: OperationJob = {
      id: 'sequenced',
      revision: 2,
      kind: 'copy',
      status: 'running',
      sources: ['/fixtures/a'],
      bytesDone: 0,
      bytesTotal: 100,
      itemsDone: 0,
      itemsTotal: 1,
      completed: [],
      errors: [],
      errorCount: 0,
      undoable: false,
    };
    receiveJob(job);
    const progress: OperationProgress = {
      id: job.id,
      revision: 3,
      bytesDone: 50,
      bytesTotal: 100,
      itemsDone: 0,
      itemsTotal: 1,
      errorCount: 0,
      current: '/fixtures/a',
    };
    expect(receiveProgress(progress)).toBe(true);
    expect(getState().jobs[0].bytesDone).toBe(50);
    expect(getState().jobs[0].completed).toBe(job.completed);
    expect(receiveProgress({ ...progress, revision: 5 })).toBe(false);
    expect(receiveProgress({ ...progress, id: 'unknown' })).toBe(false);
    setJobs([job]);
    expect(getState().jobs[0].revision).toBe(3);
    receiveJob({
      ...job,
      revision: 6,
      status: 'completed',
      bytesDone: 100,
      completed: [{ source: '/fixtures/a', destination: '/fixtures/b' }],
    });
    expect(receiveProgress(progress)).toBe(true);
    setJobs([{ ...job, revision: 4 }]);
    expect(getState().jobs[0]).toMatchObject({ revision: 6, status: 'completed', bytesDone: 100 });
    expect(getState().jobs[0].completed).toHaveLength(1);
  });
  it('shows only pending work or unacknowledged failures and keeps history reachable', () => {
    expect(needsOperations()).toBe(false);
    const job = {
      id: 'job',
      status: 'running',
      sources: [],
      completed: [],
    } as unknown as OperationJob;
    receiveJob(job);
    expect(needsOperations()).toBe(true);
    setOperationsOpen(true);
    receiveJob({ ...job, status: 'completed' });
    expect(needsOperations()).toBe(false);
    expect(getState().operationsOpen).toBe(false);
    receiveJob({ ...job, status: 'failed' });
    expect(needsOperations()).toBe(true);
    setOperationsOpen(true);
    expect(needsOperations()).toBe(false);
    expect(getState().operationsOpen).toBe(true);
    setOperationsOpen(false);
    setOperationsOpen(true, true);
    expect(getState().jobs).toHaveLength(1);
    expect(getState().operationsOpen).toBe(true);
  });
});
