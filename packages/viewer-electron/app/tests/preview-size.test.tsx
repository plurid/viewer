// @vitest-environment jsdom
/**
 * A preview's footer shows a document package's total size, as Finder does: "Calculating…" while it
 * is measured, once per version of the package, and the measurement ends with its footer.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FileEntry, ViewerAPI } from '../src/domain/contracts';
import type { FolderSizeTask } from '../src/domain/files/metadata';
import { PreviewSize } from '../src/renderer/previews/PreviewSize';
import { receiveFolderSize } from '../src/renderer/explorer/sizes';

const start = vi.fn<ViewerAPI['folderSizeStart']>();
const cancel = vi.fn<ViewerAPI['folderSizeCancel']>();
let tasks = 0;
beforeEach(() => {
  start.mockImplementation(async (paths) => ({
    id: `task-${++tasks}`,
    paths,
    status: 'running',
    bytes: 0,
    files: 0,
    folders: 0,
    skipped: 0,
  }));
  cancel.mockResolvedValue(undefined);
  Object.assign(window, { viewer: { folderSizeStart: start, folderSizeCancel: cancel } });
});
afterEach(() => cleanup());

const entry = (name: string, modified = 1): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: name.split('.').pop()!.toLowerCase(),
  mime: 'application/octet-stream',
  size: 96,
  kind: name.includes('.') && !name.endsWith('.txt') ? 'directory' : 'file',
  directory: !name.endsWith('.txt'),
  identity: `identity:${name}`,
  modified,
  created: 1,
  hidden: false,
});
/** The desktop's folder-size event for the latest task started, as the app delivers it. */
async function finish(bytes: number, skipped = 0) {
  const task = await start.mock.results.at(-1)!.value;
  await act(async () => {
    receiveFolderSize({
      ...(task as FolderSizeTask),
      status: 'completed',
      bytes,
      files: 3,
      skipped,
    });
  });
}

it('measures a package once per version and keeps its total for the next footer', async () => {
  const document = entry('Report.pages');
  const { rerender, unmount } = render(<PreviewSize entry={document} />);
  expect(screen.getByText('Calculating…')).toBeTruthy();
  await act(async () => {});
  expect(start).toHaveBeenCalledExactlyOnceWith(['/fixtures/Report.pages']);
  await finish(2_400_000);
  expect(screen.getByText('2.4 MB')).toBeTruthy();
  rerender(<PreviewSize entry={{ ...document }} />);
  unmount();
  render(<PreviewSize entry={document} />);
  expect(screen.getByText('2.4 MB')).toBeTruthy();
  expect(start).toHaveBeenCalledOnce();
  expect(cancel).not.toHaveBeenCalled();
  // a saved document is another version, measured again
  cleanup();
  render(<PreviewSize entry={entry('Report.pages', 2)} />);
  expect(screen.getByText('Calculating…')).toBeTruthy();
  await act(async () => {});
  expect(start).toHaveBeenCalledTimes(2);
  await finish(2_500_000, 1);
  expect(screen.getByText('2.5 MB (partial)')).toBeTruthy();
});

it('cancels a measurement still running when its footer goes', async () => {
  const { unmount } = render(<PreviewSize entry={entry('Budget.numbers')} />);
  await act(async () => {});
  const task = await start.mock.results.at(-1)!.value;
  unmount();
  expect(cancel).toHaveBeenCalledExactlyOnceWith(task.id);
});

it('shows a file, or any other folder, by its own size without measuring', () => {
  for (const name of ['Notes.txt', 'Viewer.app']) {
    const { container } = render(<PreviewSize entry={entry(name)} />);
    expect([name, container.textContent]).toEqual([name, '96 B']);
  }
  expect(start).not.toHaveBeenCalled();
});

it('says the size is unavailable when it cannot be measured', async () => {
  start.mockRejectedValueOnce(new Error('Finish or cancel an existing size calculation first.'));
  render(<PreviewSize entry={entry('Slides.key')} />);
  expect(await screen.findByText('Size unavailable')).toBeTruthy();
});
