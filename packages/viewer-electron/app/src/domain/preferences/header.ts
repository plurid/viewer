import type { SettingsPatch } from '../services';

/**
 * The plane header's controls, in header order. Turning one off hides its button, never its
 * command: everything stays in the plane's "…" menu and the palette.
 */
export const headerControlKeys = [
  'parent',
  'sidebar',
  'back',
  'forward',
  'view',
  'search',
  'layout',
  'frame',
  'dock',
  'pins',
  'discover',
  'formatTools',
  'actions',
  'close',
] as const;
export type HeaderControl = (typeof headerControlKeys)[number];
export type HeaderControls = Record<HeaderControl, boolean>;
export type HeaderPresetName = 'essential' | 'full';
/** What the preset row shows: a preset, or the person's own mix, which no preset names. */
export type HeaderPresetChoice = HeaderPresetName | 'custom';

const every = (value: boolean) =>
  Object.fromEntries(headerControlKeys.map((key) => [key, value])) as HeaderControls;

export const headerPresets: Readonly<Record<HeaderPresetName, Readonly<HeaderControls>>> = {
  // Layout and "What can I do here?" are rows of "…"; a format's rarer tools are commands there.
  essential: { ...every(true), layout: false, discover: false, formatTools: false },
  full: every(true),
};
export const headerPresetLabels: Readonly<Record<HeaderPresetName, string>> = {
  essential: 'Essential',
  full: 'Full',
};
export const headerPresetNames = Object.keys(headerPresets) as HeaderPresetName[];

/** The preset these controls are exactly, or `custom`. */
export function headerPreset(controls: Readonly<HeaderControls>): HeaderPresetChoice {
  return (
    headerPresetNames.find((name) =>
      headerControlKeys.every((key) => controls[key] === headerPresets[name][key]),
    ) ?? 'custom'
  );
}

export const headerControlPath = (key: HeaderControl) => `ui.space.headerControls.${key}`;

/** One patch per control, so a profile or a workspace overrides each as it would one. */
export function headerPresetPatches(name: HeaderPresetName): SettingsPatch[] {
  return headerControlKeys.map((key) => ({
    path: headerControlPath(key),
    value: headerPresets[name][key],
  }));
}
