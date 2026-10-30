import type { CommandContext, CommandDefinition } from '../commands/registry';
import type { WorkspaceController } from '../workspace/context';
import { layoutFileKind } from '../../domain/layout/sources';
import type { LayoutFileKind } from '../../domain/layout/sources';
import { layoutLimits } from '../../domain/layout/plan';

/** The selected files the Layout plane uses, in selection order. */
const laidOut = (context: CommandContext, kinds: readonly LayoutFileKind[]) =>
  context.selection.filter((entry) => {
    const kind = layoutFileKind(entry);
    return kind !== undefined && kinds.includes(kind);
  });
const within = (context: CommandContext) =>
  context.selection.length > 0 && context.selection.length <= layoutLimits.sources;

export function layoutCommands(workspace: WorkspaceController): CommandDefinition[] {
  return [
    {
      id: 'lay-out',
      label: 'Lay out…',
      group: 'Files',
      icon: 'grid',
      aliases: [
        'layout',
        'collage',
        'contact sheet',
        'n-up',
        '2 up',
        'booklet',
        'imposition',
        'step and repeat',
        'business cards',
        'passport photos',
        'labels',
        'poster',
        'tile',
        'print photos',
      ],
      when: (context) => within(context) && laidOut(context, ['image', 'pdf']).length > 0,
      run: (context) =>
        workspace.openLayout(
          laidOut(context, ['image', 'pdf', 'drawing']).map((entry) => entry.path),
          context.paneID,
        ),
    },
    {
      id: 'nest-parts',
      label: 'Nest for cutting…',
      group: 'Files',
      icon: 'drawing',
      aliases: ['nesting', 'nest', 'dxf', 'laser', 'cnc', 'cut parts', 'stock sheet'],
      when: (context) => within(context) && laidOut(context, ['drawing']).length > 0,
      run: (context) =>
        workspace.openLayout(
          laidOut(context, ['drawing']).map((entry) => entry.path),
          context.paneID,
          'nesting',
        ),
    },
  ];
}
