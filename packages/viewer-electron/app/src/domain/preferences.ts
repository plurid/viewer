import type { PaneSidebar, SidebarSection, UIPreferences } from './contracts';

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

export function normalizePaneSidebar(value: unknown): PaneSidebar | undefined {
  if (value === undefined) return undefined;
  const sidebar = object(value);
  return { visible: boolean(sidebar.visible, false), width: width(sidebar.width) };
}

/** Invalid UI fields fall back independently; core workspace state never depends on them. */
export function normalizePreferences(value?: unknown): UIPreferences {
  const ui = object(value);
  const sidebar = object(ui.sidebar);
  const space = object(ui.space);
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
    version: 2,
    sidebar: {
      visible: boolean(sidebar.visible, true),
      inNewPlanes: boolean(sidebar.inNewPlanes, false),
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
      backs: boolean(space.backs, true),
      // Restore the spatial aids once for profiles made before the controls were exposed.
      toolbar: ui.version === 2 ? boolean(space.toolbar, true) : true,
      minimap: ui.version === 2 ? boolean(space.minimap, true) : true,
      viewcube: ui.version === 2 ? boolean(space.viewcube, true) : true,
      origin: boolean(space.origin, false),
      planeHeaders: boolean(space.planeHeaders, true),
      dragging: boolean(space.dragging, true),
      resizing: boolean(space.resizing, true),
      opening: ['face-on', 'pair', 'dock'].includes(String(space.opening))
        ? (space.opening as UIPreferences['space']['opening'])
        : 'face-on',
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
