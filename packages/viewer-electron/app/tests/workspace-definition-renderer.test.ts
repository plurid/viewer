import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedState } from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/persistence/storage';
import {
  closeDefinedWorkspace,
  openDefinition,
  resetDefinition,
  saveDefinition,
} from '../src/renderer/state/definitions';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { removePanes } from '../src/renderer/state/panes';
import { activeWorkspace, getState, initialize, navigate } from '../src/renderer/state/store';
import { savePatch } from '../src/renderer/state/core';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

const unsaved = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('../src/renderer/editing/unsaved', () => ({
  confirmClose: unsaved.confirm,
  prepareClose: async () => (await unsaved.confirm()) ? async () => {} : undefined,
  discardUnsaved: vi.fn(),
}));

const definition = sampleDefinition('sample/site', {
  planes: [
    { index: 0, plane: { kind: 'folder', path: '/projects/sample' } },
    { index: 1, plane: { kind: 'terminal', path: '/projects/sample', command: 'echo sample' } },
  ],
});
const request = vi.fn(async () => ({ kind: 'build' as const, definition }));
const save = vi.fn(async (state: SavedState) => {
  stateSchema.parse(state);
});
const terminalStart = vi.fn();
const claim = vi.fn(async () => true);
beforeEach(() => {
  unsaved.confirm.mockReset().mockResolvedValue(true);
  vi.useFakeTimers();
  request.mockReset().mockResolvedValue({ kind: 'build', definition });
  save.mockReset().mockImplementation(async (state) => {
    stateSchema.parse(state);
  });
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      workspaceDefinitions: request,
      save,
      workspaceClaim: claim,
      terminalStart,
      terminalClose: vi.fn(async () => {}),
    },
  });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
  });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('renderer defined workspace opening', () => {
  it('updates the basis and command-plane map after Save to definition', async () => {
    await openDefinition(definition.key);
    const space = activeWorkspace();
    const terminal = space.panes[1]!;
    request.mockResolvedValueOnce({
      kind: 'saved',
      key: definition.key,
      basis: 'c'.repeat(64),
      planes: { [terminal.id]: 0 },
      commandPlanes: [terminal.id],
      skipped: [],
      literalPaths: [],
    } as never);
    await saveDefinition(space.id);
    expect(activeWorkspace().definition!.basis).toBe('c'.repeat(64));
    expect(activeWorkspace().panes[1]).toMatchObject({ definitionPlane: 0, startOnOpen: false });
    expect(terminalStart).not.toHaveBeenCalled();
  });
  it('opens stale remembered planes and offers Reset without applying a new definition', async () => {
    const workspace = sampleWorkspace('remembered', {
      definition: { key: definition.key, basis: 'a'.repeat(64) },
      panes: [{ id: 'old', type: 'preview', path: '/projects/sample/old.pdf' }],
      roots: ['old'],
      activePane: 'old',
    });
    request.mockResolvedValueOnce({
      kind: 'build',
      definition,
      closed: {
        key: definition.key,
        at: 1,
        basis: 'a'.repeat(64),
        workspace,
        previewStates: {},
        previewHistory: [],
      },
    } as never);
    await openDefinition(definition.key);
    expect(activeWorkspace().panes).toEqual(workspace.panes);
    expect(activeWorkspace().definition!.basis).toBe('a'.repeat(64));
    expect(getState().notice).toContain('Definition changed');
    expect(getState().definitionNotice).toBe(workspace.id);
    request.mockResolvedValueOnce({
      kind: 'saved',
      key: definition.key,
      basis: definition.basis,
      planes: {},
      commandPlanes: [],
      skipped: [],
      literalPaths: [],
    } as never);
    await saveDefinition(workspace.id, true);
    expect(getState().definitionNotice).toBeUndefined();
  });
  it('closes without an Undo slot and reopens remembered planes, layout, focus and preview positions', async () => {
    await openDefinition(definition.key);
    const space = structuredClone(activeWorkspace());
    space.tiling = { layout: 'even-horizontal', main: 0.7, panes: space.roots! };
    space.activePane = space.panes[1]!.id;
    const previewID = space.id + ':' + space.panes[0]!.id;
    const history = [
      { path: '/projects/sample/readme.pdf', updated: Date.now(), values: { 'pdf.page': 4 } },
    ];
    savePatch({
      workspaces: [space],
      previewStates: { [previewID]: { page: 4 } },
      previewHistory: { [space.id]: history },
    });
    const closed = {
      key: definition.key,
      basis: definition.basis,
      at: 1,
      workspace: space,
      previewStates: { [previewID]: { page: 4 } },
      previewHistory: history,
    };
    request.mockResolvedValueOnce({ kind: 'closed' } as never);
    await closeDefinedWorkspace(space.id);
    expect(getState().saved.workspaces.some((item) => item.id === space.id)).toBe(false);
    expect(getState().deletedWorkspace).toBeNull();
    expect(activeWorkspace().panes[0]!.path).toBe('/home/sample');
    request.mockResolvedValueOnce({ kind: 'build', definition, closed } as never);
    await openDefinition(definition.key);
    expect(activeWorkspace()).toMatchObject({
      id: space.id,
      tiling: space.tiling,
      activePane: space.activePane,
    });
    expect(getState().saved.previewStates).toHaveProperty(previewID, { page: 4 });
    expect(getState().saved.previewHistory).toHaveProperty(space.id, history);
    expect(terminalStart).not.toHaveBeenCalled();
  });
  it('cancels reset before closing any plane or forgetting its snapshot', async () => {
    await openDefinition(definition.key);
    const before = structuredClone(activeWorkspace());
    request.mockClear();
    unsaved.confirm.mockResolvedValue(false);
    const controller = {
      parentPaneID: () => undefined,
      subtree: (id: string) => [id],
      closePane: vi.fn(),
    } as unknown as WorkspaceController;
    expect(await resetDefinition(controller)).toBe(false);
    expect(controller.closePane).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(activeWorkspace()).toEqual(before);
  });
  it('resets through ordinary plane closure with the same ID, a new epoch and stopped commands', async () => {
    await openDefinition(definition.key);
    const previous = structuredClone(activeWorkspace());
    request.mockResolvedValueOnce({
      kind: 'reset',
      definition: { ...definition, basis: 'b'.repeat(64) },
    } as never);
    const controller = {
      parentPaneID: () => undefined,
      subtree: (id: string) => [id],
      closePane: vi.fn((id: string) => removePanes([id])),
    } as unknown as WorkspaceController;
    expect(await resetDefinition(controller)).toBe(true);
    expect(controller.closePane).toHaveBeenCalledTimes(previous.panes.length);
    expect(activeWorkspace()).toMatchObject({
      id: previous.id,
      epoch: (previous.epoch ?? 0) + 1,
      definition: { basis: 'b'.repeat(64) },
    });
    expect(activeWorkspace().panes[1]).toMatchObject({ definitionPlane: 1, startOnOpen: false });
    expect(terminalStart).not.toHaveBeenCalled();
  });
  it('links a saved ad-hoc workspace and sends no command text or workspace snapshot', async () => {
    const space = activeWorkspace();
    request.mockResolvedValueOnce({
      kind: 'saved',
      key: 'sample/new',
      basis: 'a'.repeat(64),
      planes: {},
      commandPlanes: [],
      skipped: [],
      literalPaths: [],
    } as never);
    await saveDefinition(space.id, true, { key: 'sample/new', name: 'Sample' });
    expect(activeWorkspace().definition).toEqual({ key: 'sample/new', basis: 'a'.repeat(64), planes: {} });
    expect(request).toHaveBeenCalledWith({
      kind: 'save-as',
      workspaceID: space.id,
      order: space.panes.map((pane) => pane.id),
      key: 'sample/new',
      name: 'Sample',
    });
  });
  it.each(['desktop', 'documents', 'custom'] as const)(
    'replaces a pristine workspace at the configured %s location',
    async (location) => {
      const snapshot = structuredClone(getState().settings);
      snapshot.settings.browsing.emptyWorkspaceLocation = location;
      snapshot.settings.browsing.emptyWorkspacePath = '/projects/start';
      initialize({ ...getState().bootstrap, state: null, settings: snapshot });
      const expected =
        location === 'custom'
          ? '/projects/start'
          : `/home/sample/${location === 'desktop' ? 'Desktop' : 'Documents'}`;
      expect(activeWorkspace().panes[0]!.path).toBe(expected);
      await openDefinition(definition.key);
      expect(getState().saved.workspaces).toHaveLength(1);
      expect(activeWorkspace().definition?.key).toBe(definition.key);
    },
  );
  it('replaces a pristine current workspace and persists the stopped command terminal', async () => {
    const previous = activeWorkspace().id;
    await openDefinition(definition.key);
    expect(getState().saved.workspaces).toHaveLength(1);
    expect(activeWorkspace().id).not.toBe(previous);
    expect(activeWorkspace().definition?.key).toBe(definition.key);
    expect(activeWorkspace().panes[1]).toMatchObject({
      type: 'terminal',
      definitionPlane: 1,
      startOnOpen: false,
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(terminalStart).not.toHaveBeenCalled();
  });
  it('preserves a workspace the person has already used', async () => {
    const previous = activeWorkspace().id;
    navigate(activeWorkspace().panes[0]!.id, '/projects/existing');
    await openDefinition(definition.key);
    expect(getState().saved.workspaces).toHaveLength(2);
    expect(getState().saved.workspaces.find((space) => space.id === previous)!.panes[0]!.path).toBe(
      '/projects/existing',
    );
  });
  it('rolls back both the replacement and active plane when the build save fails', async () => {
    const previous = structuredClone(getState().saved);
    const active = getState().activePane;
    save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));
    await expect(openDefinition(definition.key)).rejects.toThrow('disk full');
    expect(getState().saved.workspaces).toEqual(previous.workspaces);
    expect(getState().saved.activeWorkspace).toBe(previous.activeWorkspace);
    expect(getState().activePane).toBe(active);
  });
  it('does not alter a live workspace when the desktop focuses another window', async () => {
    request.mockResolvedValueOnce({ kind: 'elsewhere' } as never);
    const previous = getState().saved;
    await openDefinition(definition.key);
    expect(getState().saved).toBe(previous);
    expect(save).not.toHaveBeenCalled();
  });
  it('refuses a new workspace at the cap without losing the current one', async () => {
    savePatch({
      workspaces: Array.from({ length: 1000 }, (_, index) =>
        sampleWorkspace(index ? String(index) : activeWorkspace().id),
      ),
    });
    await expect(openDefinition(definition.key)).rejects.toThrow('Close a workspace');
    expect(getState().saved.workspaces).toHaveLength(1000);
    expect(getState().saved.workspaces.some((space) => space.definition)).toBe(false);
  });
});
