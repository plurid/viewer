import type { FolderPane } from '../../domain/contracts';
import { parentPath } from '../../domain/planes';

/** The mouse's back (4) and forward (5) side buttons, as `MouseEvent.button` reports them. */
export function mouseHistoryDirection(button: number): -1 | 1 | 0 {
  return button === 3 ? -1 : button === 4 ? 1 : 0;
}
/**
 * Where a side button takes a folder plane: back and forward through its history, as in
 * Finder. Back with no earlier folder in the history goes up to the parent folder.
 */
export function mouseHistoryTarget(
  pane: Pick<FolderPane, 'path' | 'history' | 'historyIndex'>,
  direction: -1 | 1,
): { history: number } | { parent: string } | undefined {
  if (direction > 0)
    return pane.historyIndex < pane.history.length - 1 ? { history: 1 } : undefined;
  if (pane.historyIndex > 0) return { history: -1 };
  const parent = parentPath(pane.path);
  return parent !== pane.path ? { parent } : undefined;
}
