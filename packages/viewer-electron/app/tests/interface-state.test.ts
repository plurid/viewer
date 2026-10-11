import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { OperationJob } from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/storage';
import { normalizePreferences, reorder } from '../src/domain/preferences';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { windowCommands, type WindowActions } from '../src/renderer/commands/window';
import {
  activeWorkspace,
  addFavorite,
  addPane,
  changePreferences,
  deleteWorkspace,
  flushState,
  getState,
  initialize,
  needsOperations,
  newWorkspace,
  receiveJob,
  renameShortcut,
  restoreWorkspace,
  setOperationsOpen,
  storageAdapter,
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
      engine: { current: null },
      workspace: {},
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
  it('loads legacy state and falls back independently for invalid new preferences', () => {
    const { ui: _ui, ...legacy } = getState().saved;
    const parsed = stateSchema.parse(legacy);
    expect(parsed.ui.space.backs).toBe(true);
    const corrupt = stateSchema.parse({
      ...legacy,
      ui: {
        sidebar: { visible: false, width: 'wide', order: ['recents', 'recents', 'bad'] },
        space: { backs: false, minimap: true },
        recentCommands: ['rename', 'rename', 9],
      },
    });
    expect(corrupt.workspaces).toEqual(legacy.workspaces);
    expect(corrupt.ui.sidebar.visible).toBe(false);
    expect(corrupt.ui.sidebar.width).toBe(210);
    expect(corrupt.ui.sidebar.order).toEqual(['recents', 'locations', 'favorites']);
    expect(corrupt.ui.space).toEqual({
      backs: false,
      minimap: true,
      viewcube: false,
      origin: false,
    });
    expect(corrupt.ui.recentCommands).toEqual(['rename']);
    expect(normalizePreferences('broken')).toEqual(normalizePreferences());
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
  it('shows only pending work or unacknowledged failures and keeps history reachable', () => {
    expect(needsOperations()).toBe(false);
    const job = { id: 'job', status: 'running' } as OperationJob;
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
