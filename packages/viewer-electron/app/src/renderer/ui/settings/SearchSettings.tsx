import { useEffect, useState } from 'react';
import type { IndexStatus } from '../../../domain/services';
import { Field } from './SettingField';
import { IconButton } from '../primitives';
import type { SettingsEditor } from './editor';

/** Indexed locations with live status, saved searches and index exclusions. */
export function SearchSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch, patches, error: setError } = editor;
  const settings = snapshot.settings;
  const [index, setIndex] = useState<IndexStatus>();
  useEffect(() => {
    void window.viewer
      .indexStatus()
      .then(setIndex)
      .catch((error) => setError(error.message));
    return window.viewer.onEvent((event) => {
      if (event.type === 'index') setIndex(event.status);
    });
  }, [setError]);
  return (
    <>
      <h2>Indexed locations</h2>
      {settings.search.roots.map((root) => {
        const status = index?.roots.find((item) => item.path === root);
        return (
          <div className="settings-location" key={root}>
            <span title={root}>
              {root}
              <small>
                {status
                  ? status.status +
                    ' · ' +
                    status.count.toLocaleString() +
                    ' files' +
                    (status.errors ? ' · ' + status.errors + ' unavailable' : '')
                  : 'Waiting to index'}
              </small>
            </span>
            <label>
              <input
                type="checkbox"
                checked={settings.search.contentRoots.includes(root)}
                onChange={(event) =>
                  patch(
                    'settings.search.contentRoots',
                    event.target.checked
                      ? [...settings.search.contentRoots, root]
                      : settings.search.contentRoots.filter((item) => item !== root),
                  )
                }
              />{' '}
              Contents
            </label>
            <IconButton
              icon="close"
              label="Remove indexed location"
              onClick={() =>
                patches([
                  {
                    path: 'settings.search.roots',
                    value: settings.search.roots.filter((item) => item !== root),
                  },
                  {
                    path: 'settings.search.contentRoots',
                    value: settings.search.contentRoots.filter((item) => item !== root),
                  },
                ])
              }
            />
          </div>
        );
      })}
      <div className="settings-actions">
        <button
          onClick={() => {
            void window.viewer
              .chooseFolder()
              .then((root) => {
                if (root && !settings.search.roots.includes(root))
                  patch('settings.search.roots', [...settings.search.roots, root]);
              })
              .catch((error) => setError(error.message));
          }}
        >
          Add location…
        </button>
        <button
          onClick={() => {
            void window.viewer.indexRebuild().catch((error) => setError(error.message));
          }}
        >
          Rebuild index
        </button>
      </div>
      <h2>Saved searches</h2>
      {settings.savedSearches.map((search) => (
        <div className="settings-location" key={search.id}>
          <span>
            {search.name}
            <small>
              {search.query} · {search.root || 'Indexed locations'}
            </small>
          </span>
          <IconButton
            icon="close"
            label={'Remove saved search ' + search.name}
            onClick={() =>
              patch(
                'settings.savedSearches',
                settings.savedSearches.filter((item) => item.id !== search.id),
              )
            }
          />
        </div>
      ))}
      <h2>Excluded names and paths</h2>
      <Field
        multiline
        label="Index exclusions"
        value={settings.search.exclusions.join('\n')}
        save={(value) =>
          patch(
            'settings.search.exclusions',
            value
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          )
        }
      />
      <p className="settings-note">
        Filenames and metadata are indexed locally. Content indexing reads supported documents only
        in the locations you enable. Offline drives retain their last results.
      </p>
    </>
  );
}
