import { activeWorkspace, useViewer } from '../state/store';
import { setWorkspaceSpaceColor } from '../state/workspaces';
import { looks } from '../workspace/look';
import { ColorField } from './ColorField';
import { Dialog } from './primitives';

/**
 * A WORKSPACE'S BACKGROUND (2026-10-23): the space's colour in this workspace, over the general one
 * from Settings → Space. A choice shows at once; the general colour takes it back.
 */
export function WorkspaceBackgroundDialog({ onClose }: { onClose(): void }) {
  const workspace = useViewer(activeWorkspace);
  const look = useViewer((state) => state.saved.look);
  const general = useViewer((state) => state.saved.ui.space.color);
  return (
    <Dialog title="Workspace background" onClose={onClose} className="workspace-background-dialog">
      <div className="dialog-copy">
        <p>
          The space’s colour in “{workspace.name}”. Other workspaces keep theirs; the general colour
          is in Settings → Space.
        </p>
      </div>
      <ColorField
        label="Workspace background"
        value={workspace.spaceColor ?? ''}
        look={look}
        automatic="General colour"
        automaticColor={general || looks[look].space}
        onChange={setWorkspaceSpaceColor}
      />
      <footer>
        <button className="primary" data-autofocus onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
