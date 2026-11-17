// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { WorkspacesDialog } from '../src/renderer/ui/workspace/WorkspacesDialog';
import { DefinitionDialog } from '../src/renderer/ui/workspace/DefinitionDialog';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { flushState } from '../src/renderer/state/persistence';
import { sampleDefinition } from './workspace-definition-fixtures';

const actions = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  close: vi.fn(async () => true),
  reset: vi.fn(async () => true),
  save: vi.fn(),
  shells: vi.fn(async () => 2),
}));
vi.mock('../src/renderer/state/definitions', () => ({
  openDefinition: actions.open,
  closeDefinedWorkspace: actions.close,
  resetDefinition: actions.reset,
  saveDefinition: actions.save,
  workspaceShells: actions.shells,
}));
beforeEach(() => {
  vi.clearAllMocks();
  actions.shells.mockResolvedValue(2);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      workspaceDefinitionFile: vi.fn(async () => getState().bootstrap.definitions),
      workspaceDefinitions: vi.fn(async (request) =>
        request.kind === 'close-info'
          ? { kind: 'close-info' }
          : {
              kind: 'proposal',
              key: 'sample/new',
              name: 'New room',
            },
      ),
    },
  });
  initialize({
    home: '/fixtures',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: null,
    definitions: {
      revision: 1,
      file: { path: '/data/workspaces.jsonc', state: 'read' },
      projectManager: {
        path: '/source/projects.json',
        state: 'read',
        projects: 60,
        missing: 1,
        disabled: 0,
        remote: 0,
        duplicateKeys: 0,
      },
      definitions: Array.from({ length: 60 }, (_, index) =>
        sampleDefinition('sample/project-' + index, {
          curated: index === 0,
          hidden: index === 1,
          rootState: index === 2 ? 'missing' : 'present',
          remembered: index === 0 ? { at: 1, basis: 'a'.repeat(64), planes: 3 } : undefined,
        }),
      ),
      diagnostics: [
        { source: 'workspaces.jsonc', level: 'warning', line: 4, message: 'Sample problem.' },
      ],
    },
  });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});
