import { activeWorkspace } from '../state/store';
import { confirmClose, discardUnsaved } from '../editing/unsaved';
import type { WorkspaceController } from '../workspace/context';

/**
 * CLOSING MANY PLANES, for `:q`, `:qa` and `:only`: each plane given closes with the
 * planes opened from it. Unsaved text is asked about first, as Close plane does, and Cancel closes
 * nothing; `discard` drops it without asking, as vim's `!`.
 */
export async function closePlanes(
  workspace: WorkspaceController,
  ids: readonly string[],
  discard = false,
): Promise<boolean> {
  const all = ids.flatMap((id) => workspace.subtree(id));
  if (discard) await discardUnsaved(all);
  else if (!(await confirmClose(all))) return false;
  for (const id of ids) workspace.closePane(id);
  return true;
}
/** The workspace's planes that were not opened from another: closing them closes all. */
export const rootPlanes = (workspace: WorkspaceController) =>
  activeWorkspace()
    .panes.filter((pane) => !workspace.parentPaneID(pane.id))
    .map((pane) => pane.id);
/** What `:only` closes: every plane but `kept` and the planes it was opened from. */
export function otherPlanes(workspace: WorkspaceController, kept: string): string[] {
  const keep = new Set<string>();
  for (let id: string | undefined = kept; id; id = workspace.parentPaneID(id)) keep.add(id);
  return activeWorkspace()
    .panes.filter((pane) => {
      if (keep.has(pane.id)) return false;
      const parent = workspace.parentPaneID(pane.id);
      return !parent || keep.has(parent);
    })
    .map((pane) => pane.id);
}
