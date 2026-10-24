import { builtInProfiles, profilePaths, type SettingProfile } from '../../../domain/profiles';
import type { JSONValue } from '../../../domain/project';
import { getState, receiveSettings } from '../../state/store';
import { savePatch } from '../../state/core';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';
import { changeSetting, changeSettings, settingNow } from './settings';
import { builtInTheme } from '../../../domain/themes';

const profiles = () => [...builtInProfiles, ...getState().settings.settings.profiles];
/** Applies a profile, keeping what it replaces, from before the first profile, to leave it again. */
export async function applyProfile(profile: SettingProfile): Promise<void> {
  const active = getState().saved.profile;
  const previous: Record<string, JSONValue> = { ...active?.previous };
  for (const path of Object.keys(profile.values))
    if (!(path in previous)) previous[path] = (settingNow(path) ?? null) as JSONValue;
  savePatch({ profile: { id: profile.id, previous } });
  await changeSettings(profile.values);
}
/** Back to what was there before the first profile. */
export async function leaveProfile(): Promise<void> {
  const active = getState().saved.profile;
  if (!active) return;
  savePatch({ profile: undefined });
  await changeSettings(active.previous);
}
/** The current values of what a profile holds, as a new profile. */
export function captureProfile(name: string): SettingProfile {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'profile';
  return {
    id: `${slug}-${Date.now().toString(36)}`,
    name,
    values: Object.fromEntries(
      profilePaths.map((path) => [path, (settingNow(path) ?? null) as JSONValue]),
    ),
  };
}
export async function saveProfile(profile: SettingProfile): Promise<void> {
  receiveSettings(
    await window.viewer.settingsPatch(
      [{ path: 'settings.profiles', value: [...getState().settings.settings.profiles, profile] }],
      getState().settings.revision,
    ),
  );
}
/**
 * SETTING PROFILES (2026-10-23): Profile: Focus, Present, Full or one's own; Leave profile; Focus mode
 * (⇧⌘F) toggles Focus; Save profile as… keeps the current chrome and look.
 */
export function profileCommands({
  actions,
  state,
  windowScope,
}: WindowScopes): CommandDefinition[] {
  const active = state.saved.profile;
  const name = active && profiles().find((profile) => profile.id === active.id)?.name;
  const focus = builtInProfiles.find((profile) => profile.id === 'focus')!;
  return [
    {
      id: 'focus-mode',
      label: active?.id === 'focus' ? 'Leave focus mode' : 'Focus mode',
      group: 'View',
      icon: 'frame',
      shortcut: '⇧⌘F',
      aliases: ['focus', 'zen', 'distraction free', 'hide chrome'],
      when: windowScope,
      run: () => (active?.id === 'focus' ? leaveProfile() : applyProfile(focus)),
    },
    ...profiles().map((profile): CommandDefinition => ({
      id: `profile.${profile.id}`,
      label: `Profile: ${profile.name}`,
      group: 'View',
      icon: active?.id === profile.id ? 'check' : 'settings',
      aliases: ['profile', 'mode', profile.name],
      when: windowScope,
      run: () => applyProfile(profile),
    })),
    {
      id: 'profile-restore',
      label: name ? `Leave profile ${name}` : 'Leave profile',
      group: 'View',
      icon: 'restore',
      aliases: ['profile', 'restore', 'back'],
      when: (context) => windowScope(context) && !!active,
      run: leaveProfile,
    },
    // a theme for the appearance in use (2026-10-23)
    ...[builtInTheme(state.saved.look), ...state.settings.settings.themes]
      .filter((theme) => theme.look === state.saved.look)
      .map((theme): CommandDefinition => {
        const chosen =
          (state.settings.settings.theme[state.saved.look] || builtInTheme(state.saved.look).id) ===
          theme.id;
        return {
          id: `theme.${theme.id}`,
          label: `Theme: ${theme.name}`,
          group: 'View',
          icon: chosen ? 'check' : 'sun',
          aliases: ['theme', 'colours', 'colors', theme.name],
          when: windowScope,
          run: () =>
            changeSetting(
              `settings.theme.${state.saved.look}`,
              theme.id === builtInTheme(state.saved.look).id ? '' : theme.id,
            ),
        };
      }),
    {
      id: 'profile-save-as',
      label: 'Save profile as…',
      group: 'View',
      icon: 'star',
      aliases: ['profile', 'save settings', 'preset'],
      when: windowScope,
      run: () => actions.profileDialog(),
    },
  ];
}
