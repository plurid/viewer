import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { closeDefinedWorkspace, resetDefinition } from '../src/renderer/state/definitions';
import { registerEditingPlane } from '../src/renderer/editing/planes';
import { recoverBuffers } from '../src/renderer/editing/unsaved';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { savePatch } from '../src/renderer/state/core';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition } from './workspace-definition-fixtures';

const request = vi.fn();
const prompt = vi.fn();
const discard = vi.fn(async () => {});
let release: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  request.mockRejectedValue(
    new Error(
      'Viewer can’t find this workspace’s definition. It may have been removed from its file.',
    ),
  );
  prompt.mockResolvedValue('discard');
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      save: vi.fn(async () => {}),
      workspaceDefinitions: request,
      textPrompt: prompt,
      bufferRead: vi.fn(async () => ({
        id: 'idea-buffer',
        kind: 'scratch',
        text: 'An unsaved idea',
        revision: 1,
        updated: 1,
      })),
      bufferDiscard: discard,
      bufferList: vi.fn(async () => ({
        buffers: [
          {
            id: 'remembered-buffer',
            kind: 'scratch',
            bytes: 12,
            title: 'Remembered idea',
            language: 'plaintext',
          },
        ],
        problems: [],
        remembered: ['remembered-buffer'],
      })),
      terminalClose: vi.fn(async () => {}),
    },
  });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
  });
  const definition = sampleDefinition();
  const space = {
    ...activeWorkspace(),
    definition: { key: definition.key, basis: definition.basis },
    panes: [
      {
        id: 'idea',
        type: 'scratch' as const,
        path: '/projects/sample',
        bufferID: 'idea-buffer',
        title: 'Sample idea',
      },
    ],
    roots: ['idea'],
    activePane: 'idea',
  };
  savePatch({ workspaces: [space] });
});
afterEach(async () => {
  release?.();
  release = undefined;
  await flushState(false);
  vi.unstubAllGlobals();
});

it('M6: a refused reset after Don’t Save keeps the text and closes nothing', async () => {
  release = registerEditingPlane('idea', { dirty: () => true, save: async () => true, discard });
  const controller = {
    parentPaneID: () => undefined,
    subtree: (id: string) => [id],
    closePane: vi.fn(),
  } as unknown as WorkspaceController;
  await expect(resetDefinition(controller)).rejects.toThrow(
    'can’t find this workspace’s definition',
  );
  expect(prompt).toHaveBeenCalledWith('close', 'Sample idea');
  expect(discard).not.toHaveBeenCalled();
  expect(controller.closePane).not.toHaveBeenCalled();
});

it('M5: Cancel on scratch text cancels Close before desktop access', async () => {
  prompt.mockResolvedValue('cancel');
  const before = structuredClone(getState().saved);
  expect(await closeDefinedWorkspace(activeWorkspace().id)).toBe(false);
  expect(prompt).toHaveBeenCalledWith('close', 'Sample idea');
  expect(request).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  expect(getState().saved.workspaces).toEqual(before.workspaces);
});

it('M5: Close defers Don’t Save until desktop acceptance', async () => {
  await expect(closeDefinedWorkspace(activeWorkspace().id)).rejects.toThrow(
    'can’t find this workspace’s definition',
  );
  expect(prompt).toHaveBeenCalledOnce();
  expect(discard).not.toHaveBeenCalled();
  request.mockImplementation(async () => {
    expect(discard).not.toHaveBeenCalled();
    return { kind: 'closed' };
  });
  expect(await closeDefinedWorkspace(activeWorkspace().id)).toBe(true);
  expect(discard).toHaveBeenCalledWith('idea-buffer');
});

it('returns a new memory problem without committing discards or closing any plane', async () => {
  const before = structuredClone(getState().saved.workspaces);
  request.mockResolvedValueOnce({ kind: 'close-info', problem: 'the memory file needs repair' });
  expect(await closeDefinedWorkspace(activeWorkspace().id)).toEqual({
    kind: 'close-info',
    problem: 'the memory file needs repair',
  });
  expect(discard).not.toHaveBeenCalled();
  expect(window.viewer.terminalClose).not.toHaveBeenCalled();
  expect(getState().saved.workspaces).toEqual(before);
});

it('M5: Save resolves unsaved editor text before asking the desktop to close', async () => {
  const saved = vi.fn(async () => true);
  release = registerEditingPlane('idea', { dirty: () => true, save: saved, discard });
  prompt.mockResolvedValue('save');
  request.mockImplementation(async () => {
    expect(saved).toHaveBeenCalledOnce();
    return { kind: 'closed' };
  });
  expect(await closeDefinedWorkspace(activeWorkspace().id)).toBe(true);
  expect(prompt).toHaveBeenCalledWith('close', 'Sample idea');
  expect(discard).not.toHaveBeenCalled();
});

it('M5: buffer recovery leaves a buffer referenced by remembered planes alone', async () => {
  expect(await recoverBuffers()).toBe(0);
  expect(activeWorkspace().panes).toHaveLength(1);
  expect(discard).not.toHaveBeenCalled();
});
