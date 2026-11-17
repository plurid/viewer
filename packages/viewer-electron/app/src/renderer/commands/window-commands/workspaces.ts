import { definitionWasRemoved, maximumWorkspaces } from '../../../domain/workspaces/catalog';
import { canCaptureDefinition } from '../../../domain/workspaces/definitions/capture';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** Workspace management. */
export function workspacesCommands({
  actions,
  state,
  space,
  workspaceScope,
}: WindowScopes): CommandDefinition[] {
  const linked = !!space.definition && !definitionWasRemoved(space, state.bootstrap.definitions);
  const commands: CommandDefinition[] = [
    {
      id: 'manage-workspaces',
      label: 'Manage workspaces…',
      group: 'Workspaces',
      icon: 'grid',
      aliases: ['all workspaces', 'browse workspaces'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('manage'),
    },
    {
      id: 'change-workspace',
      label: 'Change workspace…',
      group: 'Workspaces',
      icon: 'dock',
      aliases: ['cw', 'switch workspace', 'workspaces'],
      primary: true,
      when: workspaceScope,
      run: () => actions.palette('workspaces'),
    },
    {
      id: 'new-workspace',
      label: 'New workspace…',
      group: 'Workspaces',
      icon: 'plus',
      aliases: ['nw'],
      when: (context) =>
        workspaceScope(context) && state.saved.workspaces.length < maximumWorkspaces,
      run: () => actions.workspaceDialog('new'),
    },
    {
      id: 'rename-workspace',
      label: 'Rename workspace…',
      group: 'Workspaces',
      icon: 'rename',
      aliases: ['rw'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('rename'),
    },
    {
      id: 'workspace-background',
      label: 'Workspace look…',
      group: 'Workspaces',
      icon: 'sun',
      aliases: ['background', 'colour', 'color', 'space colour', 'look', 'override', 'wb'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('background'),
    },
    {
      id: 'delete-workspace',
      label: 'Delete workspace…',
      group: 'Workspaces',
      icon: 'trash',
      aliases: ['dw'],
      detail: `${space.panes.length} open ${space.panes.length === 1 ? 'plane' : 'planes'} · layout only`,
      when: (context) => workspaceScope(context) && !linked,
      unavailable: linked
        ? 'Close it: its definition stays in workspaces.jsonc.'
        : undefined,
      run: () => actions.workspaceDialog('delete'),
    },
    {
      id: 'restore-workspace',
      label: 'Undo workspace deletion',
      group: 'Workspaces',
      icon: 'refresh',
      primary: true,
      when: (context) => workspaceScope(context) && !!state.deletedWorkspace,
      run: actions.restoreWorkspace,
    },
  ];
  for (const [id, label, kind] of [
    ['close-workspace', 'Close workspace', 'close'],
    ['reset-workspace', 'Reset to definition…', 'reset'],
    ['save-workspace-definition', 'Save to definition', 'save'],
    ['save-workspace-as-definition', 'Save as definition…', 'save-as'],
  ] as const)
    commands.push({
      id,
      label,
      group: 'Workspaces',
      icon: kind === 'close' ? 'close' : 'dock',
      aliases: kind === 'save' ? ['sync'] : undefined,
      humanOnly: true,
      when: (context) =>
        workspaceScope(context) &&
        (kind === 'save-as'
          ? !linked && canCaptureDefinition(space)
          : linked),
      unavailable:
        kind === 'save-as' && !canCaptureDefinition(space)
          ? 'Open a folder, file, terminal, scratch or search plane first.'
          : undefined,
      run: () => actions.workspaceDialog(kind),
    });
  return commands;
}
