// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { DefinitionDialog } from '../src/renderer/ui/workspace/DefinitionDialog';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { savePatch } from '../src/renderer/state/core';
import { flushState } from '../src/renderer/state/persistence';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      terminalCount: vi.fn(),
      workspaceDefinitions: vi.fn(),
    },
  });
  initialize({
    home: '/home/sample',
    platform: 'darwin',
    state: null,
    openPaths: [],
    locations: [],
  });
  savePatch({
    workspaces: [{ ...activeWorkspace(), definition: { key: 'sample', basis: 'a'.repeat(64) } }],
  });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});

it.each([0, 2])(
  'updates Close after a new memory refusal (running terminals: %s)',
  async (shells) => {
    vi.mocked(window.viewer.terminalCount).mockResolvedValue(shells);
    vi.mocked(window.viewer.workspaceDefinitions)
      .mockResolvedValueOnce({ kind: 'close-info' })
      .mockResolvedValueOnce({
        kind: 'close-info',
        problem: 'the memory file must be repaired first',
      })
      .mockResolvedValueOnce({ kind: 'closed' });
    const workspace = activeWorkspace();
    const done = vi.fn();
    const view = render(
      <DefinitionDialog
        kind="close"
        workspace={workspace}
        controller={{} as WorkspaceController}
        onClose={done}
      />,
    );
    if (shells) {
      await waitFor(() => expect(view.getByText(/Its 2 terminals stop/)).toBeTruthy());
      fireEvent.click(view.getByRole('button', { name: 'Close workspace' }));
    }
    await waitFor(() =>
      expect(view.getByText(/^Close “Workspace”\?/).textContent).toContain(
        'Viewer cannot remember its planes: the memory file must be repaired first.',
      ),
    );
    expect(done).not.toHaveBeenCalled();
    expect(activeWorkspace().id).toBe(workspace.id);
    expect(window.viewer.workspaceDefinitions).toHaveBeenNthCalledWith(2, {
      kind: 'close',
      workspaceID: workspace.id,
    });
    fireEvent.click(view.getByRole('button', { name: 'Close workspace' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(window.viewer.workspaceDefinitions).toHaveBeenLastCalledWith({
      kind: 'close',
      workspaceID: workspace.id,
      withoutMemory: true,
    });
    expect(getState().saved.workspaces.some((space) => space.id === workspace.id)).toBe(false);
  },
);
