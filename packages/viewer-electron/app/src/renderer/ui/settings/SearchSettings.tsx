import { useEffect, useState } from 'react';
import type { IndexStatus } from '../../../domain/services';
import { Field } from './SettingField';
import { IconButton } from '../primitives';
import type { SettingsEditor } from './editor';
import { commonSearchExclusions } from '../../../domain/search/exclusions';
import type { DesktopEvent } from '../../../domain/contracts';
import { errorMessage } from '../../../domain/errors';
import { followSnapshot } from '../../state/requests';

/** Search scope, traversal exclusions and permission to index document contents. */
export function SearchSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch, patches, save, error: setError } = editor;
  const settings = snapshot.settings;
  const recommended = [...new Set([...settings.search.exclusions, ...commonSearchExclusions])];
  const [index, setIndex] = useState<IndexStatus>();
  useEffect(
    () =>
      followSnapshot<IndexStatus | undefined, DesktopEvent>({
        load: () => window.viewer.indexStatus(),
        subscribe: (listener) => window.viewer.onEvent(listener),
        apply: (status, event) => (event.type === 'index' ? event.status : status),
        set: setIndex,
        failed: (error) => setError(errorMessage(error)),
      }).stop,
    [setError],
  );
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
      <p className="settings-note">
        One name or full path per line. A matching folder and everything inside it are skipped
        during indexing, document text search and subfolder searches. Names such as node_modules and
        .venv match anywhere; full paths exclude one location. These are not glob patterns.
      </p>
      <Field
        multiline
        label="Excluded search names and paths"
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
      <div className="settings-actions">
        <button
          disabled={
            commonSearchExclusions.every((rule) => settings.search.exclusions.includes(rule)) ||
            recommended.length > 200
          }
          onClick={() =>
            save((current) => [
              {
                path: 'settings.search.exclusions',
                // A textarea blur may still be saving. Merge after that write settles.
                value: [
                  ...new Set([...current.settings.search.exclusions, ...commonSearchExclusions]),
                ],
              },
            ])
          }
        >
          Add common exclusions
        </button>
      </div>
      <p className="settings-note">
        Filenames and metadata are indexed locally. Content indexing reads supported documents only
        in the locations you enable. Offline drives retain their last results.
      </p>
    </>
  );
}
