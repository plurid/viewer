import { useEffect, type RefObject } from 'react';
import type { FolderPane } from '../../domain/contracts';
import type { BrowseSession } from '../workspace/sessions';

/**
 * Where a folder's views were scrolled. Each mode keeps its own offset and each column in Columns
 * its own, by the column's folder; the Map keeps its camera. One value was shared by every mode
 * and restored into the first column, whichever column had been scrolled.
 */
export function recordScroll(
  session: BrowseSession,
  mode: FolderPane['mode'],
  target: HTMLElement,
): void {
  if (!target.classList.contains('file-scroll') || mode === 'map') return;
  if (mode === 'columns') {
    const column = target.closest<HTMLElement>('[data-folder-path]')?.dataset.folderPath;
    if (column) session.columnScroll.set(column, target.scrollTop);
    return;
  }
  session.scroll[mode] = target.scrollTop;
}
/** Restores a folder's offsets once its listing is ready, and again on Back or Forward to a cached
 * folder, which is ready at once: restored only on a load, it kept the previous folder's offset
 *. Following the session while the person scrolls would fight them. */
export function useScrollRestore(
  surface: RefObject<HTMLElement | null>,
  session: BrowseSession,
  mode: FolderPane['mode'] | undefined,
  ready: boolean,
): void {
  useEffect(() => {
    const element = surface.current;
    if (!element || !ready || !mode || mode === 'map') return;
    if (mode === 'columns') {
      for (const scroll of element.querySelectorAll<HTMLElement>('.file-scroll')) {
        const column = scroll.closest<HTMLElement>('[data-folder-path]')?.dataset.folderPath;
        if (column) scroll.scrollTop = session.columnScroll.get(column) ?? 0;
      }
      return;
    }
    const content = element.querySelector<HTMLElement>('.file-scroll');
    if (content) content.scrollTop = session.scroll[mode] ?? 0;
  }, [surface, session, mode, ready]);
}
