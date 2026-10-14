import type { PaneSidebar, SidebarSection, UIPreferences, ListColumn } from './contracts';
import { columnWidth, listColumns } from './list-columns';

export const sidebarSections: SidebarSection[] = ['locations', 'favorites', 'recents'];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown, limit: number, maxLength: number): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === 'string' &&
              item.length > 0 &&
              item.length <= maxLength &&
              !item.includes('\0'),
          ),
        ),
      ].slice(0, limit)
    : [];
const paths = (value: unknown) =>
  strings(value, 200, 32768).filter((item) => item.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item));

const width = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(160, Math.min(360, Math.round(value)))
    : 210;
const boolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

export function needsNavigationMigration(value: unknown): boolean {
  return object(object(value).ui).version !== 3;
}

/** Run before UI normalization, so an old preference version cannot hide the migration. */
export function migratePlaneNavigation(value: unknown): unknown {
  const saved = object(value);
  if (!Array.isArray(saved.workspaces) || !needsNavigationMigration(saved)) return value;
  const ui = object(saved.ui);
  return {
    ...saved,
    ui: {
      ...ui,
      sidebar: { ...object(ui.sidebar), visible: false, inNewPlanes: true },
    },
    workspaces: saved.workspaces.map((workspace) => {
      const space = object(workspace);
      if (!Array.isArray(space.panes)) return workspace;
      return {
        ...space,
        panes: space.panes.map((pane) => {
          const record = object(pane);
          return record.type === 'folder'
            ? { ...record, sidebar: { ...object(record.sidebar), visible: true } }
            : pane;
        }),
      };
    }),
  };
}

export function normalizePaneSidebar(value: unknown): PaneSidebar | undefined {
  if (value === undefined) return undefined;
  const sidebar = object(value);
  return { visible: boolean(sidebar.visible, true), width: width(sidebar.width) };
}

/** Invalid UI fields fall back independently; core workspace state never depends on them. */
export function normalizePreferences(value?: unknown): UIPreferences {
  const ui = object(value);
  const sidebar = object(ui.sidebar);
  const space = object(ui.space);
  const controls = object(space.headerControls);
  const list = object(ui.list);
  const visible = object(list.visible);
  const widths = object(list.widths);
  const order = strings(sidebar.order, 3, 20).filter((item): item is SidebarSection =>
    sidebarSections.includes(item as SidebarSection),
  );
  const labels = Object.fromEntries(
    Object.entries(object(sidebar.labels))
      .filter(
        ([path, label]) =>
          paths([path]).length &&
          typeof label === 'string' &&
          label.trim().length > 0 &&
          label.length <= 200,
      )
      .slice(0, 200),
  );
  return {
    version: 3,
    sidebar: {
      visible: boolean(sidebar.visible, false),
      inNewPlanes: boolean(sidebar.inNewPlanes, true),
      width: width(sidebar.width),
      order: [...order, ...sidebarSections.filter((item) => !order.includes(item))],
      collapsed: strings(sidebar.collapsed, 3, 20).filter((item): item is SidebarSection =>
        sidebarSections.includes(item as SidebarSection),
      ),
      locations: paths(sidebar.locations),
      hidden: paths(sidebar.hidden),
      labels: labels as Record<string, string>,
    },
    space: {
      // Restore the spatial aids once for profiles made before the controls were exposed.
      toolbar: ui.version === 2 || ui.version === 3 ? boolean(space.toolbar, true) : true,
      minimap: ui.version === 2 || ui.version === 3 ? boolean(space.minimap, true) : true,
      viewcube: ui.version === 2 || ui.version === 3 ? boolean(space.viewcube, true) : true,
      origin: boolean(space.origin, false),
      planeHeaders: boolean(space.planeHeaders, true),
      dragging: boolean(space.dragging, true),
      resizing: boolean(space.resizing, true),
      opening: ['face-on', 'pair', 'dock'].includes(String(space.opening))
        ? (space.opening as UIPreferences['space']['opening'])
        : 'face-on',
      headerControls: {
        sidebar: boolean(controls.sidebar, true),
        back: boolean(controls.back, true),
        forward: boolean(controls.forward, true),
        view: boolean(controls.view, true),
        search: boolean(controls.search, true),
        frame: boolean(controls.frame, true),
        dock: boolean(controls.dock, true),
        actions: boolean(controls.actions, true),
        close: boolean(controls.close, true),
      },
    },
    list: {
      visible: Object.fromEntries(
        listColumns
          .filter((column) => column.id !== 'name')
          .map((column) => [column.id, boolean(visible[column.id], column.visible)]),
      ) as UIPreferences['list']['visible'],
      widths: Object.fromEntries(
        listColumns.map((column) => {
          const value = widths[column.id];
          return [
            column.id,
            typeof value === 'number' && Number.isFinite(value)
              ? column.id === 'name' && value === 0
                ? 0
                : columnWidth(column.id, value)
              : column.width,
          ];
        }),
      ) as UIPreferences['list']['widths'],
      wrapNames: boolean(list.wrapNames, false),
      ...(Array.isArray(list.order)
        ? {
            order: [
              ...new Set([
                'name',
                ...strings(list.order, 6, 30).filter((key) =>
                  listColumns.some((column) => column.id === key),
                ),
              ]),
            ] as ListColumn[],
          }
        : {}),
    },
    recentCommands: strings(ui.recentCommands, 20, 300),
  };
}

export function reorder<T>(items: readonly T[], item: T, before?: T): T[] {
  if (!items.includes(item) || item === before) return [...items];
  const next = items.filter((value) => value !== item);
  const index = before === undefined ? next.length : next.indexOf(before);
  next.splice(index < 0 ? next.length : index, 0, item);
  return next;
}
