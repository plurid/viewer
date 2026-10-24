// Pure folder presentation: safe to use during bootstrap and configuration updates.
import type { UIPreferences, Workspace } from '../../domain/contracts';
import type { ApplicationSettings } from '../../domain/services';
import {
  resolveFolderPresentation,
  type FolderPresentation,
} from '../../domain/preferences/folder-presentation';
import { resolveWindowPreferences } from '../../domain/preferences/presentation/resolver';

export function scopedPresentation(
  path: string,
  settings: ApplicationSettings,
  ui: UIPreferences,
  space: Workspace,
  options: { profileID?: string; systemLook?: 'dark' | 'light' } = {},
): FolderPresentation {
  const effective = resolveWindowPreferences({
    settings,
    ui,
    workspace: space,
    profileID: options.profileID,
    systemLook: options.systemLook ?? 'dark',
  });
  settings = effective.settings;
  ui = effective.ui;
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
