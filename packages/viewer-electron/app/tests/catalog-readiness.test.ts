// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Desktop } from '../src/desktop/bridge';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import type { ApiMethod, ApiResult, ViewerAPI } from '../src/domain/contracts';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { GitActionReply, GitActionRequest } from '../src/domain/comparison/git-actions';
import { useAgentCatalog } from '../src/renderer/app/useAgentCatalog';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { captureTarget } from '../src/renderer/commands/target';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const roots: string[] = [];
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  for (const root of roots.splice(0)) await trashTemporary(root);
});

async function fixture() {
  const root = await realpath(await temporaryRoot('viewer-catalog-readiness-'));
  roots.push(root);
  const sessions = new WorkspaceSessions();
  const workspaceID = sessions.create(root);
  const owner = 7;
  const state = sessions.open(owner, root, workspaceID);
  const record = {
    originID: randomUUID(),
    role: 'viewer',
    workspaceID,
    paths: [],
    launches: [],
    window: { isDestroyed: () => false, webContents: { id: owner } },
  };
  // Exercise the real IPC handler table and ownership adapter without constructing
  // desktop services, opening a native window, or spawning a Git process.
  const desktop = Object.create(Desktop.prototype) as Desktop;
  const git = vi.fn(async (request: GitActionRequest): Promise<GitActionReply> => ({
    id: request.id,
    root: request.target.directory,
    title: 'Git status',
  }));
  const chat = vi.fn(async (_request: unknown, _owner: number, origin: unknown) => {
    if (!origin) throw new Error('Focus a folder or file plane before opening Chat.');
    return origin;
  });
  Reflect.set(desktop, 'windows', new Map([[owner, record]]));
  Reflect.set(desktop, 'workspaceSessions', sessions);
  Reflect.set(desktop, 'agentCommands', new Map());
  Reflect.set(desktop, 'gitActions', { start: git });
  Reflect.set(desktop, 'chats', { request: chat });
  const call = Reflect.get(desktop, 'call') as <K extends ApiMethod>(
    method: K,
    args: unknown,
    sender: number,
  ) => ApiResult<K>;
  const publish = vi.fn<ViewerAPI['commandsPublish']>(async (...args) => {
    call.call(desktop, 'commandsPublish', args, owner);
  });
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), commandsPublish: publish } });
  initialize({ home: root, platform: 'darwin', state, locations: [], openPaths: [] });
  const controller = {
    rootID: (id: string) => (activeWorkspace().roots.includes(id) ? id : undefined),
  };
  const context = (): CommandContext => {
    const pane = activeWorkspace().panes[0]!;
    return {
      scope: 'folder',
      workspaceID,
      paneID: pane.id,
      rootID: pane.id,
      path: pane.path,
      directory: pane.path,
      folder: pane.type === 'folder' ? pane : undefined,
      selection: [],
      jobs: [],
      clipboard: null,
    };
  };
  const registry = new CommandRegistry();
  registry.register('window', { context, definitions: () => [] });
  const target = () => captureTarget(context(), controller);
  const invokeGit = (target: CapturedTarget) =>
    call.call(desktop, 'gitAction', [{ id: randomUUID(), kind: 'status', target }], owner);
  const invokeChat = () => call.call(desktop, 'chat', [{ kind: 'create', paths: [] }], owner);
  return {
    root,
    desktop,
    owner,
    record,
    registry,
    controller,
    context,
    publish,
    git,
    chat,
    target,
    invokeGit,
    invokeChat,
  };
}

describe('cold human command origin publication', () => {
  it('admits Git and supplies Chat origin before any publication timer can run', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    renderHook(() =>
      useAgentCatalog({
        registry: f.registry,
        controller: f.controller,
        activePane: getState().activePane,
        context: f.context,
      }),
    );
    await expect(f.invokeGit(f.target())).resolves.toMatchObject({ root: f.root });
    await expect(f.invokeChat()).resolves.toMatchObject({ target: { panePath: f.root } });
    expect(f.publish).toHaveBeenCalledOnce();
    expect(f.git).toHaveBeenCalledOnce();
    await expect(f.invokeGit({ ...f.target(), rootID: 'another-root' })).rejects.toThrow(
      'originating folder',
    );
    f.record.workspaceID = 'another-workspace';
    await expect(f.invokeGit(f.target())).rejects.toThrow('originating folder');
    expect(f.git).toHaveBeenCalledOnce();
  });

  it('publishes a changed hook origin immediately while registry updates stay coalesced', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const view = renderHook(
      ({ context }) =>
        useAgentCatalog({
          registry: f.registry,
          controller: f.controller,
          activePane: getState().activePane,
          context,
        }),
      { initialProps: { context: f.context } },
    );
    for (let count = 0; count < 10; count++) {
      act(() => f.registry.touch());
      view.rerender({ context: () => f.context() });
    }
    await expect(f.invokeGit(f.target())).resolves.toMatchObject({ root: f.root });
    expect(f.publish).toHaveBeenCalledTimes(11);
    act(() => {
      for (let count = 0; count < 50; count++) f.registry.touch();
    });
    expect(f.publish).toHaveBeenCalledTimes(11);
    await act(async () => vi.advanceTimersByTimeAsync(80));
    expect(f.publish).toHaveBeenCalledTimes(12);
    act(() => f.registry.touch());
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(80));
    expect(f.publish).toHaveBeenCalledTimes(12);
  });
});
