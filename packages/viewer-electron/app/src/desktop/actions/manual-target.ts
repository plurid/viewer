import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { GitTargetWindow } from '../comparison/git-target';
import { containsPath } from '../files/containment';

/** Manual commands capture an owned view or the workspace's Home context, never an arbitrary cwd. */
export async function validateManualTarget(
  target: CapturedTarget,
  window: GitTargetWindow | undefined,
  home: string,
  canonical: (file: string) => Promise<string> = realpath,
): Promise<void> {
  const space = window?.workspaces?.workspaces.find((space) => space.id === target.workspaceID);
  if (
    !window?.alive ||
    target.originID !== window.originID ||
    window.workspaceID !== target.workspaceID ||
    !space
  )
    throw new Error('The originating workspace changed. Open the command again.');
  const pane = space.panes.find((pane) => pane.id === target.paneID);
  if (target.paneID) {
    const owner =
      pane && window.owners && Object.hasOwn(window.owners, pane.id)
        ? window.owners[pane.id]
        : undefined;
    const root = pane && (space.roots.includes(pane.id) ? pane.id : owner);
    if (!pane || root !== target.rootID || !space.roots.includes(target.rootID))
      throw new Error('The originating plane changed. Open the command again.');
  } else if (target.rootID || target.panePath || target.selection.length) {
    throw new Error('An empty workspace command must use Home without a file selection.');
  }
  const fileContext = pane && ['folder', 'terminal', 'preview'].includes(pane.type);
  if (fileContext && pane.path !== target.panePath)
    throw new Error('The originating path changed. Open the command again.');
  const source = fileContext
    ? pane.type === 'preview'
      ? path.dirname(pane.path)
      : pane.path
    : home;
  const [expected, directory] = await Promise.all([canonical(source), canonical(target.directory)]);
  if (pane?.type === 'folder' ? !containsPath(expected, directory) : expected !== directory)
    throw new Error('The command folder no longer matches its captured context.');
  for (const file of target.selection) {
    const parent = await canonical(path.dirname(path.resolve(file.path)));
    if (!containsPath(directory, parent))
      throw new Error('A selected file is outside the captured command folder.');
  }
}

export async function bindManualTarget(
  input: CapturedTarget,
  window: GitTargetWindow | undefined,
  home: string,
): Promise<CapturedTarget> {
  if (!window) throw new Error('The originating window closed. Open the command again.');
  const target = { ...structuredClone(input), originID: window.originID };
  await validateManualTarget(target, window, home);
  return target;
}
