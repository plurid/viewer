import { effectiveUI, overridable } from '../../../domain/overrides';
import { clearWorkspaceOverrides, setWorkspaceOverride } from '../../state/workspaces';
import {
  settingCatalog,
  settingContext,
  settingValue,
  workspaceMayChange,
  type SettingDefinition,
} from '../../../domain/setting-catalog';
import type { UIPreferences } from '../../../domain/contracts';
import { activeWorkspace, changePreferences, getState, receiveSettings } from '../../state/store';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';
import { effectiveWindowUI } from '../../state/effective-ui';

/** Settings whose command is their own: they keep its name and shortcut, with no second one. */
const ownCommands = new Set(['ui.sidebar.visible', 'ui.titlebar.visible']);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
/** A number's or colour's value as its palette row shows it; an empty colour is the automatic one. */
const shown = (value: unknown) => (value === '' ? 'Automatic' : String(value ?? ''));
/** A setting's name away from its Settings page: "Plane toolbar › Back button". */
export const settingName = (definition: SettingDefinition) => {
  const context = settingContext(definition);
  return context ? `${context} › ${definition.label}` : definition.label;
};
const current = (path: string) =>
  settingValue({ settings: getState().settings.settings, ui: effectiveWindowUI(getState()) }, path);
/** A copy of `value` with `keys` set, the rest shared. */
function withPath<T>(value: T, keys: readonly string[], next: unknown): T {
  if (!keys.length) return next as T;
  const record = value as Record<string, unknown>;
  return { ...record, [keys[0]!]: withPath(record[keys[0]!], keys.slice(1), next) } as T;
}
/**
 * Changes a setting from the workspace, where the workspace may (its view and presentation), and
 * otherwise opens Settings at it, where the person changes it.
 */
export async function changeSetting(path: string, value: unknown): Promise<void> {
  const keys = path.split('.');
  if (!workspaceMayChange(keys)) {
    await window.viewer.openSettings(path);
    return;
  }
  if (keys[0] === 'ui') {
    if (
      overridable(path) &&
      (typeof value === 'boolean' || typeof value === 'number') &&
      (getState().saved.profile || activeWorkspace().profileID)
    ) {
      setWorkspaceOverride(path, value);
      return;
    }
    changePreferences((ui) => withPath<UIPreferences>(ui, keys.slice(1), value));
    return;
  }
  receiveSettings(
    await window.viewer.settingsPatch([{ path, value }], getState().settings.revision),
  );
}
/** Several settings at once: the UI's in one preference change, the rest in one patch. */
export async function changeSettings(values: Readonly<Record<string, unknown>>): Promise<void> {
  const entries = Object.entries(values).filter(([path]) => workspaceMayChange(path.split('.')));
  const ui = entries.filter(([path]) => path.startsWith('ui.'));
  if (ui.length)
    changePreferences((preferences) =>
      ui.reduce(
        (next, [path, value]) => withPath<UIPreferences>(next, path.split('.').slice(1), value),
        preferences,
      ),
    );
  const settings = entries.filter(([path]) => path.startsWith('settings.'));
  if (settings.length)
    receiveSettings(
      await window.viewer.settingsPatch(
        settings.map(([path, value]) => ({ path, value })),
        getState().settings.revision,
      ),
    );
}
/** A setting's value as it is now, from the settings or the window's preferences. */
export const settingNow = (path: string) => current(path);
/**
 * A COMMAND FOR EVERY SETTING (2026-10-23): in the palette, the Settings menu, a shortcut's reach and
 * an agent's proposals. An on/off setting toggles; a choice offers each value, the current one
 * checked; a number or colour opens Settings at it. ids are `setting.<path>` and
 * `setting.<path>=<value>`, so a shortcut or an agent names one exactly.
 */
export function settingsCommands({ windowScope }: WindowScopes): CommandDefinition[] {
  const overrides = activeWorkspace().overrides;
  const clear: CommandDefinition[] =
    overrides && Object.keys(overrides).length
      ? [
          {
            id: 'workspace-overrides-clear',
            label: 'Use the general settings in this workspace',
            group: 'Settings',
            icon: 'restore',
            aliases: ['override', 'workspace settings', 'reset workspace'],
            when: windowScope,
            run: clearWorkspaceOverrides,
          },
        ]
      : [];
  return [
    ...clear,
    ...settingCatalog.flatMap((definition): CommandDefinition[] => {
      if (ownCommands.has(definition.path) || definition.path.startsWith('ui.list.')) return [];
      const name = settingName(definition);
      const base = {
        group: 'Settings',
        detail: definition.category,
        aliases: [
          definition.path,
          definition.category,
          ...(definition.section ? [definition.section] : []),
        ],
        when: windowScope,
      };
      const { path } = definition;
      if (definition.kind === 'boolean') {
        const on = current(path) === true;
        const shows = definition.label.startsWith('Show ') && !settingContext(definition);
        const toggle = (value: boolean) =>
          shows
            ? (value ? 'Hide ' : 'Show ') + definition.label.slice('Show '.length)
            : `${value ? 'Turn off' : 'Turn on'}: ${name}`;
        const commands: CommandDefinition[] = [
          {
            ...base,
            id: 'setting.' + path,
            label: toggle(on),
            icon: on ? 'check' : 'settings',
            setting: { name, value: on },
            run: () => changeSetting(path, !on),
          },
        ];
        // this workspace's own, over the general setting (2026-10-23)
        if (overridable(path)) {
          const here =
            settingValue(
              { ui: effectiveUI(getState().saved.ui, activeWorkspace().overrides) },
              path,
            ) === true;
          commands.push({
            ...base,
            id: `setting.${path}@workspace`,
            label: `This workspace: ${toggle(here)}`,
            icon: here ? 'check' : 'settings',
            setting: { name, value: here, workspace: true },
            aliases: [...base.aliases, 'workspace', 'this workspace', 'override'],
            // back to the general setting when it is the same again
            run: () => setWorkspaceOverride(path, !here === on ? undefined : !here),
          });
        }
        return commands;
      }
      if (definition.kind === 'choice') {
        const value = String(current(path));
        return (definition.choices ?? []).map(([choice, label]) => ({
          ...base,
          id: `setting.${path}=${choice}`,
          label: `${name}: ${label}`,
          icon: choice === value ? 'check' : 'settings',
          setting: { name, choice: label, current: choice === value },
          // a custom folder is chosen in Settings, with its folder picker
          run: () =>
            choice === 'custom'
              ? window.viewer.openSettings(path)
              : changeSetting(path, typeof current(path) === 'number' ? Number(choice) : choice),
        }));
      }
      return [
        {
          ...base,
          id: 'setting.' + path,
          label: `Change ${lowerFirst(name)}…`,
          icon: 'settings',
          setting: { name, value: shown(current(path)) },
          run: () => window.viewer.openSettings(path),
        },
      ];
    }),
  ];
}
