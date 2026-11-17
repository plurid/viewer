import { plural } from '../../../domain/plural';
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
  const found =
    (space.definition?.source ??
      state.bootstrap.definitions?.definitions.find(
        (definition) => definition.key === space.definition?.key,
      )?.source) === 'found';
  const commands: CommandDefinition[] = [
    {
      id: 'manage-workspaces',
      label: 'Manage Workspaces…',
      group: 'Workspaces',
      icon: 'grid',
      aliases: ['all workspaces', 'browse workspaces'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('manage'),
    },
    {
      id: 'change-workspace',
      label: 'Change Workspace…',
      group: 'Workspaces',
      icon: 'dock',
      aliases: ['cw', 'switch workspace', 'workspaces'],
      primary: true,
      when: workspaceScope,
      run: () => actions.palette('workspaces'),
    },
    {
      id: 'new-workspace',
      label: 'New Workspace…',
      group: 'Workspaces',
      icon: 'plus',
      aliases: ['nw'],
      when: (context) =>
        workspaceScope(context) && state.saved.workspaces.length < maximumWorkspaces,
      run: () => actions.workspaceDialog('new'),
    },
    {
      id: 'rename-workspace',
      label: 'Rename Workspace…',
      group: 'Workspaces',
      icon: 'rename',
      aliases: ['rw'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('rename'),
    },
    {
      id: 'workspace-background',
      label: 'Workspace Look…',
      group: 'Workspaces',
      icon: 'sun',
      // eslint-disable-next-line no-restricted-syntax -- British spelling finds it too
      aliases: ['background', 'colour', 'color', 'space colour', 'look', 'override', 'wb'],
      when: workspaceScope,
      run: () => actions.workspaceDialog('background'),
    },
    {
      id: 'delete-workspace',
      label: 'Delete Workspace…',
      group: 'Workspaces',
      icon: 'trash',
      aliases: ['dw'],
      detail: plural(space.panes.length, 'open plane'),
      when: (context) => workspaceScope(context) && !linked,
      unavailable: linked
        ? 'This workspace comes from a definition. Close it instead, or remove the definition with Edit Workspace Definitions.'
        : undefined,
      run: () => actions.workspaceDialog('delete'),
    },
    {
      id: 'restore-workspace',
      label: 'Undo Workspace Deletion',
      group: 'Workspaces',
      icon: 'refresh',
      primary: true,
      when: (context) => workspaceScope(context) && !!state.deletedWorkspace,
      run: actions.restoreWorkspace,
    },
  ];
  for (const [id, label, kind] of [
    ['close-workspace', 'Close Workspace', 'close'],
    ['reset-workspace', 'Reset to Definition…', 'reset'],
    ['save-workspace-definition', 'Save to Definition', 'save'],
    ['save-workspace-as-definition', 'Save as Definition…', 'save-as'],
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
          : linked && (kind !== 'save' || !found)),
      unavailable:
        kind === 'save' && found
          ? 'Found workspaces have no written definition.'
          : kind === 'save-as' && !canCaptureDefinition(space)
            ? 'Open a folder, file, terminal, scratch or search plane first.'
            : undefined,
      run: () => actions.workspaceDialog(kind),
    });
  return commands;
}
