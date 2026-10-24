import type { UIPreferences } from './contracts';

/**
 * A WORKSPACE'S OWN SETTINGS (2026-10-23): what a workspace may set over the general settings, the
 * window's chrome and the space's look. The backdrop is the window's (Clear needs a window made
 * transparent), so it is general only; so is the colour, which a workspace sets as its background.
 */
export const overridablePaths = [
  'ui.titlebar.visible',
  'ui.space.toolbar',
  'ui.space.minimap',
  'ui.space.viewcube',
  'ui.space.grid',
  'ui.space.planeHeaders',
  'ui.space.origin',
  'ui.space.backdropOpacity',
] as const;
export type OverridablePath = (typeof overridablePaths)[number];
export type WorkspaceOverrides = Partial<Record<OverridablePath, boolean | number>>;
const allowed = new Set<string>(overridablePaths);
export const overridable = (path: string): path is OverridablePath => allowed.has(path);
/** The general preferences with a workspace's overrides; the same object when it has none. */
export function effectiveUI(
  ui: UIPreferences,
  overrides: Readonly<Record<string, unknown>> | undefined,
): UIPreferences {
  const entries = Object.entries(overrides ?? {}).filter(([path]) => overridable(path));
  if (!entries.length) return ui;
  const next = structuredClone(ui) as unknown as Record<string, Record<string, unknown>>;
  for (const [path, value] of entries) {
    const [, group, key] = path.split('.');
    if (group && key && typeof next[group]?.[key] === typeof value) next[group]![key] = value;
  }
  return next as unknown as UIPreferences;
}
