import { useCallback, useContext, useSyncExternalStore } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { WorkspaceContext } from './context';
import { activeWorkspace, useViewer } from '../state/store';
import { Icon } from '../ui/Icon';
const emptySubscription = () => () => {};
export function LinkedPlaneButton({ paneID, entry }: { paneID?: string; entry: FileEntry }) {
  const workspace = useContext(WorkspaceContext);
  useViewer((state) => activeWorkspace(state).panes);
  const { path, directory } = entry;
  const snapshot = useCallback(
    () => (paneID ? workspace?.linkedPaneID(paneID, { path, directory }) : undefined),
    [workspace, paneID, path, directory],
  );
  const id = useSyncExternalStore(workspace?.subscribeLinks ?? emptySubscription, snapshot);
  if (!id) return null;
  return (
    <button
      type="button"
      className="linked-plane-marker"
      aria-label={`View linked plane for ${entry.name}`}
      title="View linked plane"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        const live = paneID && workspace?.linkedPaneID(paneID, entry);
        // following the link makes its plane the active one, as clicking it would
        if (live) workspace?.focusPane(live, { activate: true });
      }}
    >
      <Icon name="link" size={14} />
    </button>
  );
}
