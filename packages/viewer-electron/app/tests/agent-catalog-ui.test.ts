// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { FileEntry } from '../src/domain/contracts';
import type { ViewerAPI } from '../src/domain/contracts';
import { commandAtAgentOrigin, resolveAgentOrigin } from '../src/renderer/app/agent-origin';
import { useAgentCatalog } from '../src/renderer/app/useAgentCatalog';
import { agentCatalog } from '../src/renderer/commands/agent-catalog';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { folderCommands, type FolderActions } from '../src/renderer/commands/folder';
import { windowCommands, type WindowActions } from '../src/renderer/commands/window';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { replaceState } from '../src/renderer/state/core';
import { effectiveWindowUI } from '../src/renderer/state/effective-ui';
import type { WorkspaceController } from '../src/renderer/workspace/context';

const publish = vi.fn<ViewerAPI['commandsPublish']>(async () => {});
const workspaceDialog = vi.fn();
const folderInfo = vi.fn();
let registry: CommandRegistry;
let selection: FileEntry[];
const file: FileEntry = {
  path: '/fixtures/notes.txt',
  parent: '/fixtures',
  name: 'notes.txt',
  extension: 'txt',
  kind: 'file',
  directory: false,
  size: 3,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'text/plain',
  identity: 'generated',
};
const controller: Record<string, unknown> = {
  rootID: (id: string) => id || undefined,
  parentPaneID: () => undefined,
  isDocked: () => false,
  arrangementHistory: () => ({ canUndo: false, canRedo: false }),
  hasRepeatedPreviews: () => false,
  bookmarks: () => [],
};
const workspace = new Proxy(controller, {
  get: (target, key: string) => target[key] ?? vi.fn(),
}) as unknown as WorkspaceController;
const actions = {
  workspace,
  ready: true,
  tool: null,
  workspaceDialog,
  profileDialog: vi.fn(),
} as unknown as WindowActions;
const folderActions = new Proxy(
  { info: folderInfo },
  { get: (target, key: string) => (key === 'info' ? target.info : vi.fn()) },
) as unknown as FolderActions;

function context(): CommandContext {
  const state = getState();
  const pane = activeWorkspace().panes.find((pane) => pane.id === state.activePane);
  return {
    scope: 'window',
    workspaceID: state.saved.activeWorkspace,
    paneID: pane?.id,
    rootID: pane?.id,
    path: pane?.path,
    directory: pane?.type === 'folder' ? pane.path : undefined,
    folder: pane?.type === 'folder' ? pane : undefined,
    selection,
    jobs: [],
    clipboard: null,
  };
}

function emptyWorkspace() {
  const state = getState();
  replaceState({
    ...state,
    activePane: '',
    saved: {
      ...state.saved,
      workspaces: state.saved.workspaces.map((space) => ({ ...space, panes: [], roots: [] })),
    },
  });
}

function mountPublication() {
  return renderHook(() =>
    useAgentCatalog({
      registry,
      controller: workspace,
      activePane: getState().activePane,
      context,
    }),
  );
}

async function publishPending() {
  await act(async () => vi.advanceTimersByTimeAsync(80));
  return publish.mock.lastCall!;
}

beforeEach(() => {
  vi.useFakeTimers();
  publish.mockClear();
  workspaceDialog.mockClear();
  folderInfo.mockClear();
  selection = [];
  Object.assign(window, {
    viewer: { save: vi.fn(async () => {}), commandsPublish: publish },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  registry = new CommandRegistry();
  registry.register('window', {
    context,
    definitions: () => windowCommands(actions),
    valid: (invocation) =>
      invocation.workspaceID === getState().saved.activeWorkspace &&
      (!invocation.paneID || activeWorkspace().panes.some((pane) => pane.id === invocation.paneID)),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('agent catalog publication and invocation', () => {
  it('publishes real settings, profile and workspace definitions in an empty workspace', async () => {
    emptyWorkspace();
    mountPublication();
    const [target, commands, workspaces] = await publishPending();
    expect(target).toEqual({
      workspaceID: activeWorkspace().id,
      paneID: 'none',
      rootID: 'none',
      panePath: undefined,
      directory: '/fixtures',
      selection: [],
    });
    expect(commands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        'settings',
        'setting.ui.space.grid',
        'profile.focus',
        'profile.present',
        'new-workspace',
        'rename-workspace',
        'workspace-background',
      ]),
    );
    expect(workspaces!.workspaces[0]!.panes).toEqual([]);
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
  });

  it('keeps real folder actions and window scopes together for a file selection', async () => {
    selection = [file];
    registry.register(`folder:${getState().activePane}`, {
      context: () => ({ ...context(), scope: 'folder' }),
      definitions: () => folderCommands(folderActions),
    });
    mountPublication();
    const [target, commands] = await publishPending();
    expect(target.selection).toEqual([file]);
    expect(commands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        'info',
        'setting.ui.space.grid',
        'profile.focus',
        'rename-workspace',
      ]),
    );
    const catalog = agentCatalog(registry, context());
    const info = catalog.find((command) => command.id === 'info')!;
    expect(info.context.scope).toBe('files');
    expect(catalog.find((command) => command.id === 'profile.focus')!.context.scope).toBe('window');
    await registry.run(info, false);
    expect(folderInfo).toHaveBeenCalledWith(expect.objectContaining({ selection: [file] }));
  });

  it('runs reviewed window invocations from an empty origin without a placeholder file context', async () => {
    emptyWorkspace();
    mountPublication();
    const [target] = await publishPending();
    const origin = resolveAgentOrigin(target, activeWorkspace(), workspace)!;
    expect(origin).toEqual({ empty: true });
    const grid = effectiveWindowUI(getState()).space.grid;
    for (const id of ['setting.ui.space.grid', 'profile.focus', 'rename-workspace']) {
      const command = commandAtAgentOrigin(registry, id, target, origin, context())!;
      expect(command.context).toMatchObject({
        scope: 'window',
        paneID: undefined,
        directory: undefined,
        selection: [],
      });
      await act(async () => expect(await registry.run(command, false)).toBe(true));
      if (id === 'setting.ui.space.grid')
        expect(effectiveWindowUI(getState()).space.grid).toBe(!grid);
    }
    expect(getState().saved.profile?.id).toBe('focus');
    expect(workspaceDialog).toHaveBeenCalledWith('rename');
  });

  it('refuses changed and malformed origins before resolving any command', async () => {
    emptyWorkspace();
    const target: CapturedTarget = {
      workspaceID: activeWorkspace().id,
      paneID: 'none',
      rootID: 'none',
      directory: '/fixtures',
      selection: [],
    };
    for (const patch of [
      { workspaceID: 'stale' },
      { paneID: 'missing' },
      { rootID: 'missing' },
      { panePath: '/fixtures' },
      { selection: [file] },
    ]) {
      expect(
        resolveAgentOrigin({ ...target, ...patch }, activeWorkspace(), workspace),
      ).toBeUndefined();
    }
    const changed = {
      ...activeWorkspace(),
      panes: [{ id: 'new', type: 'scratch' as const, path: '/fixtures', bufferID: 'generated' }],
    };
    expect(resolveAgentOrigin(target, changed, workspace)).toBeUndefined();
  });

  it('coalesces registry changes and cancels publication when its owner unmounts', async () => {
    const view = mountPublication();
    await act(async () => {
      for (let count = 0; count < 50; count += 1) registry.touch();
      await vi.advanceTimersByTimeAsync(79);
    });
    expect(publish).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(publish).toHaveBeenCalledTimes(2);
    registry.touch();
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(80));
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
