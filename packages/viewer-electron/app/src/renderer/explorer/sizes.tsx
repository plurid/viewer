import { useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { FolderSizeTask } from '../../domain/metadata';
import { formatBytes } from '../../domain/files';
import { getState, report } from '../state/store';
import { IconButton } from '../ui/primitives';

type Measurement = { task: FolderSizeTask; stale: boolean };
const measurements = new Map<string, Measurement>();
const listeners = new Map<string, Set<() => void>>();
const requests = new Map<string, symbol>();
const keyFor = (paths: readonly string[]) => JSON.stringify([...new Set(paths)].sort());
export function receiveFolderSize(task: FolderSizeTask) {
  const key = keyFor(task.paths);
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
export async function calculateSize(entries: readonly FileEntry[]) {
  const paths = entries.map((entry) => entry.path);
  const key = keyFor(paths);
  const request = Symbol();
  requests.set(key, request);
  try {
    const task = await window.viewer.folderSizeStart(paths);
    if (requests.get(key) === request) receiveFolderSize(task);
  } finally {
    if (requests.get(key) === request) requests.delete(key);
  }
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
            void window.viewer.folderSizeCancel(task.id).catch(report);
          }}
        />
      )}
    </span>
  );
}
