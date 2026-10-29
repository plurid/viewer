import type * as ReactModule from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import type { FolderSizeTask } from '../src/domain/files/metadata';

// the hooks are read outside a component: each returns what one render would
vi.mock('react', async (original) => ({
  ...(await original<typeof ReactModule>()),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../src/renderer/state/store', () => ({
  getState: () => ({ bootstrap: { platform: 'darwin' } }),
  report: vi.fn(),
}));
const folder = { path: '/fixtures/folder', directory: true } as FileEntry;
const completed: FolderSizeTask = {
  id: 'owned-size-task',
  paths: [folder.path],
  status: 'completed',
  bytes: 1234,
  files: 2,
  folders: 1,
  skipped: 0,
  measuredAt: 1,
};
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { viewer: {} });
});

it('publishes calculating state while the native start request is still pending', async () => {
  let finish!: (task: FolderSizeTask) => void;
  window.viewer.folderSizeStart = vi.fn(
    () =>
      new Promise<FolderSizeTask>((resolve) => {
        finish = resolve;
      }),
  );
  const sizes = await import('../src/renderer/explorer/sizes');
  const calculation = sizes.calculateSize([folder]);
  expect(sizes.useFolderSize([folder.path])?.task.status).toBe('running');
  finish(completed);
  await calculation;
  expect(sizes.useFolderSize([folder.path])?.task).toEqual(completed);
});

it('retains an early completed event when the start response arrives later', async () => {
  let finish!: (task: FolderSizeTask) => void;
  window.viewer.folderSizeStart = vi.fn(
    () =>
      new Promise<FolderSizeTask>((resolve) => {
        finish = resolve;
      }),
  );
  const sizes = await import('../src/renderer/explorer/sizes');
  const calculation = sizes.calculateSize([folder]);
  sizes.receiveFolderSize(completed);
  finish({ ...completed, status: 'running', bytes: 0 });
  await calculation;
  expect(sizes.useFolderSize([folder.path])?.task).toEqual(completed);
});

it('publishes failure instead of reverting to an uncalculated selection', async () => {
  window.viewer.folderSizeStart = vi.fn(async () => {
    throw new Error('Worker unavailable');
  });
  const sizes = await import('../src/renderer/explorer/sizes');
  await expect(sizes.calculateSize([folder])).rejects.toThrow('Worker unavailable');
  expect(sizes.useFolderSize([folder.path])?.task).toMatchObject({
    status: 'failed',
    error: 'Worker unavailable',
    paths: [folder.path],
  });
});

it('deduplicates starts and honours cancellation before the native acknowledgement', async () => {
  let finish!: (task: FolderSizeTask) => void;
  window.viewer.folderSizeStart = vi.fn(
    () =>
      new Promise<FolderSizeTask>((resolve) => {
        finish = resolve;
      }),
  );
  window.viewer.folderSizeCancel = vi.fn(async () => {});
  const sizes = await import('../src/renderer/explorer/sizes');
  const calculation = sizes.calculateSize([folder]);
  expect(sizes.calculateSize([folder])).toBe(calculation);
  const cancellation = sizes.cancelFolderSize([folder.path]);
  expect(sizes.useFolderSize([folder.path])?.task.status).toBe('cancelled');
  expect(window.viewer.folderSizeCancel).not.toHaveBeenCalled();
  sizes.receiveFolderSize({ ...completed, status: 'running' });
  expect(sizes.useFolderSize([folder.path])?.task.status).toBe('cancelled');
  finish({ ...completed, status: 'running' });
  await Promise.all([calculation, cancellation]);
  expect(window.viewer.folderSizeStart).toHaveBeenCalledTimes(1);
  expect(window.viewer.folderSizeCancel).toHaveBeenCalledExactlyOnceWith(completed.id);
  expect(sizes.useFolderSize([folder.path])?.task).toMatchObject({
    id: completed.id,
    status: 'cancelled',
  });
});

it('reuses a measured folder in a larger selection without counting descendants twice', async () => {
  const sizes = await import('../src/renderer/explorer/sizes');
  sizes.receiveFolderSize(completed);
  const file = { path: '/fixtures/note.txt', directory: false, size: 42 } as FileEntry;
  expect(sizes.selectionSize([folder, file]).label).toBe('1.2 KB');
  expect(sizes.selectionSize([folder, file]).task?.bytes).toBe(1276);
  expect(
    sizes.selectionSize([folder, { ...file, path: folder.path + '/note.txt' }]).task?.bytes,
  ).toBe(1234);
});

it('shows each batch-measured folder independently, including a genuinely empty folder', async () => {
  const sizes = await import('../src/renderer/explorer/sizes');
  const empty = { ...folder, path: '/fixtures/empty' };
  sizes.receiveFolderSize({
    ...completed,
    paths: [folder.path, empty.path],
    items: [
      { path: folder.path, bytes: 1234, files: 2, folders: 1, skipped: 0 },
      { path: empty.path, bytes: 0, files: 0, folders: 1, skipped: 0 },
    ],
  });
  expect(sizes.useFolderSize([folder.path])?.task.bytes).toBe(1234);
  expect(sizes.selectionSize([empty]).label).toBe('0 B');
});

it('includes known bytes while identifying only folders that are still unmeasured', async () => {
  const sizes = await import('../src/renderer/explorer/sizes');
  sizes.receiveFolderSize(completed);
  const unknown = { ...folder, path: '/fixtures/unknown' };
  const selection = sizes.selectionSize([folder, unknown]);
  expect(selection.label).toBe('1.2 KB · 1 folder not calculated');
});

it('invalidates totals after a descendant change and uses the refreshed individual measurement', async () => {
  const sizes = await import('../src/renderer/explorer/sizes');
  sizes.receiveFolderSize(completed);
  sizes.invalidateFolderSizes(folder.path + '/nested.txt');
  expect(sizes.selectionSize([folder]).label).toBe('Size needs recalculation');
  sizes.receiveFolderSize({ ...completed, id: 'refreshed', bytes: 20 });
  expect(sizes.selectionSize([folder]).label).toBe('20 B');
  expect(sizes.useFolderSize([folder.path])?.stale).toBe(false);
});

it('preserves partial and unreadable results when composing selections', async () => {
  const sizes = await import('../src/renderer/explorer/sizes');
  sizes.receiveFolderSize({ ...completed, skipped: 1 });
  const file = { path: '/fixtures/note.txt', directory: false, size: 42 } as FileEntry;
  expect(sizes.selectionSize([folder, file]).label).toContain('Partial (1 unreadable)');
  sizes.receiveFolderSize({ ...completed, id: 'unreadable', skipped: 1, bytes: 0 });
  expect(sizes.selectionSize([folder]).label).toContain('Size unavailable');
});
