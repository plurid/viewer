import { planeAlignments, planeSizePresets } from '../../../domain/workspaces/plane-layout';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** Size and position existing planes; every entry acts on its captured plane. */
export function planeLayoutCommands({ actions, paneScope }: WindowScopes): CommandDefinition[] {
  const target = (context: Parameters<typeof paneScope>[0]) => ({
    workspaceID: context.workspaceID,
    paneID: context.paneID!,
  });
  const commands: CommandDefinition[] = [
    ...(['move', 'resize'] as const).map((mode) => ({
      id: `plane-${mode}`,
      label: mode === 'move' ? 'Move plane' : 'Resize plane',
      group: 'Layout',
      icon: mode === 'move' ? ('move' as const) : ('resize' as const),
      aliases:
        mode === 'move' ? ['drag plane', 'move manually'] : ['resize manually', 'size plane'],
      when: paneScope,
      run: (context: Parameters<typeof paneScope>[0]) =>
        actions.workspace.editPlane(target(context), mode),
    })),
    {
      id: 'plane-fill',
      label: 'Fill workspace',
      group: 'Layout',
      icon: 'frame',
      aliases: ['maximize plane', 'full size', 'full width and height'],
      when: paneScope,
      run: (context) =>
        actions.workspace.layoutPlane(target(context), { width: [1, 1], height: [1, 1] }),
    },
  ];
  for (const axis of ['width', 'height'] as const)
    for (const preset of planeSizePresets)
      commands.push({
        id: `plane-${axis}-${preset.id}`,
        label: `${preset.label} ${axis}`,
        group: 'Layout',
        icon: axis === 'width' ? 'side-by-side' : 'stacked',
        aliases: [
          `${preset.fraction[0]}/${preset.fraction[1]} ${axis}`,
          `plane ${axis} ${preset.label}`,
        ],
        when: paneScope,
        run: (context) =>
          actions.workspace.layoutPlane(target(context), { [axis]: preset.fraction }),
      });
  for (const alignment of planeAlignments)
    commands.push({
      id: `plane-align-${alignment.id}`,
      label: alignment.label,
      group: 'Layout',
      icon: alignment.icon,
      aliases: [`position plane ${alignment.id}`, `tile ${alignment.id}`],
      when: paneScope,
      run: (context) =>
        actions.workspace.layoutPlane(target(context), { [alignment.axis]: alignment.position }),
    });
  return commands.map((command) => ({
    ...command,
    aliases: [...(command.aliases ?? []), 'size & position', 'layout'],
  }));
}
