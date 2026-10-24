// @vitest-environment jsdom
/**
 * EDIT FROM QUICK PREVIEW (2026-10-23): a text file previewed in Quick Preview opens as its plane,
 * active and editing, from an Edit button or ⌘E.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, Resource } from '../src/domain/contracts';
import type { PreviewModule } from '../src/renderer/previews/contracts';

vi.mock('../src/renderer/previews/PreviewHost', async () => {
  const { choosePreview } = await import('../src/renderer/previews/registry');
  return {
    PreviewHost: ({
      path,
      renderFooter,
    }: {
      path: string;
      renderFooter(resource: Resource, module: PreviewModule): unknown;
    }) => {
      const name = path.split('/').pop()!;
      const extension = name.split('.').pop()!;
      const size = name.startsWith('large') ? 5 * 1024 * 1024 : 12;
      const entry: FileEntry = {
        path,
        name,
        parent: '/fixtures',
        extension,
        size,
        kind: 'file',
        directory: false,
        modified: 1,
        created: 1,
        hidden: false,
        mime: extension === 'png' ? 'image/png' : 'text/plain',
        identity: path,
      };
      return renderFooter({ id: 'resource', url: '', entry }, choosePreview(entry));
    },
  };
});
import { QuickPreview, quickPreviewEdit } from '../src/renderer/previews/QuickPreview';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { getState, initialize, quickPreview } from '../src/renderer/state/store';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
const workspace = {
  openPath: vi.fn(async () => {}),
  focusPane: vi.fn(),
} as unknown as WorkspaceController;
beforeEach(() => {
  vi.mocked(workspace.openPath).mockClear();
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      applications: vi.fn(async () => ({ defaultName: 'TextEdit', applications: [] })),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(cleanup);
const show = (path: string) => {
  quickPreview([path], { paneID: 'folder', workspaceID: getState().saved.activeWorkspace });
  return render(
    createElement(
      WorkspaceContext.Provider,
      { value: workspace },
      createElement(QuickPreview, { session: getState().quickPreview! }),
    ),
  );
};

it.each(['notes.md', 'index.html'])(
  'opens %s as its plane, active and editing, and closes',
  async (name) => {
    const path = '/fixtures/' + name;
    const view = show(path);
    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    await waitFor(() =>
      expect(workspace.openPath).toHaveBeenCalledWith(path, {
        workspaceID: getState().saved.activeWorkspace,
        paneID: 'folder',
        linked: true,
        activate: true,
        edit: true,
      }),
    );
    await waitFor(() => expect(getState().quickPreview).toBeNull());
  },
);
it('offers no Edit for a file that is not text, or too large to edit', () => {
  expect(show('/fixtures/photo.png').queryByRole('button', { name: 'Edit' })).toBeNull();
  cleanup();
  expect(show('/fixtures/large.log').queryByRole('button', { name: 'Edit' })).toBeNull();
});
it('edits with ⌘E while Quick Preview shows a text file', async () => {
  show('/fixtures/notes.md');
  await act(async () => {
    expect(quickPreviewEdit()).toBe(true);
  });
  await waitFor(() => expect(workspace.openPath).toHaveBeenCalledOnce());
});
