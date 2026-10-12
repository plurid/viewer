import type { FileEntry } from '../../domain/contracts';
import { needsFolderAccess } from '../../domain/file-access';
import { activeWorkspace, getState, navigate } from '../state/store';
import type { WorkspaceController } from './context';

/** Permission recovery keeps the workspace/plane captured before the native
 * dialog. A cancelled or stale request must not replace a different folder. */
export async function openWorkspacePath(
  path: string,
  target: Parameters<WorkspaceController['openPath']>[1],
  controller: Pick<WorkspaceController, 'open' | 'focusPane'>,
): Promise<void> {
  const workspaceID = target?.workspaceID ?? activeWorkspace().id;
  const paneID = target?.paneID ?? getState().activePane;
  const origin = activeWorkspace().panes.find((pane) => pane.id === paneID);
  const current = () => {
    if (activeWorkspace().id !== workspaceID) return false;
    const pane = activeWorkspace().panes.find((pane) => pane.id === paneID);
    return !paneID || (!!pane && pane.path === origin?.path);
  };
  if (!current()) return;
  let entry: FileEntry;
  try {
    entry = await window.viewer.stat(path);
  } catch (error) {
    if (!target?.directory || !needsFolderAccess((error as { code?: string }).code)) throw error;
    if (!current()) return;
    const selected = await window.viewer.chooseFolder(path);
    if (!selected || !current()) return;
    entry = await window.viewer.stat(selected);
    window.dispatchEvent(new Event('viewer:refresh'));
  }
  if (!current()) return;
  const pane = activeWorkspace().panes.find((pane) => pane.id === paneID);
  if (entry.directory && pane?.type === 'folder' && !target?.linked && !target?.another) {
    navigate(pane.id, entry.path);
    controller.focusPane(pane.id);
  } else controller.open(entry, pane?.id, { another: target?.another, link: target?.link });
}
