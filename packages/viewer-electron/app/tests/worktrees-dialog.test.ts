// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { ViewerAPI } from '../src/domain/contracts';
import type { WorktreeCatalog } from '../src/domain/comparison/worktrees';
import { WorktreesDialog } from '../src/renderer/git/worktrees/WorktreesDialog';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { gitCommands } from '../src/renderer/git/commands';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};

let catalog: WorktreeCatalog;
let target: CapturedTarget;
const api = vi.fn<ViewerAPI['gitWorktrees']>();
const open = vi.fn(async () => {});
const close = vi.fn();
beforeEach(() => {
  api.mockReset();
  open.mockReset();
  close.mockReset();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), gitWorktrees: api } });
  initialize({
    home: '/fixture/main',
    platform: 'darwin',
    state: null,
    locations: [],
    openPaths: [],
  });
  const space = activeWorkspace();
  const pane = space.panes[0]!;
  target = {
    workspaceID: space.id,
    rootID: pane.id,
    paneID: pane.id,
    panePath: pane.path,
    directory: pane.path,
    selection: [],
  };
  catalog = {
    id: crypto.randomUUID(),
    repository: '/fixture/main',
    currentPath: '/fixture/main',
    worktrees: [
      {
        id: crypto.randomUUID(),
        path: '/fixture/main',
        branch: 'main',
        commit: 'a'.repeat(40),
        bare: false,
        detached: false,
        available: true,
      },
      {
        id: crypto.randomUUID(),
        path: '/fixture/feature',
        branch: 'feature',
        commit: 'a'.repeat(40),
        bare: false,
        detached: false,
        available: true,
      },
      {
        id: crypto.randomUUID(),
        path: '/fixture/missing',
        branch: 'missing',
        bare: false,
        detached: false,
        available: false,
        problem: 'This checkout is missing.',
      },
    ],
  };
  api.mockImplementation(async (request) =>
    request.kind === 'list'
      ? { kind: 'catalog', catalog }
      : request.kind === 'inspect'
        ? {
            kind: 'status',
            snapshot: { root: '/fixture/feature', branch: 'feature', changes: [], updated: 1 },
          }
        : { kind: 'released' },
  );
});
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    createElement(WorktreesDialog, {
      target,
      workspace: { openWorktree: open } as unknown as WorkspaceController,
      onClose: close,
    }),
  );

describe('existing worktree picker', () => {
  it('shows current/shared views, searches branches and dispatches an exact captured selection', async () => {
    mount();
    await act(async () => {});
    expect(screen.getByRole('option', { name: /main.*Current checkout/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show existing plane' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Another view beside' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find worktree' }), {
      target: { value: 'feature' },
    });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Clean'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open beside' })));
    expect(open).toHaveBeenCalledWith(
      target,
      { catalogID: catalog.id, worktreeID: catalog.worktrees[1]!.id },
      false,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps unavailable checkout selection inspectable while refusing to open it', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole('option', { name: /missing.*Unavailable/ }));
    expect(screen.getByText('This checkout is missing.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Open beside' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find worktree' }), {
      target: { value: 'no match' },
    });
    expect(screen.getByText('No worktrees match.')).toBeTruthy();
  });

  it('releases discovery leases when closed and retains useful errors without opening a plane', async () => {
    open.mockRejectedValueOnce(new Error('The checkout registration changed. Refresh the list.'));
    const view = mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole('option', { name: /feature.*Checkout/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open beside' })));
    expect(screen.getByRole('alert').textContent).toContain('registration changed');
    expect(close).not.toHaveBeenCalled();
    view.unmount();
    expect(api).toHaveBeenCalledWith({ kind: 'release', catalogID: catalog.id });
  });

  it('uses the Git command group independently of automatic badge preferences', () => {
    const request = vi.fn();
    const actions = {
      workspace: { rootID: () => target.rootID },
      ready: true,
    } as unknown as WindowActions;
    const commands = gitCommands(windowScopes(actions), {
      start: () => {},
      commit: () => {},
      worktrees: request,
    });
    const command = commands.find((command) => command.id === 'git-worktrees')!;
    const context = {
      scope: 'folder',
      workspaceID: target.workspaceID,
      rootID: target.rootID,
      paneID: target.paneID,
      path: target.panePath,
      directory: target.directory,
      selection: [],
      jobs: [],
      clipboard: null,
    } as const;
    expect(getState().settings.settings.git.enabled).toBe(false);
    expect(command.when(context)).toBe(true);
    command.run(context);
    expect(request).toHaveBeenCalledWith(expect.objectContaining(target));
    expect(command.group).toBe('Git');
  });
});
