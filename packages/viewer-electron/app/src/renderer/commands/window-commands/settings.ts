import {
  settingCatalog,
  settingContext,
  settingValue,
  workspaceMayChange,
  type SettingDefinition,
} from '../../../domain/setting-catalog';
import type { UIPreferences } from '../../../domain/contracts';
import { changePreferences, getState, receiveSettings } from '../../state/store';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/** Settings whose command is their own: they keep its name and shortcut, with no second one. */
const ownCommands = new Set(['ui.sidebar.visible', 'ui.titlebar.visible']);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
/** A setting's name away from its Settings page: "Plane toolbar › Back button". */
export const settingName = (definition: SettingDefinition) => {
  const context = settingContext(definition);
  return context ? `${context} › ${definition.label}` : definition.label;
};
const current = (path: string) =>
  settingValue({ settings: getState().settings.settings, ui: getState().saved.ui }, path);
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
    changePreferences((ui) => withPath<UIPreferences>(ui, keys.slice(1), value));
    return;
  }
  receiveSettings(
    await window.viewer.settingsPatch([{ path, value }], getState().settings.revision),
  );
}
/**
 * A COMMAND FOR EVERY SETTING (2026-10-23): in the palette, the Settings menu, a shortcut's reach and
 * an agent's proposals. An on/off setting toggles; a choice offers each value, the current one
 * checked; a number or colour opens Settings at it. ids are `setting.<path>` and
 * `setting.<path>=<value>`, so a shortcut or an agent names one exactly.
 */
export function settingsCommands({ windowScope }: WindowScopes): CommandDefinition[] {
  return settingCatalog.flatMap((definition): CommandDefinition[] => {
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
      return [
        {
          ...base,
          id: 'setting.' + path,
          label: shows
            ? (on ? 'Hide ' : 'Show ') + definition.label.slice('Show '.length)
            : `${on ? 'Turn off' : 'Turn on'}: ${name}`,
          icon: on ? 'check' : 'settings',
          run: () => changeSetting(path, !on),
        },
      ];
    }
    if (definition.kind === 'choice') {
      const value = String(current(path));
      return (definition.choices ?? []).map(([choice, label]) => ({
        ...base,
        id: `setting.${path}=${choice}`,
        label: `${name}: ${label}`,
        icon: choice === value ? 'check' : 'settings',
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
        run: () => window.viewer.openSettings(path),
      },
    ];
  });
}
