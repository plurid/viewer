import { pathContains } from '../../domain/files/paths';
import { parentPath } from '../../domain/workspaces/planes';

/**
 * Asks open folders to list again. With `paths`, only the folders they are in or under do:
 * a finished copy once re-listed every open folder, each a full read of its entries.
 */
export function requestRefresh(paths?: readonly string[]): void {
  window.dispatchEvent(new CustomEvent('viewer:refresh', { detail: paths && { paths } }));
}

/** Whether a refresh request concerns the folder at `folder`. */
export function refreshConcerns(event: Event, folder: string): boolean {
  const paths = (event as CustomEvent<{ paths: readonly string[] } | undefined>).detail?.paths;
  return (
    !paths ||
    paths.some(
      (file) => file === folder || parentPath(file) === folder || pathContains(file, folder),
    )
  );
}
