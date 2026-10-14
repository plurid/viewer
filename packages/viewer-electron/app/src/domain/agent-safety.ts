import type { CustomAction } from './automation';

export const agentRemovalPolicy = Object.freeze({
  requiresUserApproval: true,
  method: 'trash',
  permanentDeletion: false,
});

const terminalCommands = new Set(['open-terminal', 'open-tmux', 'open-terminal-plane']);
const externalCommands = new Set(['open-default', 'open-with', 'open-selection']);

/** Resolve aliases before review; opaque code cannot promise recoverable file removal. */
export function agentCommandID(id: string, actions: readonly CustomAction[]): string {
  let command = id;
  if (id.startsWith('custom.')) {
    const action = actions.find((item) => 'custom.' + item.id === id);
    if (!action) throw new Error('The custom action is unavailable.');
    const executor = action.executor;
    if (['shell', 'executable', 'terminal'].includes(executor.kind))
      throw new Error(
        'Agents cannot run shell scripts, executables or terminal profiles: these can bypass Trash. Use a reviewed built-in action.',
      );
    if (executor.kind === 'builtin') {
      if (executor.command.startsWith('custom.'))
        throw new Error('Custom actions cannot call another custom action.');
      command = executor.command;
    }
  }
  if (terminalCommands.has(command))
    throw new Error('Agent terminal execution is unavailable because it can bypass Trash.');
  if (externalCommands.has(command))
    throw new Error(
      'Agents cannot launch external applications that can bypass Trash. Open a Viewer preview instead.',
    );
  if (command === 'undo-file')
    throw new Error(
      'Agent file Undo can remove outputs outside the captured selection. Review it yourself in Recent file operations.',
    );
  return command;
}
