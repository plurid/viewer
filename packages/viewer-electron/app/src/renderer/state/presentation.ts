// Folder view presentation resolved from settings, interface preferences and projects.
import { useMemo } from 'react';
import type { UIPreferences, Workspace } from '../../domain/contracts';
import type { ApplicationSettings } from '../../domain/services';
import {
  panePresentation,
  resolveFolderPresentation,
  type FolderOverride,
  type FolderPresentation,
} from '../../domain/folder-presentation';
import { activeWorkspace, changeWorkspace, getState, report, update, useViewer } from './core';
import { pendingPreferences, receiveSettings, schedulePreferences } from './preferences';

export function folderPresentation(path: string): FolderPresentation {
  return scopedPresentation(
    path,
    getState().settings.settings,
    getState().saved.ui,
    activeWorkspace(),
  );
}
export function scopedPresentation(
  path: string,
  settings: ApplicationSettings,
  ui: UIPreferences,
  space: Workspace,
): FolderPresentation {
  const override = space.project?.folders[path];
  return resolveFolderPresentation(
    path,
    override
      ? {
          ...settings,
          folders: {
            ...settings.folders,
            [path]: {
              ...settings.folders[path],
              ...override,
              ...(override.list
                ? {
                    list: {
                      ...settings.folders[path]?.list,
                      ...override.list,
                      visible: {
                        ...settings.folders[path]?.list?.visible,
                        ...override.list.visible,
                      },
                      widths: { ...settings.folders[path]?.list?.widths, ...override.list.widths },
                    },
                  }
                : {}),
            },
          },
        }
      : settings,
    ui,
  );
}
export function useFolderPresentation(path: string): FolderPresentation {
  const browsing = useViewer((state) => state.settings.settings.browsing);
  const override = useViewer((state) => state.settings.settings.folders[path]);
  const list = useViewer((state) => state.saved.ui.list);
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
                  scopedPresentation(path, getState().settings.settings, getState().saved.ui, next),
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
              ...panePresentation(scopedPresentation(path, settings, getState().saved.ui, space)),
            }
          : pane,
      ),
    })),
  };
  update({ ...getState(), settings: { ...getState().settings, settings }, saved }, true);
  if (patch === null)
    pendingPreferences.set('@' + JSON.stringify(['settings', 'folders', path]), null);
  else
    for (const [key, value] of Object.entries(patch))
      pendingPreferences.set(
        '@' + JSON.stringify(['settings', 'folders', path, key]),
        key === 'list' ? folders[path].list : value,
      );
  schedulePreferences();
}
export function applyFolderAsDefaults(path: string): void {
  const value = folderPresentation(path);
  const { list, mode, sort, descending, showHidden, density, foldersFirst, group, columnWidth } =
    value;
  void window.viewer
    .settingsPatch(
      [
        {
          path: 'settings.browsing',
          value: {
            ...getState().settings.settings.browsing,
            mode,
            sort,
            descending,
            showHidden,
            density,
            foldersFirst,
            group,
            columnWidth,
          },
        },
        { path: 'ui.list', value: list },
      ],
      getState().settings.revision,
    )
    .then(receiveSettings)
    .catch(report);
}
