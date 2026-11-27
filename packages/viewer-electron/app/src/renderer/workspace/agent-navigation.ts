import { trashLocation, trashPersonOnly } from '../../domain/files/trash';
import { sameCapturedItem } from '../../domain/files/entries';
import type { AgentNavigation } from '../../domain/agents/requests';
import type { CapturedTarget } from '../../domain/automation/actions';
import { activeWorkspace, getState, navigate } from '../state/store';
import { browseSession, updateBrowseSession } from './sessions';
import type { WorkspaceController } from './context';
import { deferTerminalStart } from '../terminals/sessions';
import { withAgentDispatch } from '../app/agent-dispatch';

/** Uses the same host records as the UI. This path never requests an OS grant. */
export async function executeAgentNavigation(
  request: AgentNavigation,
  target: CapturedTarget,
  controller: WorkspaceController,
  switchTo: (id: string) => Promise<void>,
  dispatchID?: string,
  deadline?: number,
): Promise<void> {
  const checkDeadline = () => {
    if (deadline !== undefined && Date.now() > deadline)
      throw new Error('The agent action timed out before finishing.');
  };
  checkDeadline();
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
      throw new Error('The plane or folder this request was for has changed. Ask the agent again.');
    if (
      pane.type === 'folder' &&
      (pane.mode === 'columns' ? browseSession(pane.id, pane.path).columnDirectory : pane.path) !==
        target.directory
    )
      throw new Error('The folder this request was for has changed. Ask the agent again.');
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
      throw new Error('The plane to open into has changed. Ask the agent again.');
    if (destination.type === 'terminal') deferTerminalStart([destination.id]);
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
      throw new Error('The workspace to open into has changed. Ask the agent again.');
    deferTerminalStart(
      destination.panes.filter((pane) => pane.type === 'terminal').map((pane) => pane.id),
    );
    await withAgentDispatch(dispatchID, () => switchTo(destination.id));
    checkDeadline();
    return;
  }
  if (request.kind === 'open-path') {
    if (request.path === trashLocation) throw new Error(trashPersonOnly);
    const entry = await withAgentDispatch(dispatchID, () => window.viewer.stat(request.path));
    checkDeadline();
    origin();
    if (!pane && request.placement === 'linked') throw new Error('Focus a files plane first.');
    if (request.placement === 'current' && entry.directory && pane?.type === 'folder') {
      navigate(pane.id, entry.path);
      controller.focusPane(pane.id);
    } else controller.open(entry, pane?.id, { another: !pane || request.placement === 'root' });
    return;
  }
  if (pane?.type !== 'folder') throw new Error('Focus a files plane before selecting files.');
  const entries = [];
  for (const expected of request.files) {
    checkDeadline();
    const actual = await withAgentDispatch(dispatchID, () => window.viewer.stat(expected.path));
    checkDeadline();
    origin();
    if (!sameCapturedItem(actual, expected) || actual.parent !== expected.parent)
      throw new Error(
        'A file the agent chose has changed or is outside its folder. Ask the agent again.',
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
