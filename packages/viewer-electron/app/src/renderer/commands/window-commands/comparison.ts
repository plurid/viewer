import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** What Explore asks; the person sees it as their message and can follow up. */
const exploreRequest =
  'Explore what is here: say what it holds, link the files that stand out, and propose what you would do with them.';

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
      id: 'explore-folder',
      label: (context) =>
        context.selection.length &&
        !(context.selection.length === 1 && context.selection[0]!.directory)
          ? 'Explore selected items'
          : 'Explore this folder',
      group: 'Files',
      icon: 'search',
      aliases: ['explore', 'agent', 'summarize', 'what is here', 'insights'],
      when: (context) => paneScope(context) && (!!context.selection.length || !!context.directory),
      run: (context) =>
        actions.workspace.newChat(
          context.selection.length
            ? context.selection.map((file) => file.path)
            : [context.directory!],
          exploreRequest,
          true,
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
