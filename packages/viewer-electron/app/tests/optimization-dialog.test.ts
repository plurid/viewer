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
it('allows digit-by-digit scan size entry and validates it before export', async () => {
  const operate = vi.fn<ViewerAPI['operate']>(async () => 'scan-job');
  Object.assign(window, { viewer: { operate, save: vi.fn(async () => {}) } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const file = {
    name: 'scan.pdf',
    path: '/fixture/scan.pdf',
    parent: '/fixture',
    extension: 'pdf',
    kind: 'file',
    size: 100,
    identity: 'scan',
    modified: 1,
  } as FileEntry;
  render(
    createElement(OptimizeDialog, { files: [file], initial: 'pdf-for-email', onClose: vi.fn() }),
  );
  const input = screen.getByLabelText('PDF maximum image edge') as HTMLInputElement;
  for (const value of ['', '1', '16', '160', '1600']) {
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe(value);
  }
  fireEvent.change(input, { target: { value: '9000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Optimize file' }));
  await screen.findByRole('alert');
  expect(operate).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '1600' } });
  fireEvent.click(screen.getByRole('button', { name: 'Optimize file' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  expect(operate.mock.calls[0]![0]).toMatchObject({
    transform: { kind: 'pdf', recompressImages: true, maxImageEdge: 1600 },
  });
});
