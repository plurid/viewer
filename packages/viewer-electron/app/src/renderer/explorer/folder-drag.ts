import type { FileEntry, FolderPane } from '../../domain/contracts';
import { panePresentation } from '../../domain/folder-presentation';
import { activeWorkspace, folderPresentation, remember, updatePane } from '../state/store';
import { browseSession, updateBrowseSession } from '../workspace/sessions';
import { SpringNavigation } from './drag-navigation';

interface FolderDragState {
  workspace: string;
  pane: FolderPane;
  trail: string[];
  scope: string;
  directory: string;
}
/** Temporary traversal shares the existing pane/session, preserving docking and selection. */
export function folderDragNavigation(id: string) {
  let snapshot: FolderDragState | undefined;
  const read = (): FolderDragState | undefined => {
    const workspace = activeWorkspace();
    const pane = workspace.panes.find((pane) => pane.id === id);
    if (pane?.type !== 'folder') return undefined;
    const session = browseSession(id, pane.path);
    if (
      snapshot?.workspace === workspace.id &&
      snapshot.pane === pane &&
      snapshot.trail === session.columnTrail &&
      snapshot.scope === session.columnScope &&
      snapshot.directory === session.columnDirectory
    )
      return snapshot;
    return (snapshot = {
      workspace: workspace.id,
      pane,
      trail: session.columnTrail,
      scope: session.columnScope,
      directory: session.columnDirectory,
    });
  };
  return new SpringNavigation<FolderDragState, FileEntry>({
    read,
    inspect: async (path) => {
      try {
        const entry = await window.viewer.stat(path);
        return entry.directory && entry.kind !== 'symlink' ? entry : undefined;
      } catch {
        // Hover cannot grant access or interrupt the drag with a permission dialog.
        return undefined;
      }
    },
    open: (entry, before) => {
      if (entry.path === before.pane.path) return before;
      if (before.pane.mode === 'columns') {
        const depth =
          entry.parent === before.pane.path ? 0 : before.trail.indexOf(entry.parent) + 1;
        if (entry.parent !== before.pane.path && !depth) return before;
        updateBrowseSession(id, before.pane.path, {
          columnTrail: [...before.trail.slice(0, depth), entry.path],
          columnScope: entry.path,
          columnDirectory: entry.path,
        });
      } else {
        // Persisted panes require history[historyIndex] to match their path.
        // Replace this temporary slot; cancellation restores the original array.
        const history = [...before.pane.history];
        history[before.pane.historyIndex] = entry.path;
        updatePane(id, {
          path: entry.path,
          history,
          ...panePresentation(folderPresentation(entry.path)),
        });
      }
      return read();
    },
    restore: (initial, current) => {
      if (initial.pane.mode === 'columns' && current.pane.path === initial.pane.path)
        updateBrowseSession(id, initial.pane.path, {
          columnTrail: initial.trail,
          columnScope: initial.scope,
          columnDirectory: initial.directory,
        });
      else
        updatePane(id, {
          path: initial.pane.path,
          history: initial.pane.history,
          historyIndex: initial.pane.historyIndex,
          mode: initial.pane.mode,
          sort: initial.pane.sort,
          descending: initial.pane.descending,
          showHidden: initial.pane.showHidden,
        });
    },
    commit: (initial, current) => {
      if (initial.pane.mode === 'columns') return;
      const history = [
        ...initial.pane.history.slice(0, initial.pane.historyIndex + 1),
        current.pane.path,
      ].slice(-200);
      updatePane(id, { history, historyIndex: history.length - 1 });
      remember(current.pane.path);
    },
  });
}
