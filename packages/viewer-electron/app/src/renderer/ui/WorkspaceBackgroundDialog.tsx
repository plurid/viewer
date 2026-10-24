import { overridablePaths } from '../../domain/overrides';
import { settingCatalog, settingValue } from '../../domain/setting-catalog';
import { activeWorkspace, changeWorkspace, useViewer } from '../state/store';
import { builtInProfiles } from '../../domain/profiles';
import { setWorkspaceOverride, setWorkspaceSpaceColor } from '../state/workspaces';
import { looks } from '../workspace/look';
import { ChoiceButton } from './ChoiceMenu';
import { ColorField } from './ColorField';
import { Dialog } from './primitives';

/**
 * A WORKSPACE'S LOOK (2026-10-23): its space colour and its own chrome over the general settings:
 * each toggle General, On or Off. Changes show at once.
 */
export function WorkspaceBackgroundDialog({ onClose }: { onClose(): void }) {
  const workspace = useViewer(activeWorkspace);
  const look = useViewer((state) => state.saved.look);
  const ui = useViewer((state) => state.saved.ui);
  const profiles = useViewer((state) => state.settings.settings.profiles);
  const general = ui.space.color;
  const toggles = overridablePaths.flatMap((path) => {
    const definition = settingCatalog.find((item) => item.path === path && item.kind === 'boolean');
    return definition ? [definition] : [];
  });
  return (
    <Dialog title="Workspace look" onClose={onClose} className="workspace-background-dialog">
      <div className="workspace-look">
        <div className="workspace-look-row">
          <span className="workspace-look-label">Default profile</span>
          <ChoiceButton
            label="Workspace default profile"
            value={workspace.profileID ?? ''}
            choices={[
              { value: '', label: 'General' },
              ...[...builtInProfiles, ...profiles].map((profile) => ({
                value: profile.id,
                label: profile.name,
              })),
            ]}
            onChoose={(profileID) =>
              changeWorkspace((space) => ({ ...space, profileID: profileID || undefined }))
            }
          />
        </div>
        <span className="workspace-look-label">Background</span>
        <ColorField
          label="Workspace background"
          value={workspace.spaceColor ?? ''}
          look={look}
          automatic="General"
          automaticColor={general || looks[look].space}
          onChange={setWorkspaceSpaceColor}
        />
        {toggles.map((definition) => {
          const own = workspace.overrides?.[definition.path as (typeof overridablePaths)[number]];
          const generalOn = settingValue({ ui }, definition.path) === true;
          return (
            <div className="workspace-look-row" key={definition.path}>
              <span className="workspace-look-label">{definition.label}</span>
              <ChoiceButton
                label={definition.label}
                value={own === undefined ? 'general' : own ? 'on' : 'off'}
                choices={[
                  { value: 'general', label: `General (${generalOn ? 'on' : 'off'})` },
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
                onChoose={(value) =>
                  setWorkspaceOverride(
                    definition.path,
                    value === 'general' ? undefined : value === 'on',
                  )
                }
              />
            </div>
          );
        })}
      </div>
      <footer>
        <button className="primary" data-autofocus onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
