// @vitest-environment jsdom
/**
 * Tiling commands: a split adds a plane beside the active one and tiles them, the way
 * asked first and in the kept layout after; layouts, swaps, the main plane and untiling change the
 * workspace's saved tiling, which the space then follows.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import { activeWorkspace, getState, initialize, setActivePane } from '../src/renderer/state/store';

const retile = vi.fn();
const controller: Record<string, unknown> = {
  parentPaneID: () => undefined,
  isDocked: () => false,
  arrangementHistory: () => ({ canUndo: false, canRedo: false }),
  hasRepeatedPreviews: () => false,
  bookmarks: () => [],
  retile,
};
const actions = {
  workspace: new Proxy(controller, { get: (target, key: string) => target[key] ?? vi.fn() }),
  ready: true,
  tool: null,
} as unknown as WindowActions;
const context = { scope: 'window', workspaceID: '', selection: [] } as unknown as CommandContext;
const run = async (id: string) => {
  const command = windowCommands(actions).find((item) => item.id === id);
  if (!command) throw new Error('No command ' + id);
  expect(command.when(context), id).toBe(true);
  await act(async () => command.run(context));
};
beforeEach(() => {
  retile.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  act(() => setActivePane(activeWorkspace().panes[0]!.id));
});

it('splits the active plane right, then keeps the layout for later splits', async () => {
  const first = activeWorkspace().panes[0]!;
  await run('tile-split-right');
  const tiling = activeWorkspace().tiling!;
  expect(tiling.layout).toBe('even-horizontal');
  expect(tiling.panes).toHaveLength(2);
  expect(tiling.panes[0]).toBe(first.id);
  // a copy of the folder, a root of its own
  const added = activeWorkspace().panes.find((pane) => pane.id === tiling.panes[1])!;
  expect(added).toMatchObject({ type: 'folder', path: first.path });
  expect(activeWorkspace().roots).toContain(added.id);
  expect(retile).toHaveBeenCalled();
  await run('tile-split-down');
  expect(activeWorkspace().tiling).toMatchObject({ layout: 'even-horizontal' });
  expect(activeWorkspace().tiling!.panes).toHaveLength(3);
});
it('splits down into a stack, and adds what Settings names', async () => {
  const snapshot = structuredClone(getState().settings);
  snapshot.settings.tiling = { ...snapshot.settings.tiling, splitWith: 'scratch' };
  snapshot.revision++;
  const { receiveSettings } = await import('../src/renderer/state/store');
  act(() => receiveSettings(snapshot));
  await run('tile-split-down');
  expect(activeWorkspace().tiling!.layout).toBe('even-vertical');
  const added = activeWorkspace().panes.find(
    (pane) => pane.id === activeWorkspace().tiling!.panes[1],
  );
  expect(added?.type).toBe('scratch');
});
it('steps layouts, swaps, promotes, sizes the main tile and untiles', async () => {
  await run('tile-split-right');
  await run('tile-split-right');
  const [a, b, c] = activeWorkspace().tiling!.panes;
  await run('tile-next-layout');
  expect(activeWorkspace().tiling!.layout).toBe('even-vertical');
  await run('tile-layout-main-vertical');
  expect(activeWorkspace().tiling!.layout).toBe('main-vertical');
  act(() => setActivePane(b!));
  await run('tile-swap-next');
  expect(activeWorkspace().tiling!.panes).toEqual([a, c, b]);
  await run('tile-promote');
  expect(activeWorkspace().tiling!.panes).toEqual([b, a, c]);
  await run('tile-main-grow');
  expect(activeWorkspace().tiling!.main).toBeCloseTo(0.6 + 1 / 12);
  await run('untile');
  expect(activeWorkspace().tiling).toBeUndefined();
  expect(
    windowCommands(actions)
      .find((item) => item.id === 'tile-next-layout')!
      .when(context),
  ).toBe(false);
});
