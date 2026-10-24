import {
  defaultShortcuts,
  menuShortcuts,
  shortcutLabel,
  shortcutOwner,
} from '../../../domain/shortcuts';
import type { SettingsEditor } from './editor';
import { KeyCapture } from './KeyCapture';
import { KeymapSettings } from './KeymapSettings';

/** Keyboard shortcuts for commands and menu items, each set by pressing it (2026-10-23). */
export function ShortcutSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const settings = snapshot.settings;
  const set = (id: string, value: string | undefined) => {
    const next = { ...settings.shortcuts };
    if (value === undefined) delete next[id];
    else next[id] = value;
    patch('settings.shortcuts', next);
  };
  return (
    <>
      {Object.entries({ ...defaultShortcuts, ...menuShortcuts }).map(([id, shortcut]) => {
        const label = shortcutLabel(id);
        const changed = id in settings.shortcuts;
        return (
          // not a label: it would hand a click on the name to Reset
          <div className="settings-row" key={id}>
            <span>{label}</span>
            <span className="shortcut-control">
              {changed && (
                <button
                  type="button"
                  className="shortcut-reset"
                  aria-label={`Reset ${label}`}
                  title={`Back to ${shortcut || 'none'}`}
                  onClick={(event) => {
                    event.preventDefault();
                    set(id, undefined);
                  }}
                >
                  Reset
                </button>
              )}
              <KeyCapture
                label={`${label} shortcut`}
                kind="shortcut"
                value={settings.shortcuts[id] ?? shortcut}
                owner={(value) => shortcutOwner(settings, value, id)}
                onChange={(value) => set(id, value)}
              />
            </span>
          </div>
        );
      })}
      <div className="settings-actions">
        <button onClick={() => patch('settings.shortcuts', {})}>Reset all shortcuts</button>
      </div>
      <KeymapSettings editor={editor} />
    </>
  );
}
