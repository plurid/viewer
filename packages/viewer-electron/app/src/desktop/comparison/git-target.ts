import type { CapturedTarget } from '../../domain/automation/actions';
import type { AgentWorkspaceSnapshot } from '../../domain/agents/requests';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export interface GitTargetWindow {
  originID: string;
  workspaceID?: string;
  alive: boolean;
  workspaces?: AgentWorkspaceSnapshot;
  owners?: Readonly<Record<string, string>>;
}

type CanonicalPath = (file: string) => Promise<string>;
const inside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};

/** Recheck the captured folder without requiring it to keep keyboard focus during review. */
export async function validateGitTarget(
  target: CapturedTarget,
  window: GitTargetWindow | undefined,
  canonical: CanonicalPath = realpath,
  allowedTypes: readonly string[] = ['folder'],
): Promise<void> {
  const space = window?.workspaces?.workspaces.find((space) => space.id === target.workspaceID);
  const pane = space?.panes.find((pane) => pane.id === target.paneID);
  const owner =
    pane && window?.owners && Object.hasOwn(window.owners, pane.id)
      ? window.owners[pane.id]
      : undefined;
  const root = pane && (space?.roots.includes(pane.id) ? pane.id : owner);
  if (
    !window?.alive ||
    target.originID !== window.originID ||
    window.workspaceID !== target.workspaceID ||
    !space?.roots.includes(target.rootID) ||
    root !== target.rootID ||
    !pane ||
    !allowedTypes.includes(pane.type) ||
    pane.path !== target.panePath
  )
    throw new Error('The originating folder or workspace changed. Run the Git action again.');
  const [source, directory] = await Promise.all([
    canonical(pane.path),
    canonical(target.directory),
  ]);
  if (!inside(source, directory))
    throw new Error('Choose a folder inside the originating folder plane.');
  for (const file of target.selection) {
    const parent = await canonical(path.dirname(path.resolve(file.path)));
    if (!inside(directory, parent))
      throw new Error('A selected Git path is outside the captured folder. Select it again.');
  }
}

/** Human actions use captured ownership, not the debounced agent-discovery target. */
export async function bindGitTarget(
  input: CapturedTarget,
  window: GitTargetWindow | undefined,
  canonical: CanonicalPath = realpath,
  allowedTypes: readonly string[] = ['folder'],
): Promise<CapturedTarget> {
  if (!window) throw new Error('The originating window closed. Choose the Git action again.');
  const target = { ...structuredClone(input), originID: window.originID };
  await validateGitTarget(target, window, canonical, allowedTypes);
  return target;
}
