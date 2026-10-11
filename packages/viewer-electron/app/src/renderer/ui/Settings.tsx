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
            <label className="settings-row">
              <span>When opening a plane</span>
              <select
                aria-label="When opening a plane"
                value={saved.ui.space.opening}
                onChange={(event) =>
                  changePreferences((ui) => ({
                    ...ui,
                    space: { ...ui.space, opening: event.target.value as typeof ui.space.opening },
                  }))
                }
              >
                <option value="face-on">Face the plane</option>
                <option value="pair">Show linked pair</option>
                <option value="dock">Dock the plane</option>
              </select>
            </label>
            <h3>Space controls</h3>
            {(
              [
                ['toolbar', 'Show bottom toolbar'],
                ['minimap', 'Show minimap'],
                ['viewcube', 'Show viewcube'],
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
            <h3>Planes</h3>
            {(
              [
                ['planeHeaders', 'Show plane headers'],
                ['dragging', 'Drag planes by their title'],
                ['resizing', 'Show resize handles'],
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
            <p className="settings-note">Plane actions remain available in Commands.</p>
          </>
        )}
        {tab === 'sidebar' && (
          <>
            <label className="settings-row">
              <span>Show window navigation</span>
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
            <label className="settings-row">
              <span>Show navigation in new folder planes</span>
              <input
                type="checkbox"
                checked={saved.ui.sidebar.inNewPlanes}
                onChange={(event) =>
                  changePreferences((ui) => ({
                    ...ui,
                    sidebar: { ...ui.sidebar, inNewPlanes: event.target.checked },
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
