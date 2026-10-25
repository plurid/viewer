// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import { OptimizeDialog } from '../src/renderer/media/OptimizeDialog';
import { flushState, initialize } from '../src/renderer/state/store';

vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn() }),
}));
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});

it('cancels an export admitted after Cancel and prevents the next format group from starting', async () => {
  let admitted!: (id: string) => void;
  const operate = vi.fn<ViewerAPI['operate']>(
    () =>
      new Promise((resolve) => {
        admitted = resolve;
      }),
  );
  const cancelJob = vi.fn(async () => {});
  Object.assign(window, { viewer: { operate, cancelJob, save: vi.fn(async () => {}) } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const files = ['png', 'pdf'].map(
    (extension) =>
      ({
        name: 'source.' + extension,
        path: '/fixture/source.' + extension,
        parent: '/fixture',
        extension,
        mime: 'application/octet-stream',
        kind: 'file',
        directory: false,
        size: 100,
        identity: extension,
        modified: 1,
        created: 1,
        hidden: false,
      }) as FileEntry,
  );
  render(createElement(OptimizeDialog, { files, onClose: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Optimize 2 files' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel optimization' }));
  await act(async () => admitted('late-admission'));
  await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('late-admission'));
  expect(operate).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Cancel optimization' })).toBeNull();
});
