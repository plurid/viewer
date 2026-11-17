import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { resetDefinition } from '../src/renderer/state/definitions';
import { registerEditingPlane } from '../src/renderer/editing/planes';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { savePatch } from '../src/renderer/state/core';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition } from './workspace-definition-fixtures';

afterEach(async () => {
  await flushState(false);
  vi.unstubAllGlobals();
});
it('leaves every plane and its unsaved text intact when a later reset prompt is cancelled', async () => {
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      save: vi.fn(async () => {}),
      workspaceDefinitions: vi.fn(),
      textPrompt: vi.fn().mockResolvedValueOnce('discard').mockResolvedValueOnce('cancel'),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, openPaths: [], locations: [] });
  const definition = sampleDefinition();
  const workspace = {
    ...activeWorkspace(),
    definition: { key: definition.key, basis: definition.basis },
    panes: [
      { id: 'first', type: 'preview' as const, path: '/projects/sample/first.txt' },
      { id: 'second', type: 'preview' as const, path: '/projects/sample/second.txt' },
    ],
    roots: ['first', 'second'],
    activePane: 'first',
  };
  savePatch({ workspaces: [workspace] });
  const discard = vi.fn(async () => {});
  const releases = workspace.panes.map((pane) =>
    registerEditingPlane(pane.id, { dirty: () => true, save: async () => true, discard }),
  );
  const controller = {
    parentPaneID: () => undefined,
    subtree: (id: string) => [id],
    closePane: vi.fn(),
  } as unknown as WorkspaceController;
  try {
    expect(await resetDefinition(controller)).toBe(false);
    expect(window.viewer.textPrompt).toHaveBeenCalledTimes(2);
    expect(discard).not.toHaveBeenCalled();
    expect(controller.closePane).not.toHaveBeenCalled();
    expect(window.viewer.workspaceDefinitions).not.toHaveBeenCalled();
    expect(getState().saved.workspaces[0]).toEqual(workspace);
  } finally {
    for (const release of releases) release();
  }
});
