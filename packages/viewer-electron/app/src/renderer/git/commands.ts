import type { CapturedTarget } from '../../domain/automation/actions';
import type { GitActionKind } from '../../domain/comparison/git-actions';
import type { CommandContext, CommandDefinition } from '../commands/registry';
import type { WindowScopes } from '../commands/window-commands/scope';
import { captureTarget } from '../commands/target';

export interface GitCommandActions {
  start(kind: Exclude<GitActionKind, 'commit'>, target: CapturedTarget): void | Promise<void>;
  commit(target: CapturedTarget): void | Promise<void>;
  worktrees?(target: CapturedTarget): void;
}

/** Explicit human commands are independent of optional background Git status. */
export function gitCommands(
  { actions, state, space, paneScope }: WindowScopes,
  commands: GitCommandActions,
): CommandDefinition[] {
  const folderScope = (context: CommandContext) =>
    state.bootstrap.gitActionsAvailable !== false &&
    paneScope(context) &&
    context.workspaceID === space.id &&
    ['window', 'folder', 'files'].includes(context.scope) &&
    !!context.directory &&
    space.panes.some((pane) => pane.id === context.paneID && pane.type === 'folder');
  const selectedScope = (context: CommandContext) =>
    folderScope(context) &&
    context.selection.length > 0 &&
    context.selection.every((entry) => !entry.error && entry.kind !== 'other');
  const run = async (kind: GitActionKind, context: CommandContext) => {
    const available = kind === 'stage-selected' ? selectedScope(context) : folderScope(context);
    if (!available)
      throw new Error(
        kind === 'stage-selected'
          ? 'Select files or folders to stage.'
          : 'Choose an open folder for this Git action.',
      );
    const target = captureTarget(context, actions.workspace);
    if (kind === 'commit') await commands.commit(target);
    else await commands.start(kind, target);
  };
  const repository = (context: CommandContext) =>
    `Repository containing the current folder: ${context.directory}`;

  return [
    {
      id: 'git-action.status',
      label: 'Git status',
      group: 'Git',
      icon: 'list',
      aliases: ['git status', 'working tree', 'repository changes'],
      detail: repository,
      when: folderScope,
      run: (context) => run('status', context),
    },
    {
      id: 'git-action.log',
      label: 'Git history',
      group: 'Git',
      icon: 'clock',
      aliases: ['git log', 'commit history', 'repository history'],
      detail: repository,
      when: folderScope,
      run: (context) => run('log', context),
    },
    {
      id: 'git-action.stage-selected',
      label: 'Stage selection',
      group: 'Git',
      icon: 'plus',
      aliases: ['git add', 'stage selected files', 'stage selected folders'],
      detail: (context) => `Stage the selected paths. ${repository(context)}`,
      when: selectedScope,
      run: (context) => run('stage-selected', context),
    },
    {
      id: 'git-action.stage-all',
      label: 'Stage all changes in repository',
      group: 'Git',
      icon: 'plus',
      aliases: ['git add --all', 'git add -A', 'stage all'],
      detail: (context) => `Include additions, modifications and deletions. ${repository(context)}`,
      when: folderScope,
      run: (context) => run('stage-all', context),
    },
    {
      id: 'git-action.commit',
      label: 'Commit staged changes…',
      group: 'Git',
      icon: 'check',
      aliases: ['git commit', 'commit message', 'commit staged'],
      detail: (context) => `Commit only changes already staged. ${repository(context)}`,
      when: folderScope,
      run: (context) => run('commit', context),
    },
    {
      id: 'git-action.pull',
      label: 'Pull (fast-forward only)',
      group: 'Git',
      icon: 'down',
      aliases: ['git pull', 'git pull --ff-only', 'fetch upstream changes'],
      detail: (context) => `Pull from the configured upstream. ${repository(context)}`,
      when: folderScope,
      run: (context) => run('pull', context),
    },
    {
      id: 'git-action.push',
      label: 'Push to upstream',
      group: 'Git',
      icon: 'up',
      aliases: ['git push', 'push commits', 'push branch'],
      detail: repository,
      when: folderScope,
      run: (context) => run('push', context),
    },
    {
      id: 'git-worktrees',
      label: 'Open worktree…',
      group: 'Git',
      icon: 'folder',
      aliases: ['branches', 'git worktrees', 'checkouts', 'open branch'],
      detail: repository,
      when: (context) => folderScope(context) && !!commands.worktrees,
      run: (context) => {
        if (!folderScope(context) || !commands.worktrees)
          throw new Error('Choose an open repository folder with worktree browsing available.');
        commands.worktrees(captureTarget(context, actions.workspace));
      },
    },
  ];
}
