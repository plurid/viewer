import type { CommandDefinition } from '../commands/registry';
import type { WindowScopes } from '../commands/window-commands/scope';

export function overviewCommands({ actions, windowScope }: WindowScopes): CommandDefinition[] {
  return [
    {
      id: 'open-overview',
      label: 'File overview',
      group: 'Files',
      icon: 'data',
      aliases: ['dashboard', 'insights', 'tidy', 'clean up', 'what needs attention', 'space'],
      when: (context) => actions.ready && windowScope(context),
      run: () => actions.workspace.openOverview(),
    },
  ];
}
