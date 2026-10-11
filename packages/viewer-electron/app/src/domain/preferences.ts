import type { SidebarSection, UIPreferences } from './contracts';

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
    sidebar: {
      visible: typeof sidebar.visible === 'boolean' ? sidebar.visible : true,
      width:
        typeof sidebar.width === 'number' && Number.isFinite(sidebar.width)
          ? Math.max(160, Math.min(360, Math.round(sidebar.width)))
          : 210,
      order: [...order, ...sidebarSections.filter((item) => !order.includes(item))],
      collapsed: strings(sidebar.collapsed, 3, 20).filter((item): item is SidebarSection =>
        sidebarSections.includes(item as SidebarSection),
      ),
      locations: paths(sidebar.locations),
      hidden: paths(sidebar.hidden),
      labels: labels as Record<string, string>,
    },
    space: {
      backs: typeof space.backs === 'boolean' ? space.backs : true,
      minimap: typeof space.minimap === 'boolean' ? space.minimap : false,
      viewcube: typeof space.viewcube === 'boolean' ? space.viewcube : false,
      origin: typeof space.origin === 'boolean' ? space.origin : false,
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
