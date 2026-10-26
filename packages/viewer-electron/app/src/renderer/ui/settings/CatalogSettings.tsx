import { Fragment, useEffect, useRef } from 'react';
import { settingValue, type SettingDefinition } from '../../../domain/preferences/catalog';
import { Icon, type IconName } from '../Icon';
import type { SettingsEditor } from './editor';
import { ChoiceButton } from '../ChoiceMenu';
import { ColorField } from '../ColorField';
import { looks } from '../../workspace/look';

const toolbarIcons: Record<string, IconName> = {
  parent: 'parent-plane',
  sidebar: 'sidebar',
  back: 'left',
  forward: 'right',
  view: 'list',
  search: 'search',
  frame: 'frame',
  dock: 'dock',
  actions: 'more',
  close: 'close',
};
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
      .catch((error) => setError((error as Error).message));
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
        const toolbarKey = definition.path.startsWith('ui.space.headerControls.')
          ? definition.path.split('.').at(-1)!
          : undefined;
        const checked = settingValue(snapshot, definition.path) === true;
        // a row of buttons is no label: a click on its text would press the first
        const Row = definition.kind === 'color' ? 'div' : 'label';
        return (
          <Fragment key={definition.path}>
            {definition.section && definition.section !== definitions[index - 1]?.section && (
              <h2>{definition.section}</h2>
            )}
            <Row className="settings-row" data-setting-path={definition.path}>
              <span>
                {toolbarKey ? (
                  <span className="settings-toolbar-label">
                    <span
                      className="settings-toolbar-preview"
                      data-enabled={checked}
                      aria-hidden="true"
                    >
                      <Icon name={toolbarIcons[toolbarKey] ?? 'more'} size={18} />
                      {toolbarKey === 'view' && <Icon name="down" size={9} />}
                    </span>
                    <span>{definition.label}</span>
                  </span>
                ) : (
                  definition.label
                )}
                {definition.detail && <small>{definition.detail}</small>}
                {query && <small>{definition.category}</small>}
              </span>
              {definition.kind === 'boolean' ? (
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
              )}
            </Row>
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
