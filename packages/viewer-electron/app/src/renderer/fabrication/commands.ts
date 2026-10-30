import type { CommandContext, CommandDefinition } from '../commands/registry';
import { inventoryLimit } from '../../domain/fabrication/answer';
import { fileName } from '../../domain/tours/tour';
import { openCheck } from './check';

/** What a check reads: a selected job folder, the selected files when one is a DXF, or the folder
 * shown when nothing is selected. */
function checked(context: CommandContext): string[] {
  const [first] = context.selection;
  if (context.selection.length === 1 && first?.directory) return [first.path];
  const files = context.selection.filter((entry) => !entry.directory);
  if (files.length)
    return files.length <= inventoryLimit && files.some((entry) => /\.dxf$/i.test(entry.name))
      ? files.map((entry) => entry.path)
      : [];
  return context.directory ? [context.directory] : [];
}

export function checkCommands(): CommandDefinition[] {
  return [
    {
      id: 'check-laser-job',
      label: 'Check laser job…',
      group: 'Files',
      icon: 'drawing',
      aliases: [
        'laser',
        'fabrication',
        'check job',
        'check drawing',
        'dxf',
        'cut',
        'hole pitch',
        'muse spark',
      ],
      detail: (context) => {
        const paths = checked(context);
        return paths.length === 1
          ? `Compare the request, drawings and photos in ${fileName(paths[0]!)} with its DXF parts`
          : `Compare ${paths.length} files: the request and drawings with the DXF parts`;
      },
      when: (context) => checked(context).length > 0,
      run: (context) => openCheck(checked(context), context.workspaceID, context.paneID),
    },
  ];
}
