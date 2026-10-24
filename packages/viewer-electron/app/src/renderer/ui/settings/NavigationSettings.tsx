import { normalizePreferences } from '../../../domain/preferences';
import type { SettingsEditor } from './editor';
import { useEffect, useState } from 'react';
import type { ViewerAPI } from '../../../domain/contracts';
import { KeyCapture } from './KeyCapture';

/** Sidebar section visibility and navigation defaults. */
export function NavigationSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const [hotkey, setHotkey] = useState<Awaited<ReturnType<ViewerAPI['hotkeyStatus']>>>();
  const [command, setCommand] = useState<Awaited<ReturnType<ViewerAPI['shellCommand']>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void window.viewer
      .hotkeyStatus?.()
      .then((value) => {
        if (live) setHotkey(value);
      })
      .catch((failure: Error) => {
        if (live) setError(failure.message);
      });
    void window.viewer
      .shellCommand?.('status')
      .then((value) => {
        if (live) setCommand(value);
      })
      .catch((failure: Error) => {
        if (live) setError(failure.message);
      });
    return () => {
      live = false;
    };
  }, [snapshot.revision]);
  const install = async (action: 'install' | 'uninstall') => {
    setBusy(true);
    setError('');
    try {
      setCommand(await window.viewer.shellCommand(action));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Quick access</h2>
      <label className="settings-row">
        <span>Global shortcut</span>
        <input
          type="checkbox"
          checked={snapshot.settings.hotkey.enabled}
          onChange={(event) => patch('settings.hotkey.enabled', event.target.checked)}
        />
      </label>
      <label className="settings-row">
        <span>Show or hide Viewer</span>
        <KeyCapture
          label="Global Viewer shortcut"
          kind="global-shortcut"
          value={snapshot.settings.hotkey.shortcut}
          onChange={(value) => {
            if (value) patch('settings.hotkey.shortcut', value);
          }}
        />
      </label>
      {hotkey?.problem && <p className="error">{hotkey.problem}</p>}
      <h2>Shell command</h2>
      <p className="settings-note">
        <code>{command?.path ?? '~/.local/bin/viewer'}</code>
      </p>
      <div className="settings-actions">
        <button
          disabled={busy || !command || !!command.problem}
          onClick={() => void install(command?.installed ? 'uninstall' : 'install')}
        >
          {command?.installed ? 'Uninstall shell command…' : 'Install shell command'}
        </button>
      </div>
      {(error || command?.problem) && (
        <p className="error" role="alert">
          {error || command?.problem}
        </p>
      )}
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
