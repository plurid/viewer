import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedState } from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/storage';
import {
  activeWorkspace,
  addPane,
  addRootFolder,
  flushState,
  getState,
  initialize,
  newWorkspace,
  navigate,
  receiveSettings,
  reconcilePanes,
  removePanes,
  setActivePane,
  storageAdapter,
  switchWorkspace,
  updatePane,
} from '../src/renderer/state/store';

const save = vi.fn(async (state: SavedState) => {
  stateSchema.parse(state);
});
beforeEach(() => {
  vi.useFakeTimers();
  save.mockClear();
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), viewer: { save } });
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('workspace host and engine lifecycle', () => {
  it('uses the configured starting folder for roots, including an empty workspace, and honors explicit location commands', () => {
    const owner = activeWorkspace().panes[0];
    navigate(owner.id, '/fixtures/project');
    for (const location of ['home', 'desktop', 'downloads'] as const) {
      const snapshot = structuredClone(getState().settings);
      snapshot.revision++;
      snapshot.settings.browsing.newPlaneLocation = location;
      receiveSettings(snapshot);
      const expected =
        location === 'home'
          ? '/fixtures'
          : `/fixtures/${location[0].toUpperCase()}${location.slice(1)}`;
      expect(addRootFolder()?.path).toBe(expected);
    }
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.browsing.newPlaneLocation = 'custom';
    snapshot.settings.browsing.newPlanePath = '/fixtures/library';
    receiveSettings(snapshot);
    removePanes(activeWorkspace().panes.map((pane) => pane.id));
    expect(addRootFolder()?.path).toBe('/fixtures/library');
    expect(addRootFolder({ path: '/fixtures/explicit' })?.path).toBe('/fixtures/explicit');
  });
  it('adds fresh roots at a folder with copied view preferences and independent history', async () => {
    const first = activeWorkspace().panes[0];
    navigate(first.id, '/fixtures/project');
    updatePane(first.id, { mode: 'gallery', sort: 'modified', descending: true, showHidden: true });
    const owner = structuredClone(activeWorkspace().panes[0]);
    const second = addRootFolder()!;
    const third = addRootFolder()!;
    expect(new Set(activeWorkspace().roots).size).toBe(3);
    expect(activeWorkspace().panes[0]).toEqual(owner);
    expect(second).toMatchObject({
      path: '/fixtures/project',
      mode: 'gallery',
      sort: 'modified',
      descending: true,
      showHidden: true,
      history: ['/fixtures/project'],
      historyIndex: 0,
      sidebar: { visible: true, width: 210 },
    });
    navigate(second.id, '/fixtures/elsewhere');
    expect(activeWorkspace().panes.find((pane) => pane.id === third.id)?.path).toBe(
      '/fixtures/project',
    );
    await flushState(false);
    const saved = stateSchema.parse(getState().saved);
    initialize({ ...getState().bootstrap, state: saved });
    expect(activeWorkspace().roots).toEqual([first.id, second.id, third.id]);
    expect(activeWorkspace().panes).toHaveLength(3);
  });
  it('starts at a preview parent or Home, and refuses stale workspace or plane ownership', async () => {
    const preview = addPane('/fixtures/images/photo.png', 'preview', false);
    setActivePane(preview.id);
    expect(addRootFolder()?.path).toBe('/fixtures/images');
    const count = activeWorkspace().panes.length;
    expect(addRootFolder({ workspaceID: 'old', path: '/fixtures/other' })).toBeUndefined();
    expect(addRootFolder({ paneID: 'closed', path: '/fixtures/other' })).toBeUndefined();
    expect(activeWorkspace().panes).toHaveLength(count);
    removePanes(activeWorkspace().panes.map((pane) => pane.id));
    expect(addRootFolder()?.path).toBe('/fixtures');
    const source = activeWorkspace().panes[0];
    expect(addRootFolder({ paneID: source.id, path: '/fixtures/shortcut' })?.path).toBe(
      '/fixtures/shortcut',
    );
  });
  it('enforces the plane limit without creating an orphan root', () => {
    for (let count = 1; count < 200; count++) addRootFolder();
    const roots = [...activeWorkspace().roots];
    expect(() => addRootFolder()).toThrow('200 planes');
    expect(activeWorkspace().panes).toHaveLength(200);
    expect(activeWorkspace().roots).toEqual(roots);
  });
  it('removes closed branches and restores host records on arrangement undo and redo', () => {
    const root = activeWorkspace().panes[0];
    const child = addPane('/fixtures/model.glb', 'preview', false);
    setActivePane(child.id);
    removePanes([root.id, child.id]);
    expect(activeWorkspace().panes).toEqual([]);
    expect(getState().activePane).toBe('');
    reconcilePanes([root.id, child.id]);
    expect(activeWorkspace().panes.map((pane) => pane.id)).toEqual([root.id, child.id]);
    expect(activeWorkspace().roots).toEqual([root.id]);
    expect(getState().activePane).toBe(root.id);
    reconcilePanes([]);
    expect(activeWorkspace().panes).toEqual([]);
    expect(stateSchema.safeParse(getState().saved).success).toBe(true);
  });
  it('flushes engine storage before switching and restores each workspace’s active pane', async () => {
    const first = activeWorkspace().id;
    const child = addPane('/fixtures/model.glb', 'preview', false);
    setActivePane(child.id);
    storageAdapter(first).setItem('engine', 'arrangement-one');
    await newWorkspace('Second');
    const second = activeWorkspace().id;
    expect(save.mock.calls.at(-1)?.[0].workspaces[0].arrangement.engine).toBe('arrangement-one');
    storageAdapter(second).setItem('engine', 'arrangement-two');
    await switchWorkspace(first);
    expect(save.mock.calls.at(-1)![0].activeWorkspace).toBe(first);
    expect(getState().activePane).toBe(child.id);
    expect(storageAdapter(second).getItem('engine')).toBe('arrangement-two');
    await flushState(false);
    const saved = save.mock.calls.at(-1)![0];
    expect(saved.workspaces.find((space) => space.id === second)?.arrangement.engine).toBe(
      'arrangement-two',
    );
    initialize({ ...getState().bootstrap, state: saved });
    expect(getState().activePane).toBe(child.id);
    expect(storageAdapter(first).getItem('engine')).toBe('arrangement-one');
  });
});
