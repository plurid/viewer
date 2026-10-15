import { listColumns } from '../../domain/list-columns';
import { normalizePreferences } from '../../domain/preferences';
import {
  changePreferences,
  folderPresentation,
  updateFolderPresentation,
  applyFolderAsDefaults,
  getState,
} from '../state/store';
import type { CommandContext, CommandDefinition } from './registry';
export const columnCommandIDs = [
  ...listColumns.filter((column) => column.id !== 'name').map((column) => 'column.' + column.id),
  'wrap-file-names',
  'reset-list-columns',
  'reset-folder-view',
  'folder-view-defaults',
  'group.none',
  'group.kind',
  'group.modified',
];
export function columnCommands(): CommandDefinition[] {
  const list = (context: CommandContext) =>
    context.folder ? folderPresentation(context.folder.path).list : getState().saved.ui.list;
  const save = (context: CommandContext, value: ReturnType<typeof list>) =>
    context.folder
      ? updateFolderPresentation(context.folder.path, { list: value })
      : changePreferences((ui) => ({ ...ui, list: value }));
  const available = (context: CommandContext) =>
    !!context.paneID &&
    ['window', 'folder', 'files'].includes(context.scope) &&
    (!context.folder || context.folder.mode === 'list');
  return [
    {
      id: 'reset-folder-view',
      label: 'Reset this folder’s view',
      group: 'View',
      icon: 'refresh',
      when: (context) => !!context.folder,
      run: (context) => updateFolderPresentation(context.folder!.path, null),
    },
    {
      id: 'folder-view-defaults',
      label: 'Use as default folder view',
      group: 'View',
      icon: 'settings',
      aliases: ['defaults', 'other folders'],
      when: (context) => !!context.folder,
      run: (context) => applyFolderAsDefaults(context.folder!.path),
    },
    ...(['none', 'kind', 'modified'] as const).map((group): CommandDefinition => ({
      id: 'group.' + group,
      label:
        group === 'none'
          ? 'Ungroup files'
          : 'Group by ' + (group === 'kind' ? 'kind' : 'date modified'),
      group: 'View',
      icon: group === 'modified' ? 'clock' : group === 'kind' ? 'data' : 'list',
      when: (context) => !!context.folder,
      run: (context) => updateFolderPresentation(context.folder!.path, { group }),
    })),
    ...listColumns
      .filter((column) => column.id !== 'name')
      .map((column): CommandDefinition => {
        const id = column.id as Exclude<typeof column.id, 'name'>;
        return {
          id: 'column.' + id,
          label: (context) =>
            `${list(context).visible[id] ? 'Hide' : 'Show'} ${column.label.toLowerCase()} column`,
          group: 'View',
          icon: id === 'modified' || id === 'created' ? 'clock' : id === 'size' ? 'info' : 'file',
          aliases: ['columns', column.label],
          when: available,
          run: (context) =>
            save(context, {
              ...list(context),
              visible: { ...list(context).visible, [id]: !list(context).visible[id] },
            }),
        };
      }),
    {
      id: 'wrap-file-names',
      label: (context) =>
        list(context).wrapNames ? 'Keep filenames on one line' : 'Wrap long filenames',
      group: 'View',
      icon: 'rename',
      aliases: ['long names', 'wrap'],
      when: available,
      run: (context) => save(context, { ...list(context), wrapNames: !list(context).wrapNames }),
    },
    {
      id: 'reset-list-columns',
      label: 'Reset list columns',
      group: 'View',
      icon: 'refresh',
      when: available,
      run: (context) => save(context, normalizePreferences().list),
    },
  ];
}
