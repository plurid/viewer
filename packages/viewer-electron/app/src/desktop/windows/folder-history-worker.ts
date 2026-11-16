import { lstatSync, realpathSync, statSync } from 'node:fs';
import { workerPort } from '../workers/worker-port';
import type { CheckedFolder } from '../../domain/files/folder-checks';

/** Synchronous metadata in dedicated threads never queues work in the shared libuv pool. */
export function checkRememberedFolder(path: string): CheckedFolder {
  const item = lstatSync(path);
  if (item.isSymbolicLink()) {
    try {
      if (!statSync(path).isDirectory()) return { directory: false };
    } catch {
      return { directory: false, unavailable: true };
    }
  } else if (!item.isDirectory()) return { directory: false };
  return { directory: true, path: realpathSync(path) };
}

workerPort.on('message', (event) => {
  const path = event.data as string;
  try {
    workerPort.postMessage({ value: checkRememberedFolder(path) });
  } catch {
    workerPort.postMessage({ value: { directory: false, unavailable: true } });
  }
});
