import { effectiveWindowSettings } from '../state/effective-ui';
import { plainCommandID } from '../../domain/command-line/verbs';
import { withArguments } from '../../domain/command-line/lex';
import type { CommandContext, CommandDefinition } from './registry';
import { actionAvailable, terminalDirectory } from '../../domain/automation/actions';
import { activeWorkspace, getState } from '../state/store';
import { newPlaneFolder } from '../../domain/services';
import type { WorkspaceController } from '../workspace/context';
import { requestAction } from '../actions/commands';
import type { IconName } from '../ui/Icon';
import { captureTarget } from './target';
import { localServerCommands } from '../local-servers/commands';
export { captureTarget } from './target';
export function programCommands(
  workspace: WorkspaceController,
  /** `false` when no command of that ID is available here. */
  invoke: (id: string, context: CommandContext) => Promise<boolean | void>,
  terminalName?: string,
  /** The context as it is now: a sequence's later steps act where the earlier ones left it. */
  live?: () => CommandContext,
  /** A step with words (`vs ~/Documents`, 2026-10-23), run by the command line. */
  line?: (text: string) => Promise<{ ok: boolean; message?: string }>,
): CommandDefinition[] {
  const folder = (context: CommandContext) => !!context.directory || !!context.folder;
  const target = (context: CommandContext) => {
    const captured = captureTarget(context, workspace);
    return { ...captured, directory: terminalDirectory(captured.directory, captured.selection) };
  };
  return [
    ...localServerCommands(workspace),
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
      id: 'new-terminal-plane',
      label: 'New terminal plane',
      group: 'Terminal',
      icon: 'terminal',
      aliases: ['nt', 'root terminal', 'new terminal', 'terminal', 'shell'],
      // a root plane of its own, from anywhere (2026-10-23): Open terminal plane links one to a folder
      when: () => true,
      run: (context) => {
        const space = activeWorkspace();
        const owner = space.panes.find(
          (pane) => pane.id === (context.paneID || getState().activePane),
        );
        const current =
          context.directory ||
          context.folder?.path ||
          (owner?.type === 'folder' || owner?.type === 'terminal' ? owner.path : undefined);
        workspace.newTerminal({
          workspaceID: context.workspaceID || space.id,
          rootID: '',
          paneID: '',
          // where new planes start: Settings → Browsing
          directory: newPlaneFolder(
            effectiveWindowSettings(getState()).browsing,
            getState().bootstrap.home,
            current,
            space.panes.length === 0,
          ),
          selection: [],
        });
      },
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
        // a sequence runs anywhere a command can; the others act on a folder's selection
        when: (context) =>
          action.executor.kind === 'sequence' && !folder(context)
            ? true
            : folder(context) && actionAvailable(action, captureTarget(context, workspace)),
        run: async (context) => {
          const executor = action.executor;
          if (executor.kind === 'sequence') {
            for (const [index, command] of executor.commands.entries()) {
              if (command.startsWith('custom.'))
                throw new Error('Custom actions cannot call another custom action.');
              if (!plainCommandID(command)) {
                // run from a menu or a key, a named sequence has no words: $1… are empty
                const text = withArguments(command, [], executor.command ?? action.name);
                const result = line ? await line(text) : { ok: false };
                if (!result.ok)
                  throw new Error(
                    `“${action.name}” stopped at “${command}”${result.message ? `: ${result.message}` : '.'}`,
                  );
                continue;
              }
              const step = index ? (live?.() ?? context) : context;
              if ((await invoke(command, step)) === false)
                throw new Error(
                  `“${action.name}” stopped at “${command}”, which is not a command available here.`,
                );
            }
            return;
          }
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
