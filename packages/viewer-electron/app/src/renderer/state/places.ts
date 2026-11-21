// Sidebar favorites, shortcut labels and recent folders.
import {
  folderPath,
  recordVisit,
  remembersFolder,
  remapFolderVisits,
  boundFolderVisits,
} from '../../domain/files/folder-visits';
import { reorder } from '../../domain/preferences/ui';
import { getState, savePatch, report, update } from './core';
import { changePreferences } from './preferences';
import { folderVisitSync } from './folder-visits';
import { flushState } from './persistence';
import { knowFolder, forgetKnownFolders } from '../explorer/folder-availability';

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
    knowFolder(folderPath(path));
    const before = getState().bootstrap;
    if (window.viewer.folderCheck)
      void window.viewer
        .folderCheck(folderPath(path))
        .then((folder) => {
          if (getState().bootstrap !== before || !folder.directory || !folder.path) return;
          const visits = getState().saved.visits ?? {};
          if (!visits[folderPath(path)]) return;
          knowFolder(folderPath(path), true, folder.path);
          const normalized = remapFolderVisits(visits, (key) =>
            key === folderPath(path) ? folder.path! : key,
          );
          if (normalized !== visits) savePatch({ visits: normalized });
        })
        .catch(() => {});
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
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
export function dismissFolderRecovery(): void {
  clearTimeout(recoveryTimer);
  update({ ...getState(), folderRecovery: undefined });
}
export function clearRecentFolders(): void {
  const { recents, visits } = getState().saved;
  folderVisitSync.clear([...recents, ...Object.keys(visits ?? {})]);
  forgetKnownFolders([...recents, ...Object.keys(visits ?? {})]);
  savePatch({ recents: [], visits: {} });
  const id = crypto.randomUUID();
  clearTimeout(recoveryTimer);
  update({
    ...getState(),
    folderRecovery: { id, expires: Date.now() + 8000, recents, visits: visits ?? {} },
  });
  recoveryTimer = setTimeout(() => {
    if (getState().folderRecovery?.id === id) dismissFolderRecovery();
  }, 8000);
}
export function favorite(path: string, name: string): void {
  if (getState().saved.favorites.some((item) => item.path === path)) removeFavorite(path);
  else addFavorite(path, name);
}

export function undoClearRecentFolders(): void {
  const recovery = getState().folderRecovery;
  if (!recovery) return;
  if (Date.now() >= recovery.expires) {
    dismissFolderRecovery();
    return;
  }
  const current = getState().saved.visits ?? {};
  const restored = { ...current };
  for (const [path, visit] of Object.entries(recovery.visits)) {
    restored[path] = {
      count: Math.min(1e9, visit.count + (current[path]?.count ?? 0)),
      last: Math.max(visit.last, current[path]?.last ?? 0),
    };
  }
  const cancelled = folderVisitSync.cancelOrRestore(recovery.visits, [
    ...recovery.recents,
    ...Object.keys(recovery.visits),
  ]);
  savePatch({
    recents: [...new Set([...getState().saved.recents, ...recovery.recents])].slice(0, 50),
    visits: boundFolderVisits(restored, Date.now(), Object.keys(current)),
  });
  dismissFolderRecovery();
  // When Clear already reached desktop, wait for the clear/restore save barrier before restoring offers.
  if (!cancelled)
    void flushState(false)
      .then(() => window.viewer.workspaceDefinitionFile?.({ kind: 'restore-offers' }))
      .catch(report);
}

export function offerToForgetFolder(path: string): void {
  report(
    new Error(
      'This folder was moved or deleted. Choose Forget Folder to remove it from your history.',
    ),
  );
  update({ ...getState(), unavailableFolder: path });
}

export function forgetUnavailableFolder(): void {
  const path = getState().unavailableFolder;
  if (!path) return;
  const visits = { ...getState().saved.visits };
  delete visits[path];
  folderVisitSync.forget([path]);
  forgetKnownFolders([path]);
  savePatch({ visits, recents: getState().saved.recents.filter((item) => item !== path) });
  update({ ...getState(), unavailableFolder: undefined, notice: null });
}
