import type { CapturedTarget } from '../../domain/automation/actions';
import type { FileEntry } from '../../domain/contracts';
import type { WorkspaceController } from '../workspace/context';
import type { CommandContext } from './registry';

/** What a file tool acts on: the selection, else the file the plane previews. */
export function toolFiles(context: Pick<CommandContext, 'selection' | 'subject'>): FileEntry[] {
  if (context.selection.length) return [...context.selection];
  return context.subject ? [context.subject] : [];
}

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
