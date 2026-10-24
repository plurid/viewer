import { effectiveUI } from '../../domain/overrides';
import { builtInProfiles } from '../../domain/profiles';
import type { UIPreferences } from '../../domain/contracts';
import { activeWorkspace, type ViewerState } from './core';

let cached:
  | { ui: UIPreferences; space: object; profiles: object; selected?: string; value: UIPreferences }
  | undefined;
/** Profiles are window presentation, never writes to the shared configuration. */
export function effectiveWindowUI(state: ViewerState): UIPreferences {
  const space = activeWorkspace(state);
  const ui = state.saved.ui;
  const profiles = state.settings.settings.profiles;
  const selected = state.saved.profile?.id;
  if (
    cached?.ui === ui &&
    cached.space === space &&
    cached.profiles === profiles &&
    cached.selected === selected
  )
    return cached.value;
  let value = ui;
  for (const id of [space.profileID, selected]) {
    const profile = [...builtInProfiles, ...profiles].find((item) => item.id === id);
    if (!profile) continue;
    value = structuredClone(value);
    for (const [path, next] of Object.entries(profile.values)) {
      const [scope, ...keys] = path.split('.');
      if (scope !== 'ui') continue;
      let record = value as unknown as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) {
        if (!record[key] || typeof record[key] !== 'object') break;
        record = record[key] as Record<string, unknown>;
      }
      const key = keys.at(-1)!;
      if (Object.hasOwn(record, key) && typeof record[key] === typeof next)
        record[key] = structuredClone(next);
    }
  }
  value = effectiveUI(value, space.overrides);
  cached = { ui, space, profiles, selected, value };
  return value;
}
