import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** Framing, docking, closing and arranging planes in space. */
export function arrangementCommands({
  actions,
  space,
  windowScope,
  paneScope,
}: WindowScopes): CommandDefinition[] {
  const commands: CommandDefinition[] = [
    {
      id: 'frame-all',
      label: 'Frame all planes',
      group: 'Space',
      icon: 'frame',
      aliases: ['fa', 'fit'],
      shortcut: '⌘0',
      primary: true,
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 0,
      run: actions.workspace.frameAll,
    },
    {
      id: 'consolidate-previews',
      label: 'Consolidate repeated previews',
      group: 'Space',
      icon: 'copy',
      aliases: ['duplicates', 'repeated', 'clean previews'],
      detail: 'Close redundant views · layout only · Undo arrangement restores them',
      when: (context) =>
        windowScope(context) && actions.ready && actions.workspace.hasRepeatedPreviews(),
      run: actions.workspace.consolidatePreviews,
    },
    {
      id: 'frame-plane',
      label: 'Frame plane',
      group: 'Plane',
      icon: 'frame',
      aliases: ['fp'],
      when: paneScope,
      run: (context) => actions.workspace.focusPane(context.paneID!),
    },
    {
      id: 'parent-plane',
      label: 'Back to parent plane',
      group: 'Plane',
      icon: 'parent-plane',
      aliases: ['parent plane', 'back to parent'],
      shortcut: '⌥⌘↑',
      when: (context) => paneScope(context) && !!actions.workspace.parentPaneID(context.paneID!),
      run: (context) => {
        const parent = actions.workspace.parentPaneID(context.paneID!);
        if (parent) actions.workspace.focusPane(parent);
      },
    },
    {
      id: 'view-open-plane',
      label: 'View open plane',
      group: 'Files',
      icon: 'link',
      primary: true,
      aliases: ['view linked plane', 'show existing plane', 'vl'],
      when: (context) =>
        !!context.paneID &&
        context.selection.length === 1 &&
        !!context.selection[0] &&
        !!actions.workspace.existingPaneID(context.paneID, context.selection[0]),
      run: (context) => {
        const [entry] = context.selection;
        if (!entry) return;
        const id = actions.workspace.existingPaneID(context.paneID!, entry);
        if (!id) throw new Error('This plane is no longer open.');
        actions.workspace.focusPane(id);
      },
    },
    {
      id: 'dock',
      label: actions.workspace.isDocked() ? 'Reveal space' : 'Dock plane',
      group: 'Plane',
      icon: 'dock',
      aliases: ['dk'],
      shortcut: '⌘↵',
      when: paneScope,
      run: (context) => actions.workspace.dock(context.paneID),
    },
    {
      id: 'close-plane',
      label: 'Close plane',
      group: 'Plane',
      icon: 'close',
      aliases: ['cl'],
      shortcut: '⌥⌘W',
      when: paneScope,
      run: (context) => actions.workspace.closePane(context.paneID!),
    },
    {
      id: 'undo-arrangement',
      label: 'Undo arrangement',
      group: 'Space',
      icon: 'left',
      aliases: ['ua'],
      shortcut: '⌥⌘Z',
      when: (context) => windowScope(context) && actions.workspace.arrangementHistory().canUndo,
      run: actions.workspace.undo,
    },
    {
      id: 'redo-arrangement',
      label: 'Redo arrangement',
      group: 'Space',
      icon: 'right',
      aliases: ['ra'],
      shortcut: '⇧⌥⌘Z',
      when: (context) => windowScope(context) && actions.workspace.arrangementHistory().canRedo,
      run: actions.workspace.redo,
    },
    {
      id: 'arrange-horizontal',
      label: 'Arrange planes horizontally',
      group: 'Space',
      icon: 'columns',
      aliases: ['ah'],
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 1,
      run: () => actions.workspace.arrange('x'),
    },
    {
      id: 'arrange-vertical',
      label: 'Arrange planes vertically',
      group: 'Space',
      icon: 'list',
      aliases: ['av'],
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 1,
      run: () => actions.workspace.arrange('y'),
    },
  ];
  for (const [id, label, axis, icon, splitAlias] of [
    ['view-side-by-side', 'View side by side', 'x', 'side-by-side', 'vertical split'],
    ['view-stacked', 'View stacked', 'y', 'stacked', 'horizontal split'],
  ] as const)
    commands.push({
      id,
      label,
      group: 'View',
      icon,
      aliases: [splitAlias, `view ${splitAlias}`, 'dual pane', 'norton commander'],
      when: (context) => paneScope(context) && !!context.folder && space.panes.length < 200,
      run: (context) => {
        if (!context.paneID || !context.folder) return;
        actions.workspace.splitFolder(
          {
            workspaceID: context.workspaceID,
            paneID: context.paneID,
            path: context.folder.path,
          },
          axis,
        );
      },
    });
  for (const tool of ['rotate', 'scale', 'translate'] as const)
    commands.push({
      id: `space-${tool}`,
      label: `${tool.charAt(0).toUpperCase() + tool.slice(1)} space`,
      group: 'Space',
      icon: tool === 'rotate' ? 'refresh' : tool === 'scale' ? 'frame' : 'move',
      when: (context) => windowScope(context) && actions.ready && space.panes.length > 0,
      run: () => actions.spatialTool(tool),
    });
  commands.push({
    id: 'space-done',
    label: 'Finish spatial tool',
    group: 'Space',
    icon: 'check',
    primary: true,
    when: (context) => windowScope(context) && actions.tool !== null,
    run: () => actions.spatialTool(null),
  });
  return commands;
}
