import { useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { FolderSizeTask } from '../../domain/metadata';
import { formatBytes } from '../../domain/files';
import { getState, report } from '../state/store';
import { IconButton } from '../ui/primitives';

type Measurement = { task: FolderSizeTask; stale: boolean };
const measurements = new Map<string, Measurement>();
const listeners = new Map<string, Set<() => void>>();
type SizeRequest = { cancelled: boolean; promise: Promise<void> };
const requests = new Map<string, SizeRequest>();
const keyFor = (paths: readonly string[]) => JSON.stringify([...new Set(paths)].sort());
export function receiveFolderSize(task: FolderSizeTask) {
  const key = keyFor(task.paths);
  if (requests.get(key)?.cancelled) return;
  const previous = measurements.get(key);
  if (
    previous?.task.id === task.id &&
    previous.task.status !== 'running' &&
    task.status === 'running'
  )
    return;
  measurements.set(key, { task, stale: previous?.task.id === task.id ? previous.stale : false });
  listeners.get(key)?.forEach((listener) => listener());
  for (const [key, measurement] of measurements) {
    if (measurements.size <= 64) break;
    if (measurement.task.status !== 'running' && !listeners.get(key)?.size)
      measurements.delete(key);
  }
}
export function invalidateFolderSizes(path: string) {
  const separator = getState().bootstrap.platform === 'win32' ? '\\' : '/';
  const within = (a: string, b: string) =>
    a === b || b.startsWith(a.endsWith(separator) ? a : a + separator);
  for (const [key, value] of measurements) {
    if (!value.stale && value.task.paths.some((root) => within(root, path) || within(path, root))) {
      measurements.set(key, { ...value, stale: true });
      listeners.get(key)?.forEach((listener) => listener());
    }
  }
}
export function calculateSize(entries: readonly FileEntry[]): Promise<void> {
  const paths = [...new Set(entries.map((entry) => entry.path))].sort();
  const key = keyFor(paths);
  const existing = requests.get(key);
  if (existing) return existing.promise;
  const pending: FolderSizeTask = {
    id: `pending:${crypto.randomUUID()}`,
    paths,
    status: 'running',
    bytes: 0,
    files: 0,
    folders: 0,
    skipped: 0,
  };
  const request: SizeRequest = { cancelled: false, promise: Promise.resolve() };
  requests.set(key, request);
  receiveFolderSize(pending);
  request.promise = (async () => {
    try {
      const task = await window.viewer.folderSizeStart(paths);
      if (request.cancelled) {
        // Cancellation can precede the native acknowledgement. Never send the
        // renderer's temporary ID to the worker or lose the user's cancellation.
        measurements.set(key, { task: { ...task, status: 'cancelled' }, stale: false });
        listeners.get(key)?.forEach((listener) => listener());
        if (task.status === 'running') await window.viewer.folderSizeCancel(task.id);
      } else receiveFolderSize(task);
    } catch (error) {
      if (!request.cancelled)
        receiveFolderSize({
          ...pending,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      throw error;
    } finally {
      if (requests.get(key) === request) requests.delete(key);
    }
  })();
  return request.promise;
}
export function cancelFolderSize(paths: readonly string[]): Promise<void> {
  const key = keyFor(paths);
  const request = requests.get(key);
  if (request) {
    const measurement = measurements.get(key);
    if (measurement) receiveFolderSize({ ...measurement.task, status: 'cancelled' });
    request.cancelled = true;
    return request.promise;
  }
  const task = measurements.get(key)?.task;
  return task?.status === 'running' ? window.viewer.folderSizeCancel(task.id) : Promise.resolve();
}
export function useFolderSize(paths: readonly string[]) {
  const key = keyFor(paths);
  return useSyncExternalStore(
    (listener) => {
      const set = listeners.get(key) || new Set();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
    () => measurements.get(key),
  );
}
export function SelectionSize({
  entries,
  fallback = '',
}: {
  entries: readonly FileEntry[];
  fallback?: string;
}) {
  const measurement = useFolderSize(entries.map((entry) => entry.path));
  const task = measurement?.task;
  const folders = entries.some((entry) => entry.directory);
  const bytes = entries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.size), 0);
  let label = entries.length
    ? folders
      ? entries.some((entry) => !entry.directory)
        ? `${formatBytes(bytes)} in files · Folder size not calculated`
        : 'Size not calculated'
      : formatBytes(bytes)
    : fallback;
  if (task?.status === 'running') label = `Calculating… ${task.files.toLocaleString()} files`;
  else if (measurement?.stale) label = 'Size needs recalculation';
  else if (task?.status === 'completed')
    label =
      task.skipped && !task.bytes
        ? 'Size unavailable · Unreadable items'
        : `${formatBytes(task.bytes)}${task.skipped ? ` · Partial (${task.skipped} unreadable)` : ''}`;
  else if (task?.status === 'cancelled') label = 'Size calculation cancelled';
  else if (task?.status === 'failed') label = 'Size could not be calculated';
  return (
    <span
      className="selection-size"
      title={
        task?.measuredAt
          ? `Calculated ${new Date(task.measuredAt).toLocaleString()}. Use Calculate Size to refresh.`
          : task?.error
      }
    >
      <span aria-live="polite">{label}</span>
      {task?.status === 'running' && (
        <IconButton
          icon="close"
          label="Cancel size calculation"
          onClick={() => {
            void cancelFolderSize(entries.map((entry) => entry.path)).catch(report);
          }}
        />
      )}
    </span>
  );
}
