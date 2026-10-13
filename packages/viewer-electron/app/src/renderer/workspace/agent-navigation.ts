import type { AgentNavigation } from '../../domain/agent-requests';
import type { CapturedTarget } from '../../domain/automation';
import { activeWorkspace, getState, navigate } from '../state/store';
import { browseSession, updateBrowseSession } from './sessions';
import type { WorkspaceController } from './context';

/** Uses the same host records as the UI. This path never requests an OS grant. */
export async function executeAgentNavigation(
  request: AgentNavigation,
  target: CapturedTarget,
  controller: WorkspaceController,
  switchTo: (id: string) => Promise<void>,
): Promise<void> {
  const origin = () => {
    const space = activeWorkspace();
    const pane = space.panes.find((pane) => pane.id === target.paneID);
    if (
      space.id === target.workspaceID &&
      !space.panes.length &&
      target.paneID === 'none' &&
      target.rootID === 'none'
    )
      return undefined;
    if (
      space.id !== target.workspaceID ||
      !pane ||
      (target.panePath && pane.path !== target.panePath) ||
      controller.rootID(pane.id) !== target.rootID
    )
      throw new Error('The originating plane or folder changed. Request a new proposal.');
    if (
      pane.type === 'folder' &&
      (pane.mode === 'columns' ? browseSession(pane.id, pane.path).columnDirectory : pane.path) !==
        target.directory
    )
      throw new Error('The originating folder changed. Request a new proposal.');
    return pane;
  };
  const pane = origin();
  if (request.kind === 'focus-plane') {
    const destination = activeWorkspace().panes.find((pane) => pane.id === request.pane.id);
    if (
      !destination ||
      destination.path !== request.pane.path ||
      destination.type !== request.pane.type ||
      (destination.type === 'search' && destination.allLocations !== request.pane.allLocations)
    )
      throw new Error('The destination plane changed. Request a new proposal.');
    controller.focusPane(destination.id);
    return;
  }
  if (request.kind === 'switch-workspace') {
    const destination = getState().saved.workspaces.find(
      (space) => space.id === request.workspace.id,
    );
    if (
      !destination ||
      destination.panes.length !== request.workspace.panes.length ||
      destination.panes.some(
        (pane) =>
          !request.workspace.panes.some(
            (expected) =>
              expected.id === pane.id &&
              expected.type === pane.type &&
              expected.path === pane.path &&
              (pane.type !== 'search' || pane.allLocations === expected.allLocations),
          ),
      )
    )
      throw new Error('The destination workspace changed. Request a new proposal.');
    await switchTo(destination.id);
    return;
  }
  if (request.kind === 'open-path') {
    const entry = await window.viewer.stat(request.path);
    origin();
    if (!pane && request.placement === 'linked') throw new Error('Focus a folder plane first.');
    if (request.placement === 'current' && entry.directory && pane?.type === 'folder') {
      navigate(pane.id, entry.path);
      controller.focusPane(pane.id);
    } else controller.open(entry, pane?.id, { another: !pane || request.placement === 'root' });
    return;
  }
  if (pane?.type !== 'folder') throw new Error('Focus a folder plane before selecting files.');
  const entries = [];
  for (const expected of request.files) {
    const actual = await window.viewer.stat(expected.path);
    origin();
    if (actual.identity !== expected.identity || actual.parent !== expected.parent)
      throw new Error(
        'A selected file changed or is outside the captured folder. Request a new proposal.',
      );
    entries.push(actual);
  }
  const session = browseSession(pane.id, pane.path);
  const cache = new Map(session.cache);
  for (const entry of entries) cache.set(entry.path, entry);
  const paths = entries.map((entry) => entry.path);
  updateBrowseSession(pane.id, pane.path, {
    selection: paths,
    cursor: paths.at(-1) || '',
    anchor: paths[0] || '',
    cache,
    ...(pane.mode === 'columns'
      ? { columnScope: target.directory, columnDirectory: target.directory }
      : {}),
  });
}
