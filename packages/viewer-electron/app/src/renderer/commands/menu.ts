import type { ResolvedCommand } from './registry';
import type { Suggestion } from './suggestions';
import type { IconName } from '../ui/Icon';
import type { HeaderLead } from '../workspace/header-overflow';
import { recentWorkspaceLimit } from '../../domain/workspaces/catalog';

export interface MenuSection {
  label?: string;
  entries: MenuEntry[];
}
export type MenuEntry =
  /** `note`: why a suggested row is offered, shown beside it. */
  | { kind: 'command'; id: string; command: ResolvedCommand; note?: string }
  | { kind: 'submenu'; id: string; label: string; icon: IconName; sections: MenuSection[] };

// Contextual presentation is separate from search ranking and command execution.
const direct = [
  // a package's contents next to Open, as Finder's menu has it (shown only for a package)
  ['open-selection', 'show-package-contents', 'quick-preview', 'open-with', 'extract'],
  ['rename', 'copy', 'copy-path', 'paste', 'new-folder', 'select-all'],
  ['info', 'trash'],
];
const icons: Record<string, IconName> = {
  Files: 'file',
  Folder: 'folder',
  View: 'list',
  Columns: 'columns',
  'Group by': 'grid',
  Navigation: 'compass',
  Terminal: 'terminal',
  Git: 'side-by-side',
  Actions: 'command',
  Plane: 'link',
  Layout: 'arrange',
  Width: 'side-by-side',
  Height: 'stacked',
  Position: 'move',
  Space: 'model',
  Sidebar: 'sidebar',
  App: 'settings',
  Settings: 'sliders',
  Workspace: 'dock',
  Project: 'briefcase',
  Workspaces: 'grid',
  Lens: 'lens',
  Text: 'text',
  Preview: 'eye',
  'Quick actions': 'image',
};
const order = [
  'Files',
  'View',
  'Folder',
  'Navigation',
  'Terminal',
  'Git',
  'Actions',
  'Quick actions',
  'Text',
  'Preview',
  'Lens',
  'Plane',
  'Layout',
  'Project',
  'App',
  'Settings',
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

function actionSections(commands: ResolvedCommand[], depth = 0, parent = ''): MenuSection[] {
  const direct = commands.filter((command) => (command.paletteFolder?.length ?? 0) === depth);
  const folders = new Map<string, ResolvedCommand[]>();
  for (const command of commands) {
    const name = command.paletteFolder?.[depth];
    if (name) folders.set(name, [...(folders.get(name) ?? []), command]);
  }
  return [
    section(direct),
    {
      entries: [...folders].map(([name, rows]): MenuEntry => ({
        kind: 'submenu',
        id: 'action-folder:' + parent + '/' + name,
        label: name,
        icon: 'folder',
        sections: actionSections(rows, depth + 1, parent + '/' + name),
      })),
    },
  ].filter((section) => section.entries.length);
}

/** A group's submenu, its rows arranged as the group's own are. */
function groupEntry(label: string, rows: ResolvedCommand[]): MenuEntry {
  if (label === 'View') return branch(label, viewSections(rows));
  if (label === 'Layout') return branch(label, layoutSections(rows));
  if (label === 'Actions') return branch(label, actionSections(rows));
  if (label === 'Git')
    return branch(label, [
      section(
        rows.filter((item) =>
          [
            'git-worktrees',
            'git-changes',
            'git-diff',
            'git-action.status',
            'git-action.log',
          ].includes(item.id),
        ),
      ),
      section(
        rows.filter((item) =>
          ['git-action.stage-selected', 'git-action.stage-all', 'git-action.commit'].includes(
            item.id,
          ),
        ),
      ),
      section(rows.filter((item) => ['git-action.pull', 'git-action.push'].includes(item.id))),
    ]);
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
}

/** Keep frequent actions visible; every other applicable command remains in a named submenu. */
export function contextMenuSections(
  commands: readonly ResolvedCommand[],
  recent: readonly string[],
  focused = false,
  suggested: readonly Suggestion[] = [],
  /** What the plane header could not show, which leads (workspace/header-overflow.ts). */
  lead: HeaderLead = [],
  workspaceIDs?: readonly string[],
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
  if (!focused) {
    if (workspaceIDs) {
      sections.push(
        section(take(workspaceIDs.slice(0, recentWorkspaceLimit)), 'Recent workspaces'),
      );
      sections.push(section(take(['manage-workspaces'])));
    }
    // The complete catalog remains searchable without becoming an unbounded flyout.
    take(
      commands
        .filter((command) => command.id.startsWith('workspace:'))
        .map((command) => command.id),
    );
  }
  if (!focused) {
    // in the header's order: a control of one command as its row, one of several, such as the
    // View menu, as its group's submenu
    const leading: MenuEntry[] = [];
    for (const ids of lead) {
      const rows = ids.flatMap((id) => remaining.get(id) ?? []);
      if (rows.length === 1 && ids.length === 1) leading.push(leaf(take(ids)[0]!));
      else if (rows.length) {
        const group = [...remaining.values()].filter((item) => item.group === rows[0]!.group);
        leading.push(groupEntry(rows[0]!.group, take(group.map((item) => item.id))));
      }
    }
    sections.push({ entries: leading });
  }
  const applicableRecent = [...new Set(recent)].filter((id) => remaining.has(id)).slice(0, 2);
  if (applicableRecent.length)
    sections.push({
      label: 'Recent',
      // A recent shortcut is an additional placement of the same captured command.
      // Distinct row IDs keep keyboard focus separate from its normal menu placement.
      entries: applicableRecent.map((id) => ({ ...leaf(remaining.get(id)!), id: 'recent.' + id })),
    });
  // Like Recent, another placement of commands that keep their own place below.
  const fitting = suggested.filter(
    (item) => remaining.has(item.command.id) && !applicableRecent.includes(item.command.id),
  );
  if (fitting.length && !focused)
    sections.push({
      label: 'Suggested',
      entries: fitting.map((item) => ({
        ...leaf(remaining.get(item.command.id)!),
        id: 'suggested.' + item.command.id,
        note: item.reason,
      })),
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
    else if (items.length && items.every((item) => item.group === 'Layout'))
      sections.push(...layoutSections(items));
    else {
      const groups = groupCommands(items);
      for (const [label, rows] of groups) sections.push(section(rows, label));
    }
    return sections.filter((item) => item.entries.length);
  }
  for (const ids of direct) sections.push(section(take(ids)));
  // the way to everything else is the last row, not a Help submenu of one
  const discover = take(['capabilities']);

  const grouped = groupCommands([...remaining.values()]);
  const names = [...grouped.keys()].sort((a, b) => {
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex);
  });
  const entries = names.map((label) => groupEntry(label, grouped.get(label)!));
  if (entries.length) sections.push({ entries });
  sections.push(section(discover));
  return sections.filter((item) => item.entries.length);
}
