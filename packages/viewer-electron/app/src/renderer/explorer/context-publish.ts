import { useEffect } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { activeWorkspace, report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';

/** The desktop accepts at most this many published sources. A larger selection is
 * not described at all, rather than as a misleading partial list. */
const publishedSelectionLimit = 2000;

/** A held arrow key changes the selection every few milliseconds; publish once it settles. */
const settleDelay = 100;

/** Publishes the active plane's selection as the user's current context, which only agents
 * read. `location` republishes when the plane navigates while its selection object is unchanged. */
export function useContextPublish(
  paneID: string,
  active: boolean,
  selected: readonly Pick<FileEntry, 'path'>[],
  location?: string,
): void {
  const workspace = useWorkspace();
  const agents = useViewer((state) => state.settings.settings.agents.enabled);
  useEffect(() => {
    if (!active || !agents) return;
    const rootID = workspace.rootID(paneID);
    if (!rootID) return;
    const timer = setTimeout(() => {
      void window.viewer
        .contextPublish({
          workspaceID: activeWorkspace().id,
          paneID,
          rootID,
          sources:
            selected.length > publishedSelectionLimit ? [] : selected.map((file) => file.path),
          actor: 'user',
        })
        .catch(report);
    }, settleDelay);
    return () => clearTimeout(timer);
  }, [active, agents, paneID, selected, workspace, location]);
}
