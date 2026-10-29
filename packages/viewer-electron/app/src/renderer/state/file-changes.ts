// Path changes from file operations applied to saved state, sessions and preferences.
import { remapSessions } from '../workspace/sessions';
import { pathMapper, type FileChange } from '../../domain/files/changes';
import { getState, replaceState, update } from './core';
import { pendingPreferences, schedulePreferences } from './preferences';
import type { DiffSource } from '../../domain/comparison/diff';
import { requestRefresh } from './refresh';

export function receiveFileChanges(changes: FileChange[]): void {
  const map = pathMapper(changes);
  const mapSource = (source: DiffSource): DiffSource => {
    if (source.kind === 'file') {
      const path = map(source.path);
      return path === source.path ? source : { ...source, path };
    }
    if (source.kind === 'git') {
      const repository = map(source.repository);
      return repository === source.repository ? source : { ...source, repository };
    }
    return source;
  };
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
              : pane.type === 'diff'
                ? {
                    ...pane,
                    path: map(pane.path),
                    left: mapSource(pane.left),
                    right: mapSource(pane.right),
                  }
                : { ...pane, path: map(pane.path) },
          ),
          // A project's folder views follow their folders, as its planes do.
          ...(space.project
            ? {
                project: {
                  ...space.project,
                  folders: Object.fromEntries(
                    Object.entries(space.project.folders).map(([path, view]) => [map(path), view]),
                  ),
                },
              }
            : {}),
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
  requestRefresh(changes.flatMap((change) => [change.source, change.destination]));
}
