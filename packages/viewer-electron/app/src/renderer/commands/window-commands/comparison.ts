import type { CommandContext, CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';
import { toolFiles } from '../target';
import { browsable } from '../../../domain/files/entries';
import { knownRepository } from '../../git/status';

/** The folder Git changes is for: the one folder selected, or the plane's own. */
const gitChangesFolder = (context: CommandContext) => {
  const [only] = context.selection;
  return context.selection.length === 1 && only && browsable(only) ? only.path : context.directory;
};

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
      id: 'build-canvas',
      label: 'Build Tool from Selection',
      group: 'Files',
      icon: 'chat',
      aliases: ['canvas', 'interactive', 'agent tool', 'build app'],
      when: (context) => paneScope(context) && context.selection.length > 0,
      run: (context) =>
        actions.workspace.newChat(
          context.selection.map((file) => file.path),
          'Build an interactive canvas from these files. I want to ',
        ),
    },
    {
      id: 'new-chat',
      label: 'Chat About Files',
      group: 'Files',
      icon: 'chat',
      aliases: ['conversation', 'ask', 'model'],
      when: paneScope,
      run: (context) => {
        const files = toolFiles(context);
        return actions.workspace.newChat(
          files.length
            ? files.map((file) => file.path)
            : context.directory
              ? [context.directory]
              : [],
        );
      },
    },
    {
      id: 'explore-folder',
      label: (context) =>
        context.selection.length &&
        !(context.selection.length === 1 && context.selection[0]!.directory)
          ? 'Explore Selected Items'
          : 'Explore This Folder',
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
      label: 'Compare Files',
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
      label: 'Git Changes',
      group: 'Git',
      icon: 'list',
      aliases: ['git', 'repository', 'status'],
      // only where Git status already read a repository: a menu opens without asking Git
      when: (context) => {
        const folder = gitChangesFolder(context);
        return (
          state.settings.settings.git.enabled &&
          paneScope(context) &&
          !!folder &&
          !!knownRepository(folder)
        );
      },
      run: (context) =>
        actions.workspace.openGitChanges(gitChangesFolder(context)!, context.paneID),
    },
  ];
}
