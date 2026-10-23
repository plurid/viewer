// Two-way sync of settings and interface preferences with the desktop configuration.
import type { UIPreferences } from '../../domain/contracts';
import type { SettingsSnapshot } from '../../domain/services';
import { panePresentation } from '../../domain/folder-presentation';
import { getState, report, savePatch, update } from './core';
import { scopedPresentation } from './presentation';

let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
export const pendingPreferences = new Map<string, unknown>();
let preferenceWrite: Promise<void> | undefined;
/** Sends queued preference patches after a short pause, merging rapid edits. */
export function schedulePreferences(): void {
  clearTimeout(preferenceTimer);
  preferenceTimer = setTimeout(() => {
    void flushPreferences().catch(report);
  }, 80);
}
export function resetPreferences(): void {
  clearTimeout(preferenceTimer);
  pendingPreferences.clear();
}
export async function flushPreferences(): Promise<void> {
  clearTimeout(preferenceTimer);
  if (preferenceWrite) {
    await preferenceWrite;
    if (pendingPreferences.size) await flushPreferences();
    return;
  }
  if (!pendingPreferences.size || !window.viewer.settingsPatch) return;
  const patches = [...pendingPreferences].map(([path, value]) =>
    path.startsWith('@')
      ? { path: 'settings.folders', keys: JSON.parse(path.slice(1)) as string[], value }
      : { path, value },
  );
  pendingPreferences.clear();
  preferenceWrite = window.viewer
    .settingsPatch(patches, getState().settings.revision)
    .then(receiveSettings)
    .catch(report)
    .finally(() => {
      preferenceWrite = undefined;
    });
  await preferenceWrite;
  if (pendingPreferences.size) await flushPreferences();
}
export function changePreferences(transform: (ui: UIPreferences) => UIPreferences): void {
  const old = getState().saved.ui;
  const ui = transform(old);
  if (ui === old) return;
  savePatch({ ui });
  for (const group of ['sidebar', 'titlebar', 'space', 'list'] as const)
    for (const key of Object.keys(ui[group]) as (keyof (typeof ui)[typeof group])[]) {
      if (old[group][key] !== ui[group][key])
        pendingPreferences.set(`ui.${group}.${key}`, ui[group][key]);
    }
  if (old.recentCommands !== ui.recentCommands)
    pendingPreferences.set('ui.recentCommands', ui.recentCommands);
  schedulePreferences();
}
export function rememberCommand(id: string): void {
  changePreferences((ui) => ({
    ...ui,
    recentCommands: [id, ...ui.recentCommands.filter((item) => item !== id)].slice(0, 20),
  }));
}
export function setLook(look: 'dark' | 'light'): void {
  savePatch({ look });
  if (window.viewer.settingsPatch)
    void window.viewer
      .settingsPatch([{ path: 'settings.appearance', value: look }], getState().settings.revision)
      .then(receiveSettings)
      .catch(report);
}
export function receiveSettings(snapshot: SettingsSnapshot): void {
  if (snapshot.revision < getState().settings.revision) return;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const next = structuredClone({ ui: snapshot.ui, settings: snapshot.settings });
  for (const [path, value] of pendingPreferences) {
    const keys: string[] = path.startsWith('@') ? JSON.parse(path.slice(1)) : path.split('.');
    let object = next as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      object[key] ||= {};
      object = object[key] as Record<string, unknown>;
    }
    if (value === null && keys[1] === 'folders') delete object[keys.at(-1)!];
    else object[keys.at(-1)!] = value;
  }
  const { ui, settings } = next;
  for (const [path, override] of Object.entries(settings.folders)) {
    const current = getState().settings.settings.folders[path];
    if (current && same(override, current)) settings.folders[path] = current;
  }
  for (const key of Object.keys(ui) as (keyof typeof ui)[])
    if (same(ui[key], getState().saved.ui[key]))
      Object.assign(ui, { [key]: getState().saved.ui[key] });
  for (const key of Object.keys(settings) as (keyof typeof settings)[])
    if (same(settings[key], getState().settings.settings[key]))
      Object.assign(settings, { [key]: getState().settings.settings[key] });
  const workspaces = getState().saved.workspaces.map((space) => {
    let changed = false;
    const panes = space.panes.map((pane) => {
      if (pane.type !== 'folder') return pane;
      const value = panePresentation(scopedPresentation(pane.path, settings, ui, space));
      if (Object.entries(value).every(([key, value]) => pane[key as keyof typeof pane] === value))
        return pane;
      changed = true;
      return { ...pane, ...value };
    });
    return changed ? { ...space, panes } : space;
  });
  update({
    ...getState(),
    settings: { ...snapshot, settings, ui },
    saved: {
      ...getState().saved,
      workspaces,
      ui,
      look: snapshot.look,
      preferencesRevision: snapshot.revision,
    },
  });
}
