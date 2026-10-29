import { pathContains } from '../../domain/files/paths';
import { parentPath } from '../../domain/workspaces/planes';
import type { WindowEvents } from '../app/window-events';
import { sendWindowEvent, windowEventDetail } from '../app/window-events';

type RefreshRequest = WindowEvents['viewer:refresh'];

/**
 * Asks open folders to list again. With `paths`, only the folders they are in or under do:
 * a finished copy once re-listed every open folder, each a full read of its entries.
 */
export function requestRefresh(paths?: readonly string[]): void {
  sendWindowEvent('viewer:refresh', paths && { paths });
}

/** Whether a refresh request, or the event carrying it, concerns the folder at `folder`. */
export function refreshConcerns(request: RefreshRequest | Event, folder: string): boolean {
  if (request instanceof Event) {
    return refreshConcerns(windowEventDetail('viewer:refresh', request), folder);
  }
  const paths = request?.paths;
  return (
    !paths ||
    paths.some(
      (file) => file === folder || parentPath(file) === folder || pathContains(file, folder),
    )
  );
}
