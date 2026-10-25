import type { CommandContext, CommandDefinition } from '../commands/registry';
import type { WorkspaceController } from '../workspace/context';
import { captureTarget } from '../commands/target';

export function localServerCommands(
  workspace: Pick<WorkspaceController, 'newServer' | 'rootID'>,
  showServers?: () => void,
): CommandDefinition[] {
  const available = (context: CommandContext) => {
    if (!context.paneID || !['window', 'folder', 'files'].includes(context.scope)) return false;
    if (!context.selection.length) return !!context.folder;
    const [entry] = context.selection;
    return context.selection.length === 1 && entry?.kind === 'directory' && !entry.error;
  };
  return [
    {
      id: 'start-local-server',
      label: 'Start local server',
      group: 'Folder',
      icon: 'code',
      aliases: ['serve', 'http', 'website', 'web server', 'localhost'],
      when: available,
      run: async (context) => {
        if (!available(context)) throw new Error('Choose one folder to serve.');
        const target = captureTarget(context, workspace);
        const [selected] = target.selection;
        if (selected) target.directory = selected.path;
        await workspace.newServer(target);
      },
    },
    {
      id: 'local-servers',
      label: 'Local servers…',
      group: 'Workspace',
      icon: 'code',
      aliases: ['running servers', 'localhost', 'server controls'],
      when: () => !!showServers,
      run: () => showServers?.(),
    },
  ];
}