describe('workspace definition dialogs', () => {
  it('clears forced-save authority after a failed forced save and asks again after plain retry', async () => {
    actions.save
      .mockResolvedValueOnce({ kind: 'needs-confirmation', curated: true, dropsCommands: false })
      .mockRejectedValueOnce(new Error('workspaces.jsonc changed during this edit.'))
      .mockResolvedValueOnce({
        kind: 'needs-confirmation',
        curated: false,
        dropsCommands: false,
        changed: true,
      })
      .mockResolvedValueOnce({ kind: 'saved' });
    const done = vi.fn();
    const view = render(
      <DefinitionDialog
        kind="save"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={done}
      />,
    );
    await waitFor(() => expect(view.getByText(/This definition is curated/)).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Save over Definition' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('changed during this edit'),
    );
    expect(view.queryByRole('button', { name: 'Save over Definition' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Try Again' }));
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith(activeWorkspace().id, false, undefined),
    );
    await waitFor(() => expect(view.getByText(/The definition changed since/)).toBeTruthy());
    expect(view.getByText(/Planes present only in the file are kept/).textContent).toContain(
      'including planes closed here.',
    );
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Save over Definition' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });
  it('names running shells in Reset before asking to close them', async () => {
    const view = render(
      <DefinitionDialog
        kind="reset"
        workspace={{
          ...activeWorkspace(),
          definition: { key: 'sample/project-0', basis: 'a'.repeat(64) },
        }}
        controller={{} as WorkspaceController}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(view.getByText(/Its 2 running terminals stop/)).toBeTruthy());
    expect(actions.reset).not.toHaveBeenCalled();
  });
  it('never shows a zero terminal count if Close preparation fails', async () => {
    vi.mocked(window.viewer.workspaceDefinitions).mockRejectedValueOnce(
      new Error('This window has closed.'),
    );
    const view = render(
      <DefinitionDialog
        kind="close"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('This window has closed.'),
    );
    expect(view.queryByText(/0 terminals/)).toBeNull();
    expect(actions.close).not.toHaveBeenCalled();
  });
  it('shows one Edit action in an empty Defined tab', () => {
    initialize({
      ...getState().bootstrap,
      definitions: { ...getState().bootstrap.definitions!, definitions: [] },
    });
    const view = render(
      <WorkspacesDialog onClose={() => {}} onOpen={async () => {}} onAction={() => {}} />,
    );
    fireEvent.click(view.getByRole('tab', { name: 'Defined (0)' }));
    expect(view.getAllByRole('button', { name: 'Edit workspace definitions' })).toHaveLength(1);
  });
  it('explains hidden and missing Open buttons and hides Remembers for an open definition', () => {
    initialize({
      ...getState().bootstrap,
      state: {
        ...getState().saved,
        workspaces: [
          { ...activeWorkspace(), definition: { key: 'sample/project-0', basis: 'a'.repeat(64) } },
        ],
      },
    });
    const view = render(
      <WorkspacesDialog onClose={() => {}} onOpen={async () => {}} onAction={() => {}} />,
    );
    fireEvent.click(view.getByRole('tab', { name: 'Defined (60)' }));
    expect(view.queryByText('Remembers')).toBeNull();
    const hidden = view.getByText('sample/project-1').closest('li')!;
    const missing = view.getByText('sample/project-2').closest('li')!;
    expect(within(hidden).getByRole('button', { name: 'Open' }).getAttribute('title')).toContain(
      'hidden',
    );
    expect(within(missing).getByRole('button', { name: 'Open' }).getAttribute('title')).toContain(
      'missing',
    );
  });
  it('validates a Save as key before IPC with a plain sentence', async () => {
    const view = render(
      <DefinitionDialog
        kind="save-as"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect((view.getByLabelText('Key') as HTMLInputElement).value).toBe('sample/new'),
    );
    fireEvent.change(view.getByLabelText('Key'), { target: { value: '../bad key' } });
    fireEvent.click(view.getByRole('button', { name: 'Save Definition' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Use a key'));
    expect(actions.save).not.toHaveBeenCalled();
  });
  it('asks before closing an oversized snapshot even with no running terminals', async () => {
    actions.shells.mockResolvedValue(0);
    vi.mocked(window.viewer.workspaceDefinitions).mockResolvedValueOnce({
      kind: 'close-info',
      problem: 'this workspace alone exceeds the 16 MB memory limit',
    });
    const view = render(
      <DefinitionDialog
        kind="close"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(view.getByText(/Viewer can’t remember its planes/)).toBeTruthy());
    expect(view.queryByText(/0 terminals/)).toBeNull();
    expect(actions.close).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Close Workspace' }));
    await waitFor(() => expect(actions.close).toHaveBeenCalledWith(activeWorkspace().id, true));
  });
  it('M4: retries a failed first save without forcing until a confirmation reply is shown', async () => {
    actions.save
      .mockRejectedValueOnce(new Error('workspaces.jsonc changed during this edit.'))
      .mockResolvedValueOnce({
        kind: 'needs-confirmation',
        curated: true,
        dropsCommands: false,
        changed: true,
      })
      .mockResolvedValueOnce({ kind: 'saved' });
    const done = vi.fn();
    const view = render(
      <DefinitionDialog
        kind="save"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={done}
      />,
    );
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('changed during this edit'),
    );
    expect(view.queryByRole('button', { name: 'Save over Definition' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Try Again' }));
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith(activeWorkspace().id, false, undefined),
    );
    await waitFor(() => expect(view.getByText(/definition changed since/)).toBeTruthy());
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Save over Definition' }));
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith(activeWorkspace().id, true, undefined),
    );
    expect(done).toHaveBeenCalledOnce();
  });
  it('pages defined rows by 25, includes hidden and missing badges, and forgets only the chosen key', async () => {
    const view = render(
      <WorkspacesDialog onClose={() => {}} onOpen={async () => {}} onAction={() => {}} />,
    );
    expect(view.getByRole('tab', { name: 'Open (1)' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(view.getByRole('tab', { name: 'Defined (60)' }));
    const list = view.getByRole('list', { name: 'Defined workspaces' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(25);
    expect(view.getByText('Curated')).toBeTruthy();
    expect(view.getByText('Hidden')).toBeTruthy();
    expect(view.getByText('Folder missing')).toBeTruthy();
    expect(view.getByText('Remembers')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /Forget remembered planes for/ }));
    expect(window.viewer.workspaceDefinitions).not.toHaveBeenCalledWith({
      kind: 'forget',
      key: 'sample/project-0',
    });
    const confirmation = view.getByRole('dialog', { name: 'Forget remembered planes?' });
    expect(within(confirmation).getByText(/It opens from its definition next time/)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Forget remembered planes' }));
    await waitFor(() =>
      expect(window.viewer.workspaceDefinitions).toHaveBeenCalledWith({
        kind: 'forget',
        key: 'sample/project-0',
      }),
    );
    fireEvent.click(view.getByRole('button', { name: 'Next definition page' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(25);
    fireEvent.click(view.getByRole('button', { name: 'Next definition page' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(view.getByText('1 definition problems')).toBeTruthy();
    fireEvent.change(view.getByRole('searchbox', { name: 'Search definitions' }), {
      target: { value: 'project-59' },
    });
    expect(view.getByText('sample/project-59')).toBeTruthy();
  });
  it('shows one danger confirmation for a curated save even under Strict Mode', async () => {
    actions.save
      .mockResolvedValueOnce({ kind: 'needs-confirmation', curated: true, dropsCommands: true })
      .mockResolvedValueOnce({ kind: 'saved' });
    const done = vi.fn();
    const view = render(
      <StrictMode>
        <DefinitionDialog
          kind="save"
          workspace={activeWorkspace()}
          controller={{} as WorkspaceController}
          onClose={done}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(view.getByText(/This definition is curated/)).toBeTruthy());
    expect(actions.save).toHaveBeenCalledTimes(1);
    const save = view.getByRole('button', { name: 'Save over Definition' });
    expect(save.classList.contains('danger')).toBe(true);
    fireEvent.click(save);
    await waitFor(() =>
      expect(actions.save).toHaveBeenLastCalledWith(activeWorkspace().id, true, undefined),
    );
    expect(done).toHaveBeenCalledOnce();
  });
  it('dismisses automatic Close when an unsaved-text prompt cancels it', async () => {
    actions.shells.mockResolvedValue(0);
    actions.close.mockResolvedValueOnce(false);
    const done = vi.fn();
    render(
      <DefinitionDialog
        kind="close"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={done}
      />,
    );
    await waitFor(() => expect(actions.close).toHaveBeenCalledOnce());
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });
  it('asks about running shells but closes without a question when none run', async () => {
    const done = vi.fn();
    const view = render(
      <DefinitionDialog
        kind="close"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={done}
      />,
    );
    await waitFor(() => expect(view.getByText(/Its 2 terminals stop/)).toBeTruthy());
    expect(actions.close).not.toHaveBeenCalled();
    view.unmount();
    actions.shells.mockResolvedValue(0);
    render(
      <DefinitionDialog
        kind="close"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={done}
      />,
    );
    await waitFor(() => expect(actions.close).toHaveBeenCalledOnce());
  });
  it('proposes a key and name for Save as and links only after submitting the form', async () => {
    actions.save.mockResolvedValue({ kind: 'saved' });
    const view = render(
      <DefinitionDialog
        kind="save-as"
        workspace={activeWorkspace()}
        controller={{} as WorkspaceController}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect((view.getByLabelText('Key') as HTMLInputElement).value).toBe('sample/new'),
    );
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Sample room' } });
    fireEvent.click(view.getByRole('button', { name: 'Save Definition' }));
    await waitFor(() =>
      expect(actions.save).toHaveBeenCalledWith(activeWorkspace().id, false, {
        key: 'sample/new',
        name: 'Sample room',
      }),
    );
  });
});
