import type { PaneSidebar, SidebarSection, UIPreferences, ListColumn } from '../contracts';
import { columnWidth, listColumns } from './list-columns';
import type { HeaderControls } from './header';
import { headerControlKeys, headerPresets } from './header';
import { normalizeFirstRunHint } from './first-run';

/**
 * The UI preference format. 3 moved plane navigation into each plane; 4 started every profile's
 * plane header from Essential (header.ts), once.
 */
export const uiPreferencesVersion = 4;

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
  const version = object(object(value).ui).version;
  return version !== 3 && version !== uiPreferencesVersion;
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

/**
 * A configuration's `ui` from before version 4, upgraded: its plane header becomes Essential, the
 * rest as it was. Anything else is left for validation. Run before the schema, on config.jsonc.
 */
export function upgradeUIPreferences(value: unknown): unknown {
  const ui = object(value);
  if (ui !== value || ui.version !== 3) return value;
  return {
    ...ui,
    version: uiPreferencesVersion,
    space: { ...object(ui.space), headerControls: { ...headerPresets.essential } },
  };
}
/** Saved controls of this format, each missing or invalid one Essential's; any earlier, Essential. */
function headerControls(ui: Record<string, unknown>): HeaderControls {
  const saved = object(object(ui.space).headerControls);
  const current = ui.version === uiPreferencesVersion;
  return Object.fromEntries(
    headerControlKeys.map((key) => [
      key,
      current ? boolean(saved[key], headerPresets.essential[key]) : headerPresets.essential[key],
    ]),
  ) as HeaderControls;
}

/** A space colour as `#rrggbb`, lowercased; anything else is no colour. */
export const spaceColor = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
/** Invalid UI fields fall back independently; core workspace state never depends on them. */
export function normalizePreferences(value?: unknown): UIPreferences {
  const ui = object(value);
  const sidebar = object(ui.sidebar);
  const space = object(ui.space);
  // a first run is quiet: no space toolbar or viewcube, and a minimap once there are planes to find
  const fresh = ui !== value;
  // the spatial aids were restored once, for profiles made before they could be turned off
  const aidsChosen = ui.version === 2 || ui.version === 3 || ui.version === uiPreferencesVersion;
  const list = object(ui.list);
  const visible = object(list.visible);
  const widths = object(list.widths);
  const order = strings(sidebar.order, 3, 20).filter((item): item is SidebarSection =>
    sidebarSections.includes(item as SidebarSection),
  );
  const firstRunHint = normalizeFirstRunHint(ui.firstRunHint);
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
    version: uiPreferencesVersion,
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
    titlebar: {
      visible: boolean(object(ui.titlebar).visible, true),
      navigation: boolean(object(ui.titlebar).navigation, true),
      newPlane: boolean(object(ui.titlebar).newPlane, true),
      operations: boolean(object(ui.titlebar).operations, true),
      voice: boolean(object(ui.titlebar).voice, false),
      commands: boolean(object(ui.titlebar).commands, true),
    },
    space: {
      toolbar: fresh ? false : aidsChosen ? boolean(space.toolbar, true) : true,
      minimap: aidsChosen ? boolean(space.minimap, true) : true,
      minimapAuto: boolean(space.minimapAuto, fresh),
      viewcube: fresh ? false : aidsChosen ? boolean(space.viewcube, true) : true,
      origin: boolean(space.origin, false),
      planeHeaders: boolean(space.planeHeaders, true),
      dragging: boolean(space.dragging, true),
      resizing: boolean(space.resizing, true),
      opening: ['face-on', 'pair', 'dock'].includes(String(space.opening))
        ? (space.opening as UIPreferences['space']['opening'])
        : 'face-on',
      backdrop: ['opaque', 'blur', 'clear'].includes(String(space.backdrop))
        ? (space.backdrop as UIPreferences['space']['backdrop'])
        : 'opaque',
      backdropOpacity:
        typeof space.backdropOpacity === 'number' && Number.isFinite(space.backdropOpacity)
          ? Math.round(Math.min(100, Math.max(0, space.backdropOpacity)))
          : 60,
      grid: boolean(space.grid, true),
      color: spaceColor(space.color) ?? '',
      headerControls: headerControls(ui),
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
    layout: { units: object(ui.layout).units === 'in' ? 'in' : 'mm' },
    recentCommands: strings(ui.recentCommands, 20, 300),
    suggestionHistory: Object.fromEntries(
      Object.entries(object(ui.suggestionHistory))
        .slice(0, 40)
        .map(([kind, ids]) => [kind.slice(0, 60), strings(ids, 8, 200)]),
    ),
    // the latest folders are last (domain/suggestions/insights.ts)
    insightsDismissed: Object.fromEntries(
      Object.entries(object(ui.insightsDismissed))
        .filter(([folder]) => paths([folder]).length)
        .map(([folder, ids]) => [folder, strings(ids, 20, 60)] as const)
        .filter(([, ids]) => ids.length)
        .slice(-200),
    ),
    // never started here: only a new configuration starts it (desktop preferences/settings.ts)
    ...(firstRunHint ? { firstRunHint } : {}),
  };
}

export function reorder<T>(items: readonly T[], item: T, before?: T): T[] {
  if (!items.includes(item) || item === before) return [...items];
  const next = items.filter((value) => value !== item);
  const index = before === undefined ? next.length : next.indexOf(before);
  next.splice(index < 0 ? next.length : index, 0, item);
  return next;
}
