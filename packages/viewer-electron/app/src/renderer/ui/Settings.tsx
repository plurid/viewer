import { useState } from 'react';
import { normalizePreferences } from '../../domain/preferences';
import { changePreferences, setLook, useViewer } from '../state/store';
import { Dialog } from './primitives';

export function Settings({ onClose }: { onClose(): void }) {
  const saved = useViewer((state) => state.saved);
  const locations = useViewer((state) => state.bootstrap.locations);
  const [tab, setTab] = useState<'appearance' | 'sidebar' | 'space'>('appearance');
  return (
    <Dialog title="Settings" onClose={onClose} className="settings-dialog">
      <nav className="settings-tabs" aria-label="Settings categories">
        {(['appearance', 'sidebar', 'space'] as const).map((item) => (
          <button key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {tab === 'appearance' && (
          <label className="settings-row">
            <span>Appearance</span>
            <select
              aria-label="Appearance"
              value={saved.look}
              onChange={(event) => setLook(event.target.value as 'dark' | 'light')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        )}
        {tab === 'space' && (
          <>
            {(
              [
                ['backs', 'Show plane backs'],
                ['minimap', 'Show minimap'],
                ['viewcube', 'Show viewcube'],
                ['origin', 'Show transform origin'],
              ] as const
            ).map(([key, label]) => (
              <label className="settings-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={saved.ui.space[key]}
                  onChange={(event) =>
                    changePreferences((ui) => ({
                      ...ui,
                      space: { ...ui.space, [key]: event.target.checked },
                    }))
                  }
                />
              </label>
            ))}
            <p className="settings-note">
              Plane backs show mirrored content. Spatial tools are available in Commands.
            </p>
          </>
        )}
        {tab === 'sidebar' && (
          <>
            <label className="settings-row">
              <span>Show sidebar</span>
              <input
                type="checkbox"
                checked={saved.ui.sidebar.visible}
                onChange={(event) =>
                  changePreferences((ui) => ({
                    ...ui,
                    sidebar: { ...ui.sidebar, visible: event.target.checked },
                  }))
                }
              />
            </label>
            <h3>Locations</h3>
            {locations.map((location) => (
              <label key={location.path} className="settings-row">
                <span>{saved.ui.sidebar.labels[location.path] || location.name}</span>
                <input
                  type="checkbox"
                  checked={!saved.ui.sidebar.hidden.includes(location.path)}
                  onChange={(event) =>
                    changePreferences((ui) => ({
                      ...ui,
                      sidebar: {
                        ...ui.sidebar,
                        hidden: event.target.checked
                          ? ui.sidebar.hidden.filter((path) => path !== location.path)
                          : [...ui.sidebar.hidden, location.path],
                      },
                    }))
                  }
                />
              </label>
            ))}
            <button
              className="settings-reset"
              onClick={() =>
                changePreferences((ui) => ({ ...ui, sidebar: normalizePreferences().sidebar }))
              }
            >
              Reset sidebar layout
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
