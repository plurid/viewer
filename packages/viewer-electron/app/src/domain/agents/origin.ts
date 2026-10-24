import type { CapturedTarget } from '../automation/actions';

interface OriginState {
  activeWorkspace: string;
  workspaces: readonly { id: string; panes: readonly unknown[] }[];
}

/** A window-only origin carries no implied file authority, including its fallback directory. */
export function isEmptyAgentOrigin(
  target: CapturedTarget,
  state: OriginState | undefined,
): boolean {
  if (
    target.paneID !== 'none' ||
    target.rootID !== 'none' ||
    target.panePath !== undefined ||
    target.selection.length !== 0 ||
    state?.activeWorkspace !== target.workspaceID
  )
    return false;
  const workspace = state.workspaces.find((space) => space.id === target.workspaceID);
  return !!workspace && workspace.panes.length === 0;
}
