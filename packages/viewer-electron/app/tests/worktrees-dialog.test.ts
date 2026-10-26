// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { ViewerAPI, FileEntry } from '../src/domain/contracts';
import type { WorktreeCatalog } from '../src/domain/comparison/worktrees';
import { WorktreesDialog } from '../src/renderer/git/worktrees/WorktreesDialog';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { gitCommands } from '../src/renderer/git/commands';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import { addContentPane } from '../src/renderer/state/panes';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};

let catalog: WorktreeCatalog;
let target: CapturedTarget;
const api = vi.fn<ViewerAPI['gitWorktrees']>();
const open = vi.fn(async () => 'opened-folder');
const changes = vi.fn();
const close = vi.fn();
beforeEach(() => {
  api.mockReset();
  open.mockReset();
  open.mockResolvedValue('opened-folder');
  changes.mockReset();
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
      workspace: { openWorktree: open, openGitChanges: changes } as unknown as WorkspaceController,
      onClose: close,
    }),
  );

describe('existing worktree picker', () => {
  it('creates one branch task and retries its tool setup without creating another checkout or task', async () => {
    const baseID = crypto.randomUUID();
    catalog.branches = [{ id: baseID, name: 'main', branch: 'main', commit: 'a'.repeat(40) }];
    catalog.defaultBaseID = baseID;
    const next = { ...catalog, id: crypto.randomUUID() };
    const treeID = crypto.randomUUID();
    const old = api.getMockImplementation()!;
    api.mockImplementation(async (request) =>
      request.kind === 'create'
        ? {
            kind: 'created',
            catalog: next,
            worktreeID: treeID,
            entry: { path: '/fixture/task-checkout' } as FileEntry,
          }
        : old(request),
    );
    const source = activeWorkspace().panes[0]!;
    if (source.type !== 'folder') throw new Error('Fixture folder unavailable.');
    open.mockImplementationOnce(async () => {
      addContentPane({ ...source, id: 'created-checkout', path: '/fixture/task-checkout' });
      return 'created-checkout';
    });
    const newTask = vi.fn(async () => 'area');
    const setup = vi.fn(async () => {});
    setup.mockRejectedValueOnce(new Error('Generated tool setup failure'));
    render(
      createElement(WorktreesDialog, {
        target,
        taskMode: true,
        onClose: close,
        workspace: {
          openWorktree: open,
          newTaskArea: newTask,
          setupTaskArea: setup,
          rootID: () => 'created-checkout',
        } as unknown as WorkspaceController,
      }),
    );
    fireEvent.change(await screen.findByLabelText('Branch task name'), {
      target: { value: 'Review images' },
    });
    fireEvent.change(screen.getByLabelText('New branch name'), {
      target: { value: 'feature/images' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByText('Generated tool setup failure');
    expect(newTask).toHaveBeenCalledWith(
      expect.objectContaining({ directory: '/fixture/task-checkout', paneID: 'created-checkout' }),
      'Review images',
    );
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish task setup' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(api.mock.calls.filter(([request]) => request.kind === 'create')).toHaveLength(1);
    expect(newTask).toHaveBeenCalledOnce();
    expect(setup).toHaveBeenCalledTimes(2);
  });
  it('captures a pinned new branch and editable sibling destination, then links its Git view', async () => {
    const baseID = crypto.randomUUID();
    catalog.branches = [
      {
        id: baseID,
        name: 'main',
        branch: 'main',
        commit: 'a'.repeat(40),
        worktreeID: catalog.worktrees[0]!.id,
      },
    ];
    catalog.defaultBaseID = baseID;
    const next = { ...catalog, id: crypto.randomUUID() },
      treeID = crypto.randomUUID();
    const previous = api.getMockImplementation()!;
    api.mockImplementation(async (request) =>
      request.kind === 'create'
        ? {
            kind: 'created',
            catalog: next,
            worktreeID: treeID,
            entry: { path: '/fixture/main-feature-fast' } as FileEntry,
          }
        : previous(request),
    );
    mount();
    await screen.findByRole('button', { name: 'Create worktree…' });
    fireEvent.click(screen.getByRole('button', { name: 'Create worktree…' }));
    fireEvent.change(screen.getByLabelText('New branch name'), {
      target: { value: 'invalid branch' },
    });
    expect(
      screen.getByText('Remove spaces or unsupported symbols; for example, feature/my-task.'),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Create and open' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('New branch name'), {
      target: { value: 'feature/fast' },
    });
    expect((screen.getByLabelText('Worktree destination') as HTMLInputElement).value).toBe(
      '/fixture/main-feature-fast',
    );
    fireEvent.change(screen.getByLabelText('Worktree destination'), {
      target: { value: '/fixture/custom-destination' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create and open' })));
    expect(api).toHaveBeenCalledWith({
      kind: 'create',
      catalogID: catalog.id,
      target,
      destination: '/fixture/custom-destination',
      checkout: { kind: 'new', name: 'feature/fast', baseID },
    });
    expect(open).toHaveBeenCalledWith(target, { catalogID: next.id, worktreeID: treeID });
    expect(changes).toHaveBeenCalledWith('/fixture/main-feature-fast', 'opened-folder');
    expect(close).toHaveBeenCalledOnce();
  });
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
