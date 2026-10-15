import { defaultShortcuts, menuShortcuts } from '../../../domain/shortcuts';
import { Field } from '../SettingField';
import type { SettingsEditor } from './editor';

/** Keyboard shortcuts for commands and menu items. */
export function ShortcutSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const settings = snapshot.settings;
  return (
    <>
      <p className="settings-note">
        Recipe shortcuts are configured in Actions. Use Cmd, Ctrl, Alt, Shift, and a key. Space
        remains quick preview.
      </p>
      {Object.entries({ ...defaultShortcuts, ...menuShortcuts })
        .map(([id, shortcut]) => [id, id.replaceAll('-', ' '), shortcut] as const)
        .map(([id, label, shortcut]) => (
          <label className="settings-row" key={id}>
            <span>{label}</span>
            <Field
              label={label + ' shortcut'}
              value={settings.shortcuts[id] ?? shortcut}
              save={(value) => patch('settings.shortcuts', { ...settings.shortcuts, [id]: value })}
            />
          </label>
        ))}
      <div className="settings-actions">
        <button onClick={() => patch('settings.shortcuts', {})}>Reset keyboard shortcuts</button>
      </div>
    </>
  );
}
