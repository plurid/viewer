import { builtInProfileIDs } from '../preferences/profiles';
import type { CustomAction } from '../automation/actions';
import { forbiddenTrashCommands } from '../files/trash';
import { settingCatalog, workspaceMayChange } from '../preferences/catalog';

export const agentRemovalPolicy = Object.freeze({
  requiresUserApproval: true,
  method: 'trash',
  permanentDeletion: false,
});

const terminalCommands = new Set([
  'open-terminal',
  'open-tmux',
  'open-terminal-plane',
  'new-terminal-plane',
]);
/** Built-in commands an agent may propose. Each acts only on the captured folder and
 * selection, opens a dialog the person completes, or changes the view. Everything
 * else is refused, including commands added later and clipboard-driven paste/move. */
const agentCommands = new Set([
  'trash',
  'duplicate',
  'compress',
  'extract',
  // Quick actions only create new files.
  'rotate-copy-left',
  'rotate-copy-right',
  'convert-jpeg',
  'convert-png',
  'images-to-pdf',
  'make-alias',
  'rename',
  'new-folder',
  'new-file',
  'new-folder-with-selection',
  'copy-to',
  'move-to',
  'copy-path',
  'path',
  'add-to-basket',
  'calculate-size',
  'info',
  'tags',
  'inspect-file',
  'related-files',
  'quick-preview',
  'native-quick-look',
  'select-all',
  'invert-selection',
  'refresh',
  'hidden',
  'search',
  'find-file',
  'go-to',
  'back',
  'forward',
  'parent',
  'linked',
  'another-plane',
  'frame-plane',
  'frame-all',
  'dock',
  'arrange-horizontal',
  'arrange-vertical',
  'plane-notes',
  'plane-sidebar',
  'toggle-sidebar',
  'focus-mode',
  'profile-restore',
  'wrap-file-names',
  'reset-list-columns',
  'reset-folder-view',
]);
const agentCommandPrefixes = ['view-', 'column.', 'group.', 'sort.', 'recipe.'];
const externalCommands = new Set(['open-default', 'open-with', 'open-selection']);

/**
 * What a model may not put in a line it proposes for a person to run (2026-10-24): what agents may
 * never do (terminals, external apps, emptying Trash, file Undo, paste from outside the view, a
 * custom action that runs programs), and the Trash itself, which agents reach only with each path
 * reviewed. The person reads the line before Enter runs it; the rest is theirs to accept.
 */
export function modelLineCommandProblem(
  id: string,
  actions: readonly CustomAction[],
): string | undefined {
  if (id.startsWith('custom.')) {
    const action = actions.find((item) => 'custom.' + item.id === id);
    if (action && ['shell', 'executable', 'terminal'].includes(action.executor.kind))
      return 'it runs a program';
    return undefined;
  }
  if (terminalCommands.has(id)) return 'it uses a terminal';
  if (externalCommands.has(id)) return 'it opens another application';
  if (forbiddenTrashCommands.has(id) || id === 'trash') return 'it moves files to the Trash';
  if (id === 'undo-file') return 'it undoes file operations';
  if (id === 'paste' || id === 'paste-move') return 'it pastes from the clipboard';
  if (['rename', 'save-file', 'save-file-as', 'save-all', 'move-to-pair'].includes(id))
    return 'it changes files';
  return undefined;
}
const agentSequenceNestingLimit = 10;
const agentCommandExpansionLimit = 1000;

/** Resolve aliases before review. A sequence cannot carry a separate step's removal approval. */
export function agentCommandID(id: string, actions: readonly CustomAction[]): string {
  if (!id.startsWith('custom.')) return agentBuiltinCommandID(id);
  const byID = new Map(actions.map((action) => ['custom.' + action.id, action]));
  const visiting = new Set<string>();
  let expanded = 0;
  const resolve = (command: string, depth: number): string => {
    if (visiting.has(command))
      throw new Error('Agent command sequences contain a recursive cycle.');
    if (depth > agentSequenceNestingLimit)
      throw new Error(
        `Agent command sequences are nested more than ${agentSequenceNestingLimit} levels deep.`,
      );
    if (++expanded > agentCommandExpansionLimit)
      throw new Error(
        `The expanded agent action exceeds ${agentCommandExpansionLimit} commands. Request a smaller sequence.`,
      );
    if (!command.startsWith('custom.')) return agentBuiltinCommandID(command);
    const action = byID.get(command);
    if (!action) throw new Error('The custom action is unavailable.');
    const executor = action.executor;
    switch (executor.kind) {
      case 'shell':
      case 'executable':
      case 'terminal':
        throw new Error(
          'Agents cannot run shell scripts, executables or terminal profiles: these can bypass Trash. Use a reviewed built-in action.',
        );
      case 'sequence':
        visiting.add(command);
        try {
          for (const step of executor.commands) {
            if (resolve(step, depth + 1) === 'trash')
              throw new Error(
                'Agent sequences cannot include Trash. Request a separate exact-path Trash proposal.',
              );
          }
        } finally {
          visiting.delete(command);
        }
        return command;
      case 'builtin':
        if (executor.command.startsWith('custom.'))
          throw new Error('Custom actions cannot call another custom action.');
        return agentBuiltinCommandID(executor.command);
      // A recipe action only prepares a reviewed proposal.
      case 'recipe':
        return command;
    }
  };
  return resolve(id, 0);
}

