import type { CommandDefinition } from '../commands/registry';
import type { WindowScopes } from '../commands/window-commands/scope';

export function journalCommands({
  actions,
  space,
  windowScope,
  workspaceScope,
  paneScope,
}: WindowScopes): CommandDefinition[] {
  return [
    {
      id: 'open-journal',
      label: 'Open Journal',
      group: 'App',
      icon: 'clock',
      aliases: ['events', 'logs', 'activity', 'audit'],
      when: (context) => actions.ready && windowScope(context),
      run: () => actions.workspace.openJournal({}),
    },
    {
      id: 'journal-workspace',
      label: 'Journal for workspace',
      group: 'Workspace',
      icon: 'clock',
      aliases: ['workspace events', 'workspace logs'],
      when: (context) => actions.ready && workspaceScope(context),
      run: () => actions.workspace.openJournal({ workspaceID: space.id }),
    },
    {
      id: 'journal-plane',
      label: 'Journal for plane',
      group: 'Plane',
      icon: 'clock',
      aliases: ['plane events', 'plane logs'],
      when: paneScope,
      run: (context) =>
        actions.workspace.openJournal({ workspaceID: space.id, planeID: context.paneID }),
    },
  ];
}
