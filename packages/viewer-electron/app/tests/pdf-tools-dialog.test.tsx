// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry, ViewerAPI, OperationJob } from '../src/domain/contracts';
import { PDFToolsDialog } from '../src/renderer/pdf-tools/PDFToolsDialog';
import { flushState, initialize, receiveJob } from '../src/renderer/state/store';
vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn() }),
}));
vi.mock('../src/renderer/pdf-tools/PDFPagePreview', () => ({
  PDFPagePreview: () => <div>Page preview</div>,
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
const files = ['First.pdf', 'Second.pdf'].map(
  (name, index) =>
    ({
      name,
      path: '/fixture/' + name,
      parent: '/fixture',
      extension: 'pdf',
      mime: 'application/pdf',
      kind: 'file',
      directory: false,
      size: 100,
      identity: String(index),
      modified: 1,
      created: 1,
      hidden: false,
    }) as FileEntry,
);
function setup(operate: ViewerAPI['operate']) {
  Object.assign(window, {
    viewer: {
      operate,
      cancelJob: vi.fn(async () => {}),
      pdfInspect: vi.fn(async (file) => ({
        pages: file.endsWith('First.pdf') ? 3 : 2,
        version: { identity: file, modified: 7, size: 100 },
      })),
      save: vi.fn(async () => {}),
    },
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  render(<PDFToolsDialog files={files} onClose={vi.fn()} />);
}
it('submits the reordered extraction with source versions from inspection and one combined PDF output', async () => {
  const operate = vi.fn<ViewerAPI['operate']>(async () => 'export-job');
  setup(operate);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Save PDF' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('PDF page range'), { target: { value: '3-2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save PDF' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  expect(operate.mock.calls[0]![0]).toMatchObject({
    sources: files.map((file) => file.path),
    name: 'Merged.pdf',
    transform: {
      kind: 'pdf-pages',
      pages: [
        { source: 0, page: 3, rotate: 0 },
        { source: 0, page: 2, rotate: 0 },
        { source: 1, page: 1, rotate: 0 },
        { source: 1, page: 2, rotate: 0 },
      ],
    },
    expectedSources: files.map((file) => ({
      path: file.path,
      version: { identity: file.path, modified: 7, size: 100 },
    })),
  });
});
it('cancels a split job admitted after Cancel and stops admitting the remaining pages', async () => {
  let admitted!: (id: string) => void;
  const operate = vi.fn<ViewerAPI['operate']>(
    () =>
      new Promise((resolve) => {
        admitted = resolve;
      }),
  );
  setup(operate);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Save PDF' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByLabelText('Save each included page separately'));
  fireEvent.click(screen.getByRole('button', { name: 'Split pages' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
  await act(async () => admitted('late-pdf'));
  await waitFor(() => expect(window.viewer.cancelJob).toHaveBeenCalledWith('late-pdf'));
  expect(operate).toHaveBeenCalledOnce();
});
it('clears the prior saved acknowledgement when the output draft changes', async () => {
  const operate = vi.fn<ViewerAPI['operate']>(async () => 'export-job');
  setup(operate);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Save PDF' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save PDF' }));
  await waitFor(() => expect(operate).toHaveBeenCalledOnce());
  await act(async () => {
    receiveJob({
      id: 'export-job',
      kind: 'convert',
      status: 'completed',
      sources: files.map((file) => file.path),
      completed: [{ source: '', destination: '/fixture/Merged.pdf' }],
      errors: [],
      itemsTotal: 1,
      itemsDone: 1,
    } as OperationJob);
  });
  await screen.findByText('1 PDF saved');
  fireEvent.change(screen.getByLabelText('PDF output name'), { target: { value: 'Another.pdf' } });
  await waitFor(() => expect(screen.queryByText('1 PDF saved')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Open Merged.pdf' })).toBeNull();
});
