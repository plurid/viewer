import { Fragment, useEffect, useRef } from 'react';
import type { SettingDefinition } from '../../../domain/preferences/catalog';
import { planeToolbar, settingValue } from '../../../domain/preferences/catalog';
import type { HeaderControl, HeaderPresetName } from '../../../domain/preferences/header';
import {
  headerPreset,
  headerPresetLabels,
  headerPresetNames,
  headerPresetPatches,
} from '../../../domain/preferences/header';
import { Icon, type IconName } from '../Icon';
import type { SettingsEditor } from './editor';
import { ChoiceButton } from '../ChoiceMenu';
import type { RowElement } from '../primitives';
import { Row } from '../primitives';
import { ColorField } from '../ColorField';
import { looks } from '../../workspace/look';
import { errorMessage } from '../../../domain/errors';
import { DarkPagesDetail } from './DarkPagesSettings';

const toolbarIcons: Record<HeaderControl, IconName> = {
  parent: 'parent-plane',
  sidebar: 'sidebar',
  back: 'left',
  forward: 'right',
  view: 'list',
  search: 'search',
  layout: 'arrange',
  frame: 'frame',
  dock: 'dock',
  pins: 'pin',
  discover: 'help',
  formatTools: 'sliders',
  actions: 'more',
  close: 'close',
};
const headerControlsPath = 'ui.space.headerControls';
/** The generic rows for catalogued settings, in one category or across search results. */
export function CatalogSettings({
  editor,
  definitions,
  query,
}: {
  editor: SettingsEditor;
  definitions: readonly SettingDefinition[];
  query: string;
}) {
  const { snapshot, patch, patches, error: setError } = editor;
  // the system colour picker reports as it is dragged: the colour is saved once it rests
  const colorTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = colorTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  const patchColor = (path: string, value: string) => {
    clearTimeout(colorTimers.current.get(path));
    colorTimers.current.set(
      path,
      setTimeout(() => patch(path, value), 200),
    );
  };
  const settings = snapshot.settings;
  const chooseNewPlaneFolder = (field: 'newPlaneLocation' | 'emptyWorkspaceLocation') => {
    void window.viewer
      .chooseFolder()
      .then((path) => {
        if (path)
          patches([
            {
              path:
                'settings.browsing.' +
                (field === 'newPlaneLocation' ? 'newPlanePath' : 'emptyWorkspacePath'),
              value: path,
            },
            { path: 'settings.browsing.' + field, value: 'custom' },
          ]);
      })
      .catch((error) => setError(errorMessage(error)));
  };
  return (
    <div className="settings-group">
      {definitions.map((definition, index) => {
        const locationField =
          definition.path === 'settings.browsing.newPlaneLocation'
            ? 'newPlaneLocation'
            : definition.path === 'settings.browsing.emptyWorkspaceLocation'
              ? 'emptyWorkspaceLocation'
              : undefined;
        const customPath =
          locationField === 'newPlaneLocation'
            ? settings.browsing.newPlanePath
            : settings.browsing.emptyWorkspacePath;
        const toolbarKey = definition.path.startsWith(headerControlsPath + '.')
          ? (definition.path.split('.').at(-1) as HeaderControl)
          : undefined;
        // the preset row leads the toolbar's controls, wherever they are listed
        const presetRow =
          toolbarKey && !definitions[index - 1]?.path.startsWith(headerControlsPath + '.');
        const checked = settingValue(snapshot, definition.path) === true;
        // a row of buttons is no label: a click on its text would press the first
        const element: RowElement = definition.kind === 'color' ? 'div' : 'label';
        return (
          <Fragment key={definition.path}>
            {definition.section && definition.section !== definitions[index - 1]?.section && (
              <h2>{definition.section}</h2>
            )}
            {presetRow && (
              // a row of a choice button is no label: a click on its text would press it
              <Row
                as="div"
                className="settings-row"
                data-setting-path={headerControlsPath}
                label={planeToolbar.label}
                detail={planeToolbar.detail}
                control={
                  <ChoiceButton
                    label={`${planeToolbar.section} ${planeToolbar.label.toLowerCase()}`}
                    value={headerPreset(snapshot.ui.space.headerControls)}
                    placeholder={planeToolbar.custom}
                    choices={headerPresetNames.map((name) => ({
                      value: name,
                      label: headerPresetLabels[name],
                    }))}
                    onChoose={(value) => patches(headerPresetPatches(value as HeaderPresetName))}
                  />
                }
              />
            )}
            <Row
              as={element}
              className="settings-row"
              data-setting-path={definition.path}
              label={
                toolbarKey ? (
                  <span className="settings-toolbar-label">
                    <span
                      className="settings-toolbar-preview"
                      data-enabled={checked}
                      aria-hidden="true"
                    >
                      <Icon name={toolbarIcons[toolbarKey]} size={18} />
                      {toolbarKey === 'view' && <Icon name="down" size={9} />}
                    </span>
                    <span>{definition.label}</span>
                  </span>
                ) : (
                  definition.label
                )
              }
              detail={
                (definition.detail || query) && (
                  <>
                    {definition.detail}
                    {query && <small>{definition.category}</small>}
                  </>
                )
              }
              control={
                definition.kind === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => patch(definition.path, event.target.checked)}
                  />
                ) : definition.kind === 'choice' ? (
                  // the searchable choice menu, not a native dropdown
                  <ChoiceButton
                    label={definition.label}
                    value={String(settingValue(snapshot, definition.path))}
                    choices={(definition.choices ?? []).map(([value, label]) => ({ value, label }))}
                    onChoose={(value) => {
                      if (locationField && value === 'custom') {
                        chooseNewPlaneFolder(locationField);
                        return;
                      }
                      patch(
                        definition.path,
                        // a numeric setting (thumbnail size, line spacing) keeps its type
                        typeof settingValue(snapshot, definition.path) === 'number'
                          ? Number(value)
                          : value,
                      );
                    }}
                  />
                ) : definition.kind === 'color' ? (
                  <ColorField
                    label={definition.label}
                    value={String(settingValue(snapshot, definition.path) ?? '')}
                    look={snapshot.look}
                    automatic="Automatic"
                    automaticColor={looks[snapshot.look].space}
                    onChange={(value) => patchColor(definition.path, value)}
                  />
                ) : (
                  <input
                    aria-label={definition.label}
                    type="number"
                    min={definition.min}
                    max={definition.max}
                    defaultValue={Number(settingValue(snapshot, definition.path))}
                    onBlur={(event) => patch(definition.path, Number(event.target.value))}
                  />
                )
              }
            />
            {definition.path === 'settings.previews.darkPages' && (
              <DarkPagesDetail editor={editor} />
            )}
            {locationField && settings.browsing[locationField] === 'custom' && (
              <div className="settings-folder-choice">
                <span title={customPath}>{customPath}</span>
                <button onClick={() => chooseNewPlaneFolder(locationField)}>Change folder…</button>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
