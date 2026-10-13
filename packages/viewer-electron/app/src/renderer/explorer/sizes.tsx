import { useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { FolderSizeTask } from '../../domain/metadata';
import { formatBytes } from '../../domain/files';
import { parentPath } from '../../domain/planes';
import { getState, report } from '../state/store';
import { IconButton } from '../ui/primitives';

type Measurement = { task: FolderSizeTask; stale: boolean };
const measurements = new Map<string, Measurement>();
const listeners = new Map<string, Set<() => void>>();
const revisions = new Map<string, number>();
type SizeRequest = { cancelled: boolean; promise: Promise<void> };
const requests = new Map<string, SizeRequest>();
const keyFor = (paths: readonly string[]) => JSON.stringify([...new Set(paths)].sort());
function publish(key: string, measurement: Measurement) {
  measurements.set(key, measurement);
  revisions.set(key, (revisions.get(key) || 0) + 1);
  listeners.get(key)?.forEach((listener) => listener());
}
function subscribe(key: string, listener: () => void) {
  const set = listeners.get(key) || new Set();
  listeners.set(key, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}
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
  const stale = previous?.task.id === task.id ? previous.stale : false;
  publish(key, { task, stale });
  if (task.status === 'completed')
    for (const item of task.items || []) {
      const itemKey = keyFor([item.path]);
      if (itemKey === key) continue;
      const old = measurements.get(itemKey);
      // A separately requested recalculation owns its own in-flight result.
      if (old?.task.status === 'running' && old.task.id !== task.id) continue;
      publish(itemKey, {
        task: { ...task, ...item, paths: [item.path], items: undefined },
        stale,
      });
    }
  for (const [key, measurement] of measurements) {
    if (measurements.size <= 1024) break;
    if (measurement.task.status !== 'running' && !listeners.get(key)?.size) {
      measurements.delete(key);
      revisions.delete(key);
    }
  }
}
export function invalidateFolderSizes(path: string) {
  const separator = getState().bootstrap.platform === 'win32' ? '\\' : '/';
  const within = (a: string, b: string) =>
    a === b || b.startsWith(a.endsWith(separator) ? a : a + separator);
  for (const [key, value] of measurements) {
    if (!value.stale && value.task.paths.some((root) => within(root, path) || within(path, root))) {
      publish(key, { ...value, stale: true });
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
        publish(key, { task: { ...task, status: 'cancelled' }, stale: false });
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
    (listener) => subscribe(key, listener),
    () => measurements.get(key),
  );
}
function measuredSize(measurement: Measurement) {
  const task = measurement.task;
  const label =
    task.status === 'running'
      ? `Calculating… ${task.files.toLocaleString()} files`
      : measurement.stale
        ? 'Size needs recalculation'
        : task.status === 'completed'
          ? task.skipped && !task.bytes
            ? 'Size unavailable · Unreadable items'
            : `${formatBytes(task.bytes)}${task.skipped ? ` · Partial (${task.skipped} unreadable)` : ''}`
          : task.status === 'cancelled'
            ? 'Size calculation cancelled'
            : 'Size could not be calculated';
  return { label, task, stale: measurement.stale };
}
/** Reuse individual measurements across selections; a parent's total already includes its descendants. */
export function selectionSize(entries: readonly FileEntry[], fallback = '') {
  const exact = measurements.get(keyFor(entries.map((entry) => entry.path)));
  if (exact && !exact.stale) return measuredSize(exact);
  const folders = new Set(entries.filter((entry) => entry.directory).map((entry) => entry.path));
  const seen = new Set<string>();
  const roots = entries.filter((entry) => {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    for (let parent = parentPath(entry.path); parent; parent = parentPath(parent)) {
      if (folders.has(parent)) return false;
      if (parent === parentPath(parent)) break;
    }
    return true;
  });
  let bytes = 0,
    skipped = 0,
    unmeasured = 0,
    stale = 0;
  const parts: FolderSizeTask[] = [];
  for (const entry of roots) {
    if (!entry.directory) {
      bytes += entry.size;
      continue;
    }
    const measurement = measurements.get(keyFor([entry.path]));
    if (measurement?.task.status === 'running') return measuredSize(measurement);
    if (measurement?.stale) stale++;
    else if (measurement?.task.status === 'completed') {
      bytes += measurement.task.bytes;
      skipped += measurement.task.skipped;
      parts.push(measurement.task);
    } else {
      if (roots.length === 1 && measurement) return measuredSize(measurement);
      unmeasured++;
    }
  }
  if (stale || unmeasured) {
    const unknown = stale + unmeasured;
    const label =
      !bytes && !parts.length
        ? stale
          ? 'Size needs recalculation'
          : 'Size not calculated'
        : `${formatBytes(bytes)} · ${unknown} ${unknown === 1 ? 'folder' : 'folders'} ${stale ? 'need recalculation' : 'not calculated'}`;
    return { label, task: undefined, stale: !!stale };
  }
  if (!parts.length)
    return { label: entries.length ? formatBytes(bytes) : fallback, task: undefined, stale: false };
  return measuredSize({
    stale: false,
    task: {
      id: 'selection',
      paths: roots.map((entry) => entry.path),
      status: 'completed',
      bytes,
      skipped,
      files: parts.reduce(
        (sum, task) => sum + task.files,
        roots.filter((entry) => !entry.directory).length,
      ),
      folders: parts.reduce((sum, task) => sum + task.folders, 0),
      measuredAt: Math.min(...parts.map((task) => task.measuredAt || Date.now())),
    },
  });
}
export function FolderSizeValue({ path }: { path: string }) {
  const measurement = useFolderSize([path]);
  const task = measurement?.task;
  const fresh = task?.status === 'completed' && !measurement?.stale;
  return (
    <span
      title={
        measurement ? measuredSize(measurement).label : 'Use Calculate Size to measure this folder.'
      }
    >
      {fresh && (!task.skipped || task.bytes)
        ? `${formatBytes(task.bytes)}${task.skipped ? ' (partial)' : ''}`
        : task?.status === 'running'
          ? '…'
          : '—'}
    </span>
  );
}
export function SelectionSize({
  entries,
  fallback = '',
}: {
  entries: readonly FileEntry[];
  fallback?: string;
}) {
  const paths = entries.map((entry) => entry.path);
  const keys = [...new Set([keyFor(paths), ...paths.map((path) => keyFor([path]))])];
  useSyncExternalStore(
    (listener) => {
      const off = keys.map((key) => subscribe(key, listener));
      return () => off.forEach((remove) => remove());
    },
    () => keys.map((key) => revisions.get(key) || 0).join(','),
  );
  const { label, task } = selectionSize(entries, fallback);
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
            void cancelFolderSize(task.paths).catch(report);
          }}
        />
      )}
    </span>
  );
}