function agentBuiltinCommandID(command: string): string {
  if (terminalCommands.has(command))
    throw new Error('Agent terminal execution is unavailable because it can bypass Trash.');
  if (forbiddenTrashCommands.has(command))
    throw new Error('Emptying Trash is available only through the native user interface.');
  if (externalCommands.has(command))
    throw new Error(
      'Agents cannot launch external applications that can bypass Trash. Open a Viewer preview instead.',
    );
  if (command === 'undo-file')
    throw new Error(
      'Agent file Undo can remove outputs outside the captured selection. Review it yourself in Recent file operations.',
    );
  if (command === 'parent-plane' || command === 'view-open-plane')
    throw new Error('Use propose_focus_plane for an explicitly authorized destination plane.');
  // a built-in profile changes only the view; a person's own may hold any presentation setting
  if (command.startsWith('profile.')) {
    if (!builtInProfileIDs.has(command.slice('profile.'.length)))
      throw new Error('Agents may propose only the built-in profiles: Focus, Present and Full.');
    return command;
  }
  if (command.startsWith('setting.')) {
    agentSettingCommand(command);
    return command;
  }
  if (command === 'paste' || command === 'paste-move')
    throw new Error(
      'Paste acts on clipboard items outside the captured selection. Use Copy To or Move To instead.',
    );
  if (
    !agentCommands.has(command) &&
    !agentCommandPrefixes.some((prefix) => command.startsWith(prefix))
  )
    throw new Error(`Agents cannot propose “${command}”. Ask the person to run it themselves.`);
  return command;
}

/** Settings an agent may propose. Execution, removal confirmation, shortcuts, agent
 * scope, providers, file-opening rules and search roots stay with the person, and so
 * does replacing a whole section. Every allowed path is at least as deep as listed. */
const agentConfigurable: readonly (readonly string[])[] = [
  ['settings', 'appearance'],
  ['settings', 'browsing', 'mode'],
  ['settings', 'browsing', 'sort'],
  ['settings', 'browsing', 'descending'],
  ['settings', 'browsing', 'group'],
  ['settings', 'browsing', 'columnWidth'],
  ['settings', 'browsing', 'density'],
  ['settings', 'browsing', 'foldersFirst'],
  ['settings', 'browsing', 'showHidden'],
  ['settings', 'browsing', 'newPlaneLocation'],
  ['settings', 'browsing', 'newPlanePath'],
  ['settings', 'browsing', 'emptyWorkspaceLocation'],
  ['settings', 'browsing', 'emptyWorkspacePath'],
  ['settings', 'folders'],
  ['settings', 'previews'],
  ['settings', 'recipes'],
  ['settings', 'savedSearches'],
  ['ui'],
];
/**
 * Why the workspace must not run an agent's command as it arrives, if it must not (2026-10-20).
 * Main stops waiting after 25 seconds, and a window that ran it later (a hidden window draws no
 * frames) did so after the agent was told it failed. A custom action runs as it was reviewed: the
 * workspace ran its current definition, so a recipe action changed into a shell script since ran.
 */
export function agentDispatchRefusal(
  event: { command: string; deadline: number; executor?: CustomAction['executor'] },
  actions: readonly CustomAction[],
  now = Date.now(),
): string | undefined {
  if (now > event.deadline)
    return 'The request expired before the workspace could run it. Request it again.';
  if (!event.command.startsWith('custom.')) return undefined;
  const action = actions.find((item) => 'custom.' + item.id === event.command);
  if (
    !action ||
    !event.executor ||
    JSON.stringify(action.executor) !== JSON.stringify(event.executor)
  )
    return 'The action changed after it was reviewed. Ask the agent for a new proposal.';
  return undefined;
}
/**
 * A setting's command an agent may propose (2026-10-23): an on/off setting or a choice the agent
 * could also propose as configuration, and that the workspace changes itself. A number or colour
 * opens Settings, for the person; anything else is the person's, as configuration is.
 */
function agentSettingCommand(command: string): void {
  const [named = '', value] = command.slice('setting.'.length).split('=');
  // a workspace's own is as the general setting is, for an agent
  const path = named.replace(/@workspace$/, '');
  const definition = settingCatalog.find((item) => item.path === path);
  if (!definition) throw new Error(`There is no setting “${path}”.`);
  if (!['boolean', 'choice'].includes(definition.kind) || value === 'custom')
    throw new Error(`“${definition.label}” is changed in Settings. Ask the person to change it.`);
  agentConfigurationPath(path.split('.'));
  if (!workspaceMayChange(path.split('.')))
    throw new Error(`“${definition.label}” is changed in Settings. Ask the person to change it.`);
}
export function agentConfigurationPath(keys: readonly string[]): void {
  if (
    !agentConfigurable.some(
      (allowed) =>
        keys.length >= allowed.length && allowed.every((key, index) => keys[index] === key),
    )
  )
    throw new Error(
      `Agents cannot change ${keys.join('.')}. Execution, Trash confirmation, shortcuts, agent access, providers, file opening and search scope change only in Settings.`,
    );
}
