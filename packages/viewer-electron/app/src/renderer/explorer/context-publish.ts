import { useEffect } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { activeWorkspace, report } from '../state/store';
import { useWorkspace } from '../workspace/context';

/** The desktop accepts at most this many published sources. A larger selection is
 * not described at all, rather than as a misleading partial list. */
export const publishedSelectionLimit = 2000;

/** Publishes the active plane's selection as the user's current context. `location`
 * republishes when the plane navigates while its selection object is unchanged. */
export function useContextPublish(
  paneID: string,
  active: boolean,
  selected: readonly Pick<FileEntry, 'path'>[],
  location?: string,
): void {
  const workspace = useWorkspace();
  useEffect(() => {
    if (!active) return;
    const rootID = workspace.rootID(paneID);
    if (!rootID) return;
    void window.viewer
      .contextPublish({
        workspaceID: activeWorkspace().id,
        paneID,
        rootID,
        sources: selected.length > publishedSelectionLimit ? [] : selected.map((file) => file.path),
        actor: 'user',
      })
      .catch(report);
  }, [active, paneID, selected, workspace, location]);
}
