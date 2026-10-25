import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

export function comparisonCommands({
  actions,
  state,
  paneScope,
}: WindowScopes): CommandDefinition[] {
  return [
    {
      id: 'new-chat',
      label: 'Chat about files',
      group: 'Files',
      icon: 'info',
      aliases: ['conversation', 'ask', 'model'],
      when: paneScope,
      run: (context) =>
        actions.workspace.newChat(
          context.selection.length
            ? context.selection.map((file) => file.path)
            : context.directory
              ? [context.directory]
              : [],
        ),
    },
    {
      id: 'compare-files',
      label: 'Compare files',
      group: 'Files',
      icon: 'side-by-side',
      aliases: ['diff', 'compare selected'],
      when: (context) =>
        paneScope(context) &&
        context.selection.length === 2 &&
        context.selection.every((file) => file.kind === 'file'),
      run: (context) => {
        const [left, right] = context.selection;
        if (left && right)
          actions.workspace.openDiff(
            { kind: 'file', path: left.path },
            { kind: 'file', path: right.path },
          );
      },
    },
    {
      id: 'git-diff',
      label: 'Compare with HEAD',
      group: 'Git',
      icon: 'side-by-side',
      aliases: ['git', 'diff', 'changes'],
      when: (context) =>
        state.settings.settings.git.enabled &&
        paneScope(context) &&
        context.selection.length === 1 &&
        context.selection[0]?.kind === 'file',
      run: (context) => actions.workspace.openGitDiff(context.selection[0]!.path, context.paneID),
    },
    {
      id: 'git-changes',
      label: 'Git changes',
      group: 'Git',
      icon: 'list',
      aliases: ['git', 'repository', 'status'],
      when: (context) =>
        state.settings.settings.git.enabled && paneScope(context) && !!context.directory,
      run: (context) => actions.workspace.openGitChanges(context.directory!, context.paneID),
    },
  ];
}
