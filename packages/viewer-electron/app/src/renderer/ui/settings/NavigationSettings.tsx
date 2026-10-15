import { normalizePreferences } from '../../../domain/preferences';
import type { SettingsEditor } from './editor';

/** Sidebar section visibility and navigation defaults. */
export function NavigationSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  return (
    <>
      <h2>Sidebar sections</h2>
      {snapshot.ui.sidebar.order.map((section) => (
        <label className="settings-row" key={section}>
          <span>{section.charAt(0).toUpperCase() + section.slice(1)}</span>
          <input
            type="checkbox"
            checked={!snapshot.ui.sidebar.collapsed.includes(section)}
            onChange={(event) =>
              patch(
                'ui.sidebar.collapsed',
                event.target.checked
                  ? snapshot.ui.sidebar.collapsed.filter((item) => item !== section)
                  : [...snapshot.ui.sidebar.collapsed, section],
              )
            }
          />
        </label>
      ))}
      <p className="settings-note">
        Drag section headings and shortcuts in any sidebar to change their order.
      </p>
      <div className="settings-actions">
        <button onClick={() => patch('ui.sidebar', normalizePreferences().sidebar)}>
          Reset navigation defaults
        </button>
      </div>
    </>
  );
}
