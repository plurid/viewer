import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedState } from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/storage';
import {
  activeWorkspace,
  addPane,
  flushState,
  getState,
  initialize,
  newWorkspace,
  reconcilePanes,
  removePanes,
  setActivePane,
  storageAdapter,
  switchWorkspace,
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
