// Sidebar favorites, shortcut labels and recent folders.
import { folderPath, recordVisit, remembersFolder } from '../../domain/files/folder-visits';
import { reorder } from '../../domain/preferences/ui';
import { getState, savePatch } from './core';
import { changePreferences } from './preferences';
import { folderVisitSync } from './folder-visits';
import { knowFolder, retainKnownFolders } from '../explorer/folder-availability';

export function addFavorite(path: string, name: string, before?: string): void {
  if (
    getState().saved.favorites.length >= 200 &&
    !getState().saved.favorites.some((item) => item.path === path)
  )
    throw new Error('The sidebar has 200 favorites. Remove a shortcut before adding another.');
  const favorites = getState().saved.favorites.some((item) => item.path === path)
    ? getState().saved.favorites
    : [...getState().saved.favorites, { path, name }];
  const order = reorder(
    favorites.map((item) => item.path),
    path,
    before,
  );
  savePatch({ favorites: order.map((path) => favorites.find((item) => item.path === path)!) });
}
export function removeFavorite(path: string): void {
  savePatch({ favorites: getState().saved.favorites.filter((item) => item.path !== path) });
}
export function renameShortcut(path: string, name: string): void {
  changePreferences((ui) => ({
    ...ui,
    sidebar: { ...ui.sidebar, labels: { ...ui.sidebar.labels, [path]: name.trim() } },
  }));
}
export function remember(path: string, options: { visit?: boolean } = {}): void {
  if (!remembersFolder(path)) return;
  const visits =
    options.visit !== false
      ? recordVisit(getState().saved.visits ?? {}, path, Date.now())
      : undefined;
  if (visits) {
    retainKnownFolders(Object.keys(visits));
    knowFolder(folderPath(path));
  }
  savePatch({
    recents: [path, ...getState().saved.recents.filter((item) => item !== path)].slice(0, 50),
    ...(visits ? { visits } : {}),
  });
}
export function rememberFolderVisit(path: string): void {
  if (!remembersFolder(path)) return;
  savePatch({ visits: recordVisit(getState().saved.visits ?? {}, path, Date.now()) });
}
export function clearRecentFolders(): void {
  folderVisitSync.clear();
  savePatch({ recents: [], visits: {} });
}
export function favorite(path: string, name: string): void {
  if (getState().saved.favorites.some((item) => item.path === path)) removeFavorite(path);
  else addFavorite(path, name);
}
