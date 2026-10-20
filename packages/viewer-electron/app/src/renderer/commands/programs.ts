import type { CommandContext, CommandDefinition } from './registry';
import type { CapturedTarget } from '../../domain/automation';
import { actionAvailable, terminalDirectory } from '../../domain/automation';
import { getState } from '../state/store';
import type { WorkspaceController } from '../workspace/context';
import { requestAction } from '../actions/commands';
import type { IconName } from '../ui/Icon';
export function captureTarget(
  context: CommandContext,
  workspace: WorkspaceController,
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
export function programCommands(
  workspace: WorkspaceController,
  /** `false` when no command of that ID is available here. */
  invoke: (id: string, context: CommandContext) => Promise<boolean | void>,
  terminalName?: string,
): CommandDefinition[] {
  const folder = (context: CommandContext) => !!context.directory || !!context.folder;
  const target = (context: CommandContext) => {
    const captured = captureTarget(context, workspace);
    return { ...captured, directory: terminalDirectory(captured.directory, captured.selection) };
  };
  return [
    {
      id: 'open-terminal',
      label: terminalName ? 'Open in ' + terminalName : 'Open Terminal',
      group: 'Terminal',
      icon: 'terminal',
      aliases: ['ot', 'terminal', 'iterm', 'shell'],
      when: folder,
      run: (context) => window.viewer.terminalExternal(target(context).directory, false),
    },
    {
      id: 'open-tmux',
      label: 'Open in tmux',
      group: 'Terminal',
      icon: 'terminal',
      aliases: ['tm', 'tmux', 'window'],
      when: folder,
      run: (context) => window.viewer.terminalExternal(target(context).directory, true),
    },
    {
      id: 'open-terminal-plane',
      label: 'Open terminal plane',
      group: 'Terminal',
      icon: 'terminal',
      primary: true,
      aliases: ['tp', 'terminal plane', 'shell plane'],
      when: folder,
      run: (context) => workspace.newTerminal(target(context)),
    },
    {
      id: 'open-config',
      label: 'Open configuration file',
      group: 'App',
      icon: 'settings',
      aliases: ['config', 'jsonc', 'oc'],
      when: () => true,
      run: () => window.viewer.configOpen(),
    },
    ...getState()
      .settings.settings.customActions.toSorted((a, b) => a.order - b.order)
      .map((action): CommandDefinition => ({
        id: 'custom.' + action.id,
        label: action.name,
        group: 'Actions',
        icon: (['terminal', 'command', 'rename', 'folder', 'external', 'code', 'copy'].includes(
          action.icon,
        )
          ? action.icon
          : 'command') as IconName,
        aliases: action.aliases,
        shortcut: action.shortcut,
        primary: action.pinned,
        when: (context) =>
          folder(context) && actionAvailable(action, captureTarget(context, workspace)),
        run: async (context) => {
          const executor = action.executor;
          if (executor.kind === 'builtin') {
            if (executor.command.startsWith('custom.'))
              throw new Error('Custom actions cannot call another custom action.');
            // an unknown or unavailable command did nothing, silently (2026-10-20)
            if ((await invoke(executor.command, context)) === false)
              throw new Error(
                `“${action.name}” runs “${executor.command}”, which is not a command available here.`,
              );
          } else if (executor.kind === 'recipe') {
            // it opened Run action with no recipe, whose Create did nothing (2026-10-20)
            if (!getState().settings.settings.recipes.some(({ id }) => id === executor.recipeID))
              throw new Error(
                `The recipe of “${action.name}” no longer exists. Choose another in Settings → Actions.`,
              );
            requestAction(executor.recipeID, context);
          } else if (executor.kind === 'terminal')
            workspace.newTerminal(target(context), executor.profileID);
          else await window.viewer.customExecute(action.id, captureTarget(context, workspace));
        },
      })),
  ];
}
