import { useEffect, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import type { FolderSizeTask } from '../../domain/files/metadata';
import { formatBytes } from '../../domain/files/entries';
import { embeddedPackage } from '../../domain/previews/documents/embedded';
import { receiveFolderSize, useFolderSize } from '../explorer/sizes';

/** A package's measured total, by its path and version. */
const totals = new Map<string, FolderSizeTask>();
const totalsLimit = 64;
const versionKey = (entry: FileEntry) =>
  JSON.stringify([entry.path, entry.identity, entry.modified, entry.size]);
function remember(key: string, task: FolderSizeTask) {
  totals.delete(key);
  totals.set(key, task);
  if (totals.size > totalsLimit) totals.delete(totals.keys().next().value!);
}

/** This view's own measurement of a version: its task, once started, or why it could not start. */
interface Measuring {
  key: string;
  id?: string;
  failed?: boolean;
}

/**
 * A document package's total size, as Finder shows it, where its folder's own size says nothing.
 * Each version is measured once; a view showing it again reads the total kept for it. A measurement
 * still running when its view goes is cancelled. Undefined for any other item.
 */
function usePackageSize(entry: FileEntry): string | undefined {
  const key = embeddedPackage(entry) ? versionKey(entry) : undefined;
  const [measuring, setMeasuring] = useState<Measuring>();
  // progress arrives as folder-size events, which the explorer's size store receives
  const progress = useFolderSize([entry.path]);
  const path = entry.path;
  useEffect(() => {
    if (!key || totals.has(key)) return;
    let shown = true;
    let id: string | undefined;
    setMeasuring({ key });
    window.viewer.folderSizeStart([path]).then(
      (task) => {
        id = task.id;
        if (!shown) {
          void window.viewer.folderSizeCancel(task.id).catch(() => {});
          return;
        }
        receiveFolderSize(task);
        setMeasuring({ key, id: task.id });
      },
      () => {
        if (shown) setMeasuring({ key, failed: true });
      },
    );
    return () => {
      shown = false;
      if (id && !totals.has(key)) void window.viewer.folderSizeCancel(id).catch(() => {});
    };
  }, [key, path]);
  const own = measuring?.key === key ? measuring : undefined;
  const task = own?.id && progress?.task.id === own.id ? progress.task : undefined;
  const finished = task?.status === 'completed' ? task : undefined;
  useEffect(() => {
    if (key && finished) remember(key, finished);
  }, [key, finished]);
  if (!key) return undefined;
  const total = totals.get(key) ?? finished;
  if (total) return formatBytes(total.bytes) + (total.skipped ? ' (partial)' : '');
  if (own?.failed || task?.status === 'failed' || task?.status === 'cancelled')
    return 'Size unavailable';
  return 'Calculating…';
}

/** A previewed item's size: a file's, or a document package's total. */
export function PreviewSize({ entry }: { entry: FileEntry }) {
  return <>{usePackageSize(entry) ?? formatBytes(entry.size)}</>;
}
