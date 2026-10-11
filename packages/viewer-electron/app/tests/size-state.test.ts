import { beforeEach, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import type { FolderSizeTask } from '../src/domain/metadata';

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
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
