import type { FolderPane, ListColumn, SortKey, UIPreferences, ViewMode } from './contracts';
import type { ApplicationSettings } from './services';

/** Shared folder appearance; selection/history/scroll belong to the explorer session. */
export interface FolderPresentation {
  mode: ViewMode;
  sort: SortKey;
  descending: boolean;
  showHidden: boolean;
  density: 'comfortable' | 'compact';
  foldersFirst: boolean;
  group: 'none' | 'kind' | 'modified' | 'lens';
  /** The lens grouping this folder when `group` is `lens`. */
  lens?: string;
  columnWidth: number;
  list: UIPreferences['list'] & { order?: ListColumn[] };
}
export type FolderOverride = Partial<Omit<FolderPresentation, 'list'>> & {
  list?: Partial<Omit<FolderPresentation['list'], 'visible' | 'widths'>> & {
    visible?: Partial<FolderPresentation['list']['visible']>;
    widths?: Partial<FolderPresentation['list']['widths']>;
  };
};
export function resolveFolderPresentation(
  path: string,
  settings: ApplicationSettings,
  ui: UIPreferences,
): FolderPresentation {
  const defaults = settings.browsing;
  const override = settings.folders[path];
  return {
    mode: defaults.mode,
    sort: defaults.sort,
    descending: defaults.descending,
    showHidden: defaults.showHidden,
    density: defaults.density,
    foldersFirst: defaults.foldersFirst,
    group: defaults.group,
    columnWidth: defaults.columnWidth,
    ...override,
    list: {
      ...ui.list,
      ...override?.list,
      visible: { ...ui.list.visible, ...override?.list?.visible },
      widths: { ...ui.list.widths, ...override?.list?.widths },
    },
  };
}
export function panePresentation(
  value: FolderPresentation,
): Pick<FolderPane, 'mode' | 'sort' | 'descending' | 'showHidden'> {
  return {
    mode: value.mode,
    sort: value.sort,
    descending: value.descending,
    showHidden: value.showHidden,
  };
}
export function browserColumnWidth(value: number): number {
  return Math.round(Math.min(1600, Math.max(160, value)));
}
