import type { CapturedTarget } from '../../domain/automation/actions';
import type { WorkspaceController } from '../workspace/context';
import type { CommandContext } from './registry';

/** Freeze origin, ownership and selected file identities before any asynchronous action. */
export function captureTarget(
  context: CommandContext,
  workspace: Pick<WorkspaceController, 'rootID'>,
): CapturedTarget {
  const directory = context.directory || context.folder?.path;
  if (!directory) throw new Error('Choose a folder for this action.');
  return structuredClone({
    workspaceID: context.workspaceID,
    rootID: context.rootID || workspace.rootID(context.paneID || '') || context.paneID || '',
    paneID: context.paneID || '',
    panePath: context.path || context.folder?.path,
    directory,
    selection: [...context.selection],
  });
}
