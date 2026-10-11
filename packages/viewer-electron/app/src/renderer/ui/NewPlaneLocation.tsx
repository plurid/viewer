import { useState } from 'react';
import { settingCatalog } from '../../domain/setting-catalog';
import type { SettingsPatch } from '../../domain/services';
import { getState, receiveSettings, report, useViewer } from '../state/store';

const preference = 'settings.browsing.newPlaneLocation';
const choices = settingCatalog.find((item) => item.path === preference)!.choices!;

/** The empty workspace edits the same persisted preference as Settings → Browsing. */
export function NewPlaneLocation() {
  const browsing = useViewer((state) => state.settings.settings.browsing);
  const [busy, setBusy] = useState(false);
  const change = async (location: string) => {
    setBusy(true);
    try {
      let patches: SettingsPatch[] = [{ path: preference, value: location }];
      if (location === 'custom') {
        const path = await window.viewer.chooseFolder();
        if (!path) return;
        patches = [...patches, { path: 'settings.browsing.newPlanePath', value: path }];
      }
      receiveSettings(await window.viewer.settingsPatch(patches, getState().settings.revision));
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="empty-plane-location">
      <label>
        <span>New planes start in</span>
        <select
          aria-label="New folder planes start in"
          value={browsing.newPlaneLocation}
          disabled={busy}
          onChange={(event) => {
            void change(event.target.value);
          }}
        >
          {choices.map(([value, label]) => (
            <option key={value} value={value}>
              {value === 'current'
                ? 'Current folder (Home here)'
                : value === 'custom' && browsing.newPlaneLocation === 'custom'
                  ? browsing.newPlanePath.split(/[\\/]/).pop() || 'Custom folder'
                  : label}
            </option>
          ))}
        </select>
      </label>
      {browsing.newPlaneLocation === 'custom' && (
        <button
          disabled={busy}
          title={browsing.newPlanePath}
          onClick={() => {
            void change('custom');
          }}
        >
          Change folder…
        </button>
      )}
    </div>
  );
}
