import type { ResolvedCommand } from './registry';
import type { IconName } from '../ui/Icon';

export interface MenuSection {
  label?: string;
  entries: MenuEntry[];
}
export type MenuEntry =
  | { kind: 'command'; id: string; command: ResolvedCommand }
  | { kind: 'submenu'; id: string; label: string; icon: IconName; sections: MenuSection[] };

// Contextual presentation is separate from search ranking and command execution.
const direct = [
  ['open-selection', 'quick-preview', 'open-with'],
  ['rename', 'copy', 'copy-path', 'paste', 'new-folder', 'select-all'],
  ['info', 'trash'],
];
const icons: Record<string, IconName> = {
  Files: 'file',
  Folder: 'folder',
  View: 'list',
  Columns: 'columns',
  'Group by': 'grid',
  Navigation: 'folder',
  Terminal: 'terminal',
  Actions: 'command',
  Plane: 'link',
  'Size & position': 'resize',
  Width: 'side-by-side',
  Height: 'stacked',
  Position: 'move',
  Space: 'model',
  Sidebar: 'sidebar',
  App: 'settings',
  Workspace: 'command',
  Project: 'folder',
  Workspaces: 'grid',
  'Quick actions': 'image',
};
const order = [
  'Files',
  'View',
  'Folder',
  'Navigation',
  'Terminal',
  'Actions',
  'Quick actions',
  'Plane',
  'Size & position',
  'App',
];
const leaf = (command: ResolvedCommand): MenuEntry => ({
  kind: 'command',
  id: command.id,
  command,
});
const section = (commands: ResolvedCommand[], label?: string): MenuSection => ({
  label,
  entries: commands.map(leaf),
});
function groupCommands(commands: ResolvedCommand[]) {
  const groups = new Map<string, ResolvedCommand[]>();
  for (const command of commands) {
    const rows = groups.get(command.group) ?? [];
    rows.push(command);
    groups.set(command.group, rows);
  }
  return groups;
}
function branch(label: string, sections: MenuSection[]): MenuEntry {
  return {
    kind: 'submenu',
    id: 'menu.' + label,
    label: label === 'Files' ? 'More file actions' : label,
    icon: icons[label] ?? 'command',
    sections: sections.filter((item) => item.entries.length),
  };
}
function viewSections(commands: ResolvedCommand[]): MenuSection[] {
  const arrangements = commands.filter((item) =>
    ['view-side-by-side', 'view-stacked'].includes(item.id),
  );
  const arrangementIDs = new Set(arrangements.map((item) => item.id));
  const modes = commands.filter(
    (item) => item.id.startsWith('view-') && !arrangementIDs.has(item.id),
  );
  const grouping = commands.filter((item) => item.id.startsWith('group.'));
  const columns = commands.filter(
    (item) =>
      item.id.startsWith('column.') || ['wrap-file-names', 'reset-list-columns'].includes(item.id),
  );
  const captured = new Set(
    [...modes, ...arrangements, ...grouping, ...columns].map((item) => item.id),
  );
  return [
    section(modes),
    section(arrangements),
    {
      entries: [
        ...(grouping.length ? [branch('Group by', [section(grouping)])] : []),
        ...(columns.length ? [branch('Columns', [section(columns)])] : []),
      ],
    },
    section(commands.filter((item) => !captured.has(item.id))),
  ].filter((item) => item.entries.length);
}

function layoutSections(commands: ResolvedCommand[]): MenuSection[] {
  return [
    section(
      commands.filter((item) => ['plane-move', 'plane-resize', 'plane-fill'].includes(item.id)),
    ),
    {
      entries: (['Width', 'Height', 'Position'] as const).flatMap((label) => {
        const prefix = `plane-${label === 'Position' ? 'align' : label.toLowerCase()}-`;
        const rows = commands.filter((item) => item.id.startsWith(prefix));
        return rows.length ? [branch(label, [section(rows)])] : [];
      }),
    },
  ].filter((item) => item.entries.length);
}

/** Keep frequent actions visible; every other applicable command remains in a named submenu. */
export function contextMenuSections(
  commands: readonly ResolvedCommand[],
  recent: readonly string[],
  focused = false,
): MenuSection[] {
  const remaining = new Map(commands.map((item) => [item.id, item]));
  const take = (ids: readonly string[]) => {
    const items: ResolvedCommand[] = [];
    for (const id of ids) {
      const item = remaining.get(id);
      if (!item) continue;
      remaining.delete(id);
      items.push(item);
    }
    return items;
  };
  const sections: MenuSection[] = [];
  const applicableRecent = [...new Set(recent)].filter((id) => remaining.has(id)).slice(0, 2);
  if (applicableRecent.length)
    sections.push({
      label: 'Recent',
      // A recent shortcut is an additional placement of the same captured command.
      // Distinct row IDs keep keyboard focus separate from its normal menu placement.
      entries: applicableRecent.map((id) => ({ ...leaf(remaining.get(id)!), id: 'recent.' + id })),
    });
  const pinned = commands.filter((item) => item.id.startsWith('custom.') && item.primary);
  if (pinned.length) sections.push(section(take(pinned.map((item) => item.id)), 'Pinned'));

  // A view-button or column-header menu is already scoped: show its choices immediately.
  if (focused) {
    const items = [...remaining.values()];
    if (
      items.every((item) => item.group === 'View') &&
      items.some((item) => item.id.startsWith('view-'))
    )
      sections.push(...viewSections(items));
    else if (items.length && items.every((item) => item.group === 'Size & position'))
      sections.push(...layoutSections(items));
    else {
      const groups = groupCommands(items);
      for (const [label, rows] of groups) sections.push(section(rows, label));
    }
    return sections.filter((item) => item.entries.length);
  }
  for (const ids of direct) sections.push(section(take(ids)));

  const grouped = groupCommands([...remaining.values()]);
  const names = [...grouped.keys()].sort((a, b) => {
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex);
  });
  const entries = names.map((label) => {
    const rows = grouped.get(label)!;
    if (label === 'View') return branch(label, viewSections(rows));
    if (label === 'Size & position') return branch(label, layoutSections(rows));
    if (label === 'Files') {
      const open = rows.filter((item) =>
        ['open-default', 'linked', 'another-plane', 'reveal'].includes(item.id),
      );
      const organize = rows.filter((item) =>
        ['cut', 'copy-to', 'move-to', 'duplicate'].includes(item.id),
      );
      const used = new Set([...open, ...organize].map((item) => item.id));
      return branch(label, [
        section(open, 'Open'),
        section(organize, 'Organize'),
        section(
          rows.filter((item) => !used.has(item.id)),
          'Information',
        ),
      ]);
    }
    return branch(label, [section(rows)]);
  });
  if (entries.length) sections.push({ entries });
  return sections.filter((item) => item.entries.length);
}
