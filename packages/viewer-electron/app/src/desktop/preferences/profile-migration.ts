import type { SavedState } from '../../domain/contracts';
import type { JSONValue } from '../../domain/workspaces/project';
import type { SettingsPatch, SettingsSnapshot } from '../../domain/services';
import { builtInProfileIDs } from '../../domain/preferences/profiles';
import { settingValue } from '../../domain/preferences/catalog';
import {
  compileProfileFields,
  presentationFields,
} from '../../domain/preferences/presentation/profile-fields';
import { presentationProfiles } from '../../domain/preferences/presentation/resolver';
import { preferencesSchema } from '../../domain/preferences/presentation/ui-schema';
import { browsingSchema } from '../../domain/preferences/presentation/settings-schemas';
import { profileSchema, settingsSchema } from './settings-schema';
import { sameJSON } from '../../domain/json';

type AppliedProfile = NonNullable<SavedState['profile']>;

export interface LegacyProfileRestoration {
  patches: SettingsPatch[];
  state: SavedState;
  warnings: string[];
}

// These fields existed in the old globally-applied profiles. They may only be
// restored through compare-and-set, never selected by a new window-local profile.
const legacyFields = {
  ...presentationFields,
  'ui.version': preferencesSchema.shape.version,
  'ui.recentCommands': preferencesSchema.shape.recentCommands,
  'settings.browsing.restoreSession': browsingSchema.shape.restoreSession,
  'settings.folders': settingsSchema.shape.folders,
  'settings.savedSearches': settingsSchema.shape.savedSearches,
  'settings.layouts': settingsSchema.shape.layouts,
  'settings.profiles': settingsSchema.shape.profiles,
};

interface Participant {
  before: AppliedProfile;
  remaining: Record<string, JSONValue>;
}

/**
 * Plan restoration without altering state or configuration. The caller publishes
 * the returned state only after every configuration patch has succeeded.
 */
export function planLegacyProfileRestoration(
  state: SavedState,
  snapshot: SettingsSnapshot,
): LegacyProfileRestoration {
  const records = [state.profile, ...Object.values(state.windowProfiles ?? {})].filter(
    (profile): profile is AppliedProfile => !!profile && Object.keys(profile.previous).length > 0,
  );
  if (!records.length) return { patches: [], state, warnings: [] };
  if (snapshot.config?.fallback || snapshot.config?.diagnostics.length)
    return {
      patches: [],
      state,
      warnings: ['Legacy profile values were retained because the configuration is unavailable.'],
    };

  const participants = new Map<AppliedProfile, Participant>();
  const warnings = new Set<string>();
  const proposals = new Map<
    string,
    { value: JSONValue; owners: Participant[]; conflict: boolean }
  >();
  const catalog = presentationProfiles(snapshot.settings.profiles);

  for (const before of records) {
    if (participants.has(before)) continue;
    const participant: Participant = { before, remaining: {} };
    participants.set(before, participant);
    const profile = catalog.find((item) => item.id === before.id);
    if (!profile) {
      participant.remaining = { ...before.previous };
      warnings.add(`Previous values for unavailable profile “${before.id}” were retained.`);
      continue;
    }
    const applied = compileProfileFields(profile.values, legacyFields).values;
    for (const [path, value] of Object.entries(before.previous)) {
      const parsed = compileProfileFields({ [path]: value }, legacyFields);
      if (parsed.diagnostics.length) {
        participant.remaining[path] = value;
        for (const issue of parsed.diagnostics) warnings.add(issue.message);
        continue;
      }
      for (const [field, previous] of Object.entries(parsed.values)) {
        const current = settingValue(snapshot, field);
        if (sameJSON(current, previous)) continue;
        participant.remaining[field] = previous;
        if (!Object.hasOwn(applied, field) || !sameJSON(current, applied[field])) {
          warnings.add(
            `${field}: a newer preference was preserved; its earlier profile value was retained.`,
          );
          continue;
        }
        if (field === 'settings.profiles' && !validRestoredProfiles(previous)) {
          warnings.add(
            `${field}: earlier definitions need repair and were retained without replacing the catalog.`,
          );
          continue;
        }
        const pending = proposals.get(field);
        if (pending) {
          pending.owners.push(participant);
          if (!sameJSON(pending.value, previous)) pending.conflict = true;
        } else proposals.set(field, { value: previous, owners: [participant], conflict: false });
      }
    }
  }

  const patches: SettingsPatch[] = [];
  for (const [path, proposal] of proposals) {
    if (proposal.conflict) {
      warnings.add(
        `${path}: conflicting earlier window values were retained without changing the preference.`,
      );
      continue;
    }
    patches.push({ path, value: proposal.value });
    for (const owner of proposal.owners) delete owner.remaining[path];
  }
  const result = (profile: AppliedProfile | undefined): AppliedProfile | undefined => {
    if (!profile) return profile;
    const participant = participants.get(profile);
    return !participant || sameJSON(profile.previous, participant.remaining)
      ? profile
      : { ...profile, previous: participant.remaining };
  };
  const nextProfile = result(state.profile);
  const nextWindows = state.windowProfiles
    ? Object.fromEntries(
        Object.entries(state.windowProfiles).map(([id, profile]) => [id, result(profile)!]),
      )
    : undefined;
  const next =
    nextProfile === state.profile && sameJSON(nextWindows, state.windowProfiles)
      ? state
      : { ...state, profile: nextProfile, windowProfiles: nextWindows };
  return { patches, state: next, warnings: [...warnings] };
}

function validRestoredProfiles(value: JSONValue): boolean {
  return (
    Array.isArray(value) &&
    value.every((profile) => {
      const parsed = profileSchema.safeParse(profile);
      return parsed.success && !builtInProfileIDs.has(parsed.data.id);
    })
  );
}
