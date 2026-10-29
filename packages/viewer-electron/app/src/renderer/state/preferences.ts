// Two-way sync of settings and interface preferences with the desktop configuration.
import type { FileEntry, UIPreferences, Look } from '../../domain/contracts';
import type { SettingsSnapshot } from '../../domain/services';
import { panePresentation } from '../../domain/preferences/folder-presentation';
import { getState, report, savePatch, update } from './core';
import { scopedPresentation } from './folder-presentation';
import { sameJSON } from '../../domain/json';
import { rememberSuggestion, selectionKind } from '../../domain/suggestions/rules';

let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
export const pendingPreferences = new Map<string, unknown>();
const pendingRevisions = new Map<string, number>();
let preferenceWrite: Promise<void> | undefined;
let activePreferences: ReadonlyMap<string, unknown> = new Map();
function preferenceKeys(path: string): string[] {
  return path.startsWith('@') ? (JSON.parse(path.slice(1)) as string[]) : path.split('.');
}
function containsPreference(parent: string, child: string): boolean {
  const parentKeys = preferenceKeys(parent);
  const childKeys = preferenceKeys(child);
  return (
    parentKeys.length <= childKeys.length &&
    parentKeys.every((key, index) => key === childKeys[index])
  );
}
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
  pendingRevisions.clear();
}
/** An explicit edit replaces any earlier failed intent for this field. */
export function queuePreference(path: string, value: unknown): void {
  pendingPreferences.set(path, value);
  pendingRevisions.set(path, getState().settings.revision);
}
export async function flushPreferences(): Promise<void> {
  clearTimeout(preferenceTimer);
  if (preferenceWrite) {
    await preferenceWrite;
    if (pendingPreferences.size) await flushPreferences();
    return;
  }
  if (!pendingPreferences.size || !window.viewer.settingsPatch) return;
  const revisions = new Map(
    [...pendingPreferences.keys()].map((path) => [
      path,
      pendingRevisions.get(path) ?? getState().settings.revision,
    ]),
  );
  const revision = Math.min(...revisions.values());
  // A patch has one base revision. Keep intents from different snapshots in
  // separate writes so an older unrelated field cannot invalidate our own edit.
  const batch = new Map(
    [...pendingPreferences].filter(([path]) => revisions.get(path) === revision),
  );
  const patches = [...batch].map(([path, value]) =>
    path.startsWith('@')
      ? { path: 'settings.folders', keys: JSON.parse(path.slice(1)) as string[], value }
      : { path, value },
  );
  activePreferences = batch;
  for (const path of batch.keys()) {
    pendingPreferences.delete(path);
    pendingRevisions.delete(path);
  }
  preferenceWrite = window.viewer
    .settingsPatch(patches, revision)
    .then((snapshot) => {
      // A successful write replaces its entire field, so queued descendants may
      // build on its acknowledgement. Ancestors keep their original baseline:
      // advancing them could hide a peer's change to a sibling we did not write.
      for (const [path, base] of pendingRevisions) {
        if (
          base <= snapshot.revision &&
          [...batch.keys()].some((written) => containsPreference(written, path))
        )
          pendingRevisions.set(path, snapshot.revision);
      }
      activePreferences = new Map();
      receiveSettings(snapshot);
    })
    .catch((error) => {
      for (const [path, value] of batch) {
        if (pendingPreferences.has(path)) continue;
        pendingPreferences.set(path, value);
        pendingRevisions.set(path, revisions.get(path)!);
      }
      throw error;
    })
    .finally(() => {
      activePreferences = new Map();
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
      if (old[group][key] !== ui[group][key]) queuePreference(`ui.${group}.${key}`, ui[group][key]);
    }
  if (old.recentCommands !== ui.recentCommands)
    queuePreference('ui.recentCommands', ui.recentCommands);
  if (old.suggestionHistory !== ui.suggestionHistory)
    queuePreference('ui.suggestionHistory', ui.suggestionHistory ?? {});
  schedulePreferences();
}
/** A command the person ran: first in Recent, and, for a file selection, in its kind's history. */
export function rememberCommand(id: string, selection: readonly FileEntry[] = []): void {
  const kind = selectionKind(selection);
  changePreferences((ui) => ({
    ...ui,
    recentCommands: [id, ...ui.recentCommands.filter((item) => item !== id)].slice(0, 20),
    ...(kind ? { suggestionHistory: rememberSuggestion(ui.suggestionHistory, kind, id) } : {}),
  }));
}
/** A line run from the command line, first in its history. */
export function rememberLine(line: string): void {
  const text = line.trim();
  if (!text || text.length > 500) return;
  const previous = getState().saved.lineHistory ?? [];
  savePatch({ lineHistory: [text, ...previous.filter((item) => item !== text)].slice(0, 200) });
}
export function setLook(look: Look): void {
  savePatch({ look });
  queuePreference('settings.appearance', look);
  schedulePreferences();
}
export function receiveSettings(snapshot: SettingsSnapshot): void {
  if (snapshot.revision < getState().settings.revision) return;
  const next = structuredClone({ ui: snapshot.ui, settings: snapshot.settings });
  for (const [path, value] of new Map([...activePreferences, ...pendingPreferences])) {
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
    if (current && sameJSON(override, current)) settings.folders[path] = current;
  }
  for (const key of Object.keys(ui) as (keyof typeof ui)[])
    if (sameJSON(ui[key], getState().saved.ui[key]))
      Object.assign(ui, { [key]: getState().saved.ui[key] });
  for (const key of Object.keys(settings) as (keyof typeof settings)[])
    if (sameJSON(settings[key], getState().settings.settings[key]))
      Object.assign(settings, { [key]: getState().settings.settings[key] });
  const workspaces = getState().saved.workspaces.map((space) => {
    let changed = false;
    const panes = space.panes.map((pane) => {
      if (pane.type !== 'folder') return pane;
      const value = panePresentation(
        scopedPresentation(pane.path, settings, ui, space, {
          profileID:
            space.id === getState().saved.activeWorkspace
              ? getState().saved.profile?.id
              : undefined,
          systemLook: snapshot.systemLook ?? snapshot.look,
        }),
      );
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
