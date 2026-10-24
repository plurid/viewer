import type { Pane, Workspace } from '../../domain/contracts';
import type { CapturedTarget } from '../../domain/automation/actions';
import { isEmptyAgentOrigin } from '../../domain/agents/origin';
import { agentCatalog } from '../commands/agent-catalog';
import type { CommandContext, CommandRegistry } from '../commands/registry';
import type { WorkspaceController } from '../workspace/context';

export type AgentOrigin = { empty: true; pane?: undefined } | { empty: false; pane: Pane };

/** A reviewed action still belongs to the exact live workspace and originating plane. */
export function resolveAgentOrigin(
  target: CapturedTarget,
  workspace: Workspace,
  controller: Pick<WorkspaceController, 'rootID'>,
): AgentOrigin | undefined {
  if (target.workspaceID !== workspace.id) return undefined;
  if (
    isEmptyAgentOrigin(target, {
      activeWorkspace: workspace.id,
      workspaces: [workspace],
    })
  )
    return { empty: true };
  const pane = workspace.panes.find((pane) => pane.id === target.paneID);
  if (
    !pane ||
    (target.panePath !== undefined && pane.path !== target.panePath) ||
    controller.rootID(pane.id) !== target.rootID
  )
    return undefined;
  return { empty: false, pane };
}

/** Keep window commands in window scope and omit placeholder paths from an empty invocation. */
export function commandAtAgentOrigin(
  registry: CommandRegistry,
  commandID: string,
  target: CapturedTarget,
  origin: AgentOrigin,
  windowContext: CommandContext,
) {
  return agentCatalog(registry, {
    ...windowContext,
    workspaceID: target.workspaceID,
    rootID: origin.empty ? undefined : target.rootID,
    paneID: origin.empty ? undefined : target.paneID,
    directory: origin.empty ? undefined : target.directory,
    selection: target.selection,
    path: origin.pane?.path,
    folder: origin.pane?.type === 'folder' ? origin.pane : undefined,
  }).find((command) => command.id === commandID);
}
