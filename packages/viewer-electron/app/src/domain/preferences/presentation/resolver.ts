import type { UIPreferences, Workspace } from '../../contracts';
import type { ApplicationSettings } from '../../services';
import { builtInProfileIDs, builtInProfiles, type SettingProfile } from '../profiles';
import {
  compilePresentationValues,
  type CompiledPresentation,
  type PresentationValues,
  type ProfileDiagnostic,
} from './profile-fields';

export interface WindowPreferences {
  settings: ApplicationSettings;
  ui: UIPreferences;
  look: 'dark' | 'light';
  diagnostics: readonly ProfileDiagnostic[];
}

export interface WindowPreferencesInput {
  settings: ApplicationSettings;
  ui: UIPreferences;
  systemLook: 'dark' | 'light';
  workspace: Pick<Workspace, 'profileID' | 'overrides'>;
  profileID?: string;
  includeOverrides?: boolean;
}

const compiled = new WeakMap<SettingProfile, CompiledPresentation>();

function compileProfile(profile: SettingProfile): CompiledPresentation {
  let value = compiled.get(profile);
  if (!value) {
    const result = compilePresentationValues(profile.values);
    value = {
      ...result,
      diagnostics: result.diagnostics.map((issue) => ({ ...issue, profileID: profile.id })),
    };
    compiled.set(profile, value);
  }
  return value;
}

/** Built-in identifiers cannot acquire a different meaning through imported configuration. */
export function presentationProfiles(custom: readonly SettingProfile[]): readonly SettingProfile[] {
  return [...builtInProfiles, ...custom.filter((profile) => !builtInProfileIDs.has(profile.id))];
}

export function profileDiagnostics(custom: readonly SettingProfile[]): ProfileDiagnostic[] {
  return custom.flatMap((profile) =>
    builtInProfileIDs.has(profile.id)
      ? [
          {
            code: 'reserved-id' as const,
            path: 'id',
            profileID: profile.id,
            message: `The profile ID “${profile.id}” is reserved for a built-in profile.`,
          },
        ]
      : compileProfile(profile).diagnostics,
  );
}

/** Copies only the objects on changed paths; untouched preference groups retain identity. */
export function applyPresentationValues<
  Root extends { ui: UIPreferences; settings?: ApplicationSettings },
>(base: Root, values: PresentationValues): Root {
  const withValue = (current: unknown, keys: readonly string[], next: unknown): unknown => {
    if (!keys.length) {
      return Object.is(current, next) || JSON.stringify(current) === JSON.stringify(next)
        ? current
        : structuredClone(next);
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    const [key, ...remaining] = keys;
    if (!key || (remaining.length && !Object.hasOwn(current, key))) return current;
    const record = current as Record<string, unknown>;
    const child = withValue(record[key], remaining, next);
    return child === record[key] ? current : { ...record, [key]: child };
  };
  let result = base;
  for (const [path, value] of Object.entries(values))
    result = withValue(result, path.split('.'), value) as Root;
  return result;
}

/** General preferences, workspace default, explicit profile, then local choices. */
export function resolveWindowPreferences(input: WindowPreferencesInput): WindowPreferences {
  const { settings, ui, systemLook, workspace, profileID } = input;
  const catalog = presentationProfiles(settings.profiles);
  const diagnostics: ProfileDiagnostic[] = [];
  let value = { settings, ui };
  const apply = (values: PresentationValues, selected?: string) => {
    let next = applyPresentationValues(value, values);
    for (const [location, folder] of [
      ['newPlaneLocation', 'newPlanePath'],
      ['emptyWorkspaceLocation', 'emptyWorkspacePath'],
    ] as const) {
      if (next.settings.browsing[location] !== 'custom' || next.settings.browsing[folder]) continue;
      diagnostics.push({
        code: 'invalid-value',
        path: `settings.browsing.${folder}`,
        profileID: selected,
        message:
          'A custom starting folder needs a path. The inherited starting folder remains in use.',
      });
      next = {
        ...next,
        settings: {
          ...next.settings,
          browsing: {
            ...next.settings.browsing,
            [location]: value.settings.browsing[location],
            [folder]: value.settings.browsing[folder],
          },
        },
      };
    }
    value = next;
  };
  const applied = new Set<string>();
  for (const id of [workspace.profileID, profileID]) {
    if (!id || applied.has(id)) continue;
    applied.add(id);
    const profile = catalog.find((item) => item.id === id);
    if (!profile) {
      diagnostics.push({
        code: 'missing-profile',
        path: 'profileID',
        profileID: id,
        message: `The profile “${id}” is unavailable. Inherited preferences remain in use.`,
      });
      continue;
    }
    const result = compileProfile(profile);
    diagnostics.push(...result.diagnostics);
    apply(result.values, profile.id);
  }
  if (input.includeOverrides !== false && workspace.overrides) {
    const result = compilePresentationValues(workspace.overrides);
    diagnostics.push(...result.diagnostics);
    apply(result.values);
  }
  return {
    ...value,
    look: value.settings.appearance === 'system' ? systemLook : value.settings.appearance,
    diagnostics,
  };
}

/** A resolver belongs to one native/renderer window, rather than a process-global selected profile. */
export function createWindowPreferencesResolver(): (
  input: WindowPreferencesInput,
) => WindowPreferences {
  let previous: WindowPreferencesInput | undefined;
  let result: WindowPreferences;
  return (input) => {
    if (
      !previous ||
      previous.settings !== input.settings ||
      previous.ui !== input.ui ||
      previous.systemLook !== input.systemLook ||
      previous.workspace.profileID !== input.workspace.profileID ||
      previous.workspace.overrides !== input.workspace.overrides ||
      previous.profileID !== input.profileID ||
      previous.includeOverrides !== input.includeOverrides
    ) {
      previous = {
        ...input,
        workspace: {
          profileID: input.workspace.profileID,
          overrides: input.workspace.overrides,
        },
      };
      result = resolveWindowPreferences(input);
    }
    return result;
  };
}
