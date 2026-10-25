// Folder view presentation resolved from settings, interface preferences and projects.
import { useMemo } from 'react';
import type { ApplicationSettings } from '../../domain/services';
import {
  panePresentation,
  type FolderOverride,
  type FolderPresentation,
} from '../../domain/preferences/folder-presentation';
import { activeWorkspace, changeWorkspace, getState, report, update, useViewer } from './core';
import { queuePreference, receiveSettings, schedulePreferences } from './preferences';
import { effectiveWindowSettings, effectiveWindowUI } from './effective-ui';
import { scopedPresentation } from './folder-presentation';
export { scopedPresentation } from './folder-presentation';

export function folderPresentation(path: string): FolderPresentation {
  return scopedPresentation(
    path,
    getState().settings.settings,
    getState().saved.ui,
    activeWorkspace(),
    {
      profileID: getState().saved.profile?.id,
      systemLook: getState().settings.systemLook ?? getState().settings.look,
    },
  );
}
export function useFolderPresentation(path: string): FolderPresentation {
  const browsing = useViewer((state) => effectiveWindowSettings(state).browsing);
  const override = useViewer((state) => effectiveWindowSettings(state).folders[path]);
  const list = useViewer((state) => effectiveWindowUI(state).list);
  const project = useViewer((state) => activeWorkspace(state).project?.folders[path]);
  // folderPresentation reads the store; the selections above are exactly its inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => folderPresentation(path), [path, browsing, override, list, project]);
}
export function updateFolderPresentation(path: string, patch: FolderOverride | null): void {
  const project = activeWorkspace().project;
  if (project) {
    const folders = { ...project.folders };
    if (patch === null) delete folders[path];
    else
      folders[path] = {
        ...folders[path],
        ...patch,
        ...(patch.list ? { list: { ...folders[path]?.list, ...patch.list } } : {}),
      };
    changeWorkspace((space) => {
      const next = { ...space, project: { ...project, folders, dirty: true } };
      return {
        ...next,
        panes: space.panes.map((pane) =>
          pane.type === 'folder' && pane.path === path
            ? {
                ...pane,
                ...panePresentation(
                  scopedPresentation(
                    path,
                    getState().settings.settings,
                    getState().saved.ui,
                    next,
                    { profileID: getState().saved.profile?.id },
                  ),
                ),
              }
            : pane,
        ),
      };
    });
    return;
  }
  const folders = { ...getState().settings.settings.folders };
  if (patch === null) delete folders[path];
  else
    folders[path] = {
      ...folders[path],
      ...patch,
      ...(patch.list ? { list: { ...folders[path]?.list, ...patch.list } } : {}),
    };
  const settings = { ...getState().settings.settings, folders };
  const saved = {
    ...getState().saved,
    workspaces: getState().saved.workspaces.map((space) => ({
      ...space,
      panes: space.panes.map((pane) =>
        pane.type === 'folder' && pane.path === path
          ? {
              ...pane,
              ...panePresentation(
                scopedPresentation(path, settings, getState().saved.ui, space, {
                  profileID:
                    space.id === getState().saved.activeWorkspace
                      ? getState().saved.profile?.id
                      : undefined,
                }),
              ),
            }
          : pane,
      ),
    })),
  };
  update({ ...getState(), settings: { ...getState().settings, settings }, saved }, true);
  if (patch === null) queuePreference('@' + JSON.stringify(['settings', 'folders', path]), null);
  else
    for (const [key, value] of Object.entries(patch))
      queuePreference(
        '@' + JSON.stringify(['settings', 'folders', path, key]),
        key === 'list' ? folders[path]?.list : value,
      );
  schedulePreferences();
}
export function applyFolderAsDefaults(
  path: string,
  displayedMode?: FolderPresentation['mode'],
): void {
  const value = folderPresentation(path);
  const { list, sort, descending, showHidden, density, foldersFirst, group, columnWidth } = value;
  const mode = displayedMode ?? value.mode;
  const browsing = getState().settings.settings.browsing;
  void window.viewer
    .settingsPatch(
      [
        {
          path: 'settings.browsing',
          value: {
            ...browsing,
            // The Map and lens grouping belong to one folder: other folders keep their default.
            mode: mode === 'map' ? browsing.mode : mode,
            sort,
            descending,
            showHidden,
            density,
            foldersFirst,
            group: group === 'lens' ? browsing.group : group,
            columnWidth,
          } satisfies ApplicationSettings['browsing'],
        },
        { path: 'ui.list', value: list },
      ],
      getState().settings.revision,
    )
    .then(receiveSettings)
    .catch(report);
}
