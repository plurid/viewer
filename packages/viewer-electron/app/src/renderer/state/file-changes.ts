// Path changes from file operations applied to saved state, sessions and preferences.
import { remapSessions } from '../workspace/sessions';
import { pathMapper, type FileChange } from '../../domain/changes';
import { getState, replaceState, update } from './core';
import { pendingPreferences, schedulePreferences } from './preferences';

export function receiveFileChanges(changes: FileChange[]): void {
  const map = pathMapper(changes);
  const saved = getState().saved;
  const quick = getState().quickPreview;
  update(
    {
      ...getState(),
      saved: {
        ...saved,
        workspaces: saved.workspaces.map((space) => ({
          ...space,
          collections: space.collections?.map((collection) => ({
            ...collection,
            sources: collection.sources.map(map),
          })),
          basket: space.basket?.map((item) => ({
            ...item,
            path: map(item.path),
            ...(item.evidence
              ? { evidence: { ...item.evidence, path: map(item.evidence.path) } }
              : {}),
          })),
          panes: space.panes.map((pane) =>
            pane.type === 'folder'
              ? { ...pane, path: map(pane.path), history: pane.history.map(map) }
              : { ...pane, path: map(pane.path) },
          ),
        })),
        favorites: saved.favorites.map((item) => ({ ...item, path: map(item.path) })),
        recents: saved.recents.map(map),
        ui: {
          ...saved.ui,
          sidebar: {
            ...saved.ui.sidebar,
            locations: saved.ui.sidebar.locations.map(map),
            hidden: saved.ui.sidebar.hidden.map(map),
            labels: Object.fromEntries(
              Object.entries(saved.ui.sidebar.labels).map(([path, label]) => [map(path), label]),
            ),
          },
        },
      },
      quickPreview: quick ? { ...quick, paths: quick.paths.map(map) } : null,
    },
    true,
  );
  for (const key of ['labels', 'locations', 'hidden'] as const)
    if (JSON.stringify(getState().saved.ui.sidebar[key]) !== JSON.stringify(saved.ui.sidebar[key]))
      pendingPreferences.set('ui.sidebar.' + key, getState().saved.ui.sidebar[key]);
  schedulePreferences();
  const folders = Object.fromEntries(
    Object.entries(getState().settings.settings.folders).map(([path, value]) => [map(path), value]),
  );
  if (JSON.stringify(folders) !== JSON.stringify(getState().settings.settings.folders)) {
    replaceState({
      ...getState(),
      settings: { ...getState().settings, settings: { ...getState().settings.settings, folders } },
    });
    for (const [key, value] of [...pendingPreferences]) {
      if (!key.startsWith('@')) continue;
      const keys = JSON.parse(key.slice(1)) as string[];
      if (keys[0] === 'settings' && keys[1] === 'folders' && keys[2]) {
        pendingPreferences.delete(key);
        keys[2] = map(keys[2]);
        pendingPreferences.set('@' + JSON.stringify(keys), value);
      }
    }
  }
  remapSessions(changes);
  window.dispatchEvent(new Event('viewer:refresh'));
}
