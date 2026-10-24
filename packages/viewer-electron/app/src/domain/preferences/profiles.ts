import type { JSONValue } from '../workspaces/project';

/**
 * SETTING PROFILES (2026-10-23): named sets of settings applied at once, as presentation modes: Focus
 * hides the chrome, Present hides headers too, Full shows everything. Only settings the workspace
 * window may change itself belong in one (setting-catalog.ts `workspaceMayChange`).
 */
export interface SettingProfile {
  id: string;
  name: string;
  /** Setting paths and their values: `ui.space.minimap: false`. */
  values: Record<string, JSONValue>;
}
/** What a profile saved from the current state holds: the window's chrome and the space's look. */
export const profilePaths = [
  'ui.titlebar.visible',
  'ui.sidebar.visible',
  'ui.space.toolbar',
  'ui.space.minimap',
  'ui.space.viewcube',
  'ui.space.grid',
  'ui.space.planeHeaders',
  'ui.space.origin',
  'ui.space.color',
  'ui.space.backdropOpacity',
] as const;
const chrome = {
  'ui.titlebar.visible': false,
  'ui.sidebar.visible': false,
  'ui.space.toolbar': false,
  'ui.space.minimap': false,
  'ui.space.viewcube': false,
  'ui.space.grid': false,
};
export const builtInProfiles: readonly SettingProfile[] = [
  { id: 'focus', name: 'Focus', values: chrome },
  { id: 'present', name: 'Present', values: { ...chrome, 'ui.space.planeHeaders': false } },
  {
    id: 'full',
    name: 'Full',
    values: {
      'ui.titlebar.visible': true,
      'ui.sidebar.visible': true,
      'ui.space.toolbar': true,
      'ui.space.minimap': true,
      'ui.space.viewcube': true,
      'ui.space.grid': true,
      'ui.space.planeHeaders': true,
    },
  },
];
export const builtInProfileIDs = new Set(builtInProfiles.map((profile) => profile.id));
