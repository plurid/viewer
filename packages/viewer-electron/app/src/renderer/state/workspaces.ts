import {
  definitionWasRemoved,
  isPristineWorkspace,
  maximumWorkspaces,
  mergeWorkspaceVisits,
} from '../../domain/workspaces/catalog';
import { mergeFolderVisits } from '../../domain/files/folder-visits';
import {
  resetKnownFolders,
  acceptKnownFolders,
  forgetKnownFolders,
} from '../explorer/folder-availability';
import { folderVisitSync } from './folder-visits';
import { presentationValue } from '../../domain/preferences/presentation/profile-fields';
// Workspace lifecycle: startup, switching, creation, deletion and restoring.
import { overridable, type WorkspaceOverrides } from '../../domain/preferences/overrides';
import type { Tiling } from '../../domain/workspaces/tiling';
import {
  CURRENT_STATE_VERSION,
  type Bootstrap,
  type SavedState,
  type Workspace,
} from '../../domain/contracts';
import {
  migratePlaneNavigation,
  normalizePreferences,
  spaceColor,
} from '../../domain/preferences/ui';
import { clearSessions } from '../workspace/sessions';
import { defaultSettings, newPlaneFolder } from '../../domain/services';
import {
  panePresentation,
  resolveFolderPresentation,
} from '../../domain/preferences/folder-presentation';
import {
  type ViewerState,
  activeWorkspace,
  changeWorkspace,
  dismissNotice,
  emit,
  getState,
  replaceState,
  savePatch,
  update,
  uuid,
} from './core';
import { folderPane } from './panes';
import {
  adapters,
  closedPanes,
  flushState,
  mergeSharedFavorites,
  mergeSharedLineHistory,
  resetPersistence,
  resetSharedLists,
} from './persistence';
import { resetPreferences } from './preferences';
import { scopedPresentation } from './folder-presentation';
import { stopTour } from '../workspace/tour';

export function initialize(bootstrap: Bootstrap): void {
  resetPersistence();
  resetPreferences();
  clearSessions();
  const settings = bootstrap.settings ?? {
    revision: 0,
    settings: defaultSettings(bootstrap.home),
    ui: normalizePreferences(bootstrap.state?.ui),
    look: bootstrap.state?.look ?? 'dark',
    credentials: [],
  };
  const initialFolder = newPlaneFolder(settings.settings.browsing, bootstrap.home, undefined, true);
  const pane = {
    ...folderPane(initialFolder, { visible: settings.ui.sidebar.inNewPlanes, width: 210 }),
    ...panePresentation(resolveFolderPresentation(initialFolder, settings.settings, settings.ui)),
  };
  const workspace: Workspace = {
    id: uuid(),
    name: 'Workspace',
    panes: [pane],
    roots: [pane.id],
    arrangement: {},
  };
  const original = (migratePlaneNavigation(bootstrap.state) as SavedState | null) ?? {
    version: 1 as const,
    workspaces: [workspace],
    activeWorkspace: workspace.id,
    favorites: [],
    recents: [],
    look: 'dark' as const,
  };
  const saved = {
    ...original,
    version: CURRENT_STATE_VERSION,
    ui: settings.ui,
    look: settings.look,
    workspaces: original.workspaces.map((space) => ({
      ...space,
      panes: space.panes.map((pane) =>
        pane.type === 'folder'
          ? {
              ...pane,
              ...panePresentation(
                scopedPresentation(pane.path, settings.settings, settings.ui, space),
              ),
            }
          : pane,
      ),
    })),
  };
  if (bootstrap.freshSession) {
    // Reuse an untouched fresh-session workspace instead of adding one on every launch.
    const pristine = saved.workspaces.findLast((space) =>
      isPristineWorkspace(space, bootstrap.home, initialFolder),
    );
    if (pristine) saved.activeWorkspace = pristine.id;
    else if (saved.workspaces.length < maximumWorkspaces) {
      saved.workspaces = [...saved.workspaces, workspace];
      saved.activeWorkspace = workspace.id;
    }
  }
  const active = activeWorkspace({ saved } as ViewerState);
  folderVisitSync.reset(
    original.visits ?? {},
    bootstrap.folderHistoryRevision,
    bootstrap.folderClearRevision,
  );
  resetSharedLists(saved.favorites, saved.lineHistory);
  resetKnownFolders(bootstrap.checkedFolders);
  saved.workspaceVisits = mergeWorkspaceVisits(saved.workspaces, saved.workspaceVisits, {
    [active.id]: Date.now(),
  });
  replaceState({
    bootstrap,
    settings,
    saved,
    jobs: [],
    activePane: active.activePane || active.panes[0]?.id || '',
    quickPreview: null,
    notice: bootstrap.recovery || null,
    operationsOpen: false,
    operationsHistory: false,
    acknowledgedJobs: [],
    clipboard: null,
    deletedWorkspace: null,
  });
  for (const space of saved.workspaces)
    adapters.set(space.id, new Map(Object.entries(space.arrangement)));
  emit();
}
export async function switchWorkspace(id: string): Promise<void> {
  if (id === getState().saved.activeWorkspace) return;
  if (!getState().saved.workspaces.some((space) => space.id === id)) return;
  await flushState();
  if (window.viewer.workspaceClaim && !(await window.viewer.workspaceClaim(id))) return;
  if (getState().definitionNotice) dismissNotice();
  stopTour();
  savePatch({
    activeWorkspace: id,
    profile: undefined,
    workspaceVisits: { ...getState().saved.workspaceVisits, [id]: Date.now() },
  });
  update({
    ...getState(),
    activePane: activeWorkspace().activePane || activeWorkspace().panes[0]?.id || '',
    quickPreview: null,
  });
  await flushState(false);
}

/** Refresh shared workspaces without replacing this window's unsaved active workspace. */
export function receiveWorkspaces(
  saved: SavedState,
  visitSaveID?: string,
  historyRevision?: number,
  clearRevision?: number,
  aliases?: Record<string, string>,
  checkedFolders?: string[],
  clearID?: string,
): void {
  const current = getState();
  const peerClear = folderVisitSync.clearedElsewhere(clearRevision, visitSaveID, clearID);
  if (peerClear && clearRevision !== undefined && clearRevision > folderVisitSync.clearVersion)
    forgetKnownFolders([...current.saved.recents, ...Object.keys(current.saved.visits ?? {})]);
  const recents = folderVisitSync.recentFolders(
    saved.recents,
    current.saved.recents,
    visitSaveID,
    clearRevision,
  );
  const visits = folderVisitSync.receive(
    saved.visits ?? {},
    current.saved.visits ?? {},
    visitSaveID,
    historyRevision,
    clearRevision,
    aliases,
  );
  acceptKnownFolders(checkedFolders ?? [], aliases);
  const active = activeWorkspace();
  const workspaces = saved.workspaces.map((space) => (space.id === active.id ? active : space));
  if (!workspaces.some((space) => space.id === active.id)) workspaces.push(active);
  const favorites = mergeSharedFavorites(current.saved.favorites, saved.favorites);
  const lineHistory = mergeSharedLineHistory(current.saved.lineHistory, saved.lineHistory);
  const workspaceVisits = mergeWorkspaceVisits(
    workspaces,
    current.saved.workspaceVisits,
    saved.workspaceVisits,
  );
  // An unchanged state would still replace `saved` and re-render everything that reads it.
  const unchanged =
    JSON.stringify([
      workspaces,
      favorites,
      recents,
      visits,
      lineHistory,
      workspaceVisits,
      saved.openWindows,
    ]) ===
    JSON.stringify([
      current.saved.workspaces,
      current.saved.favorites,
      current.saved.recents,
      current.saved.visits,
      current.saved.lineHistory,
      current.saved.workspaceVisits,
      current.saved.openWindows,
    ]);
  if (unchanged && !(peerClear && current.folderRecovery)) return;
  for (const space of workspaces) {
    if (space.id !== active.id) adapters.set(space.id, new Map(Object.entries(space.arrangement)));
  }
  update({
    ...current,
    folderRecovery: peerClear ? undefined : current.folderRecovery,
    saved: {
      ...current.saved,
      workspaces,
      workspaceVisits,
      openWindows: saved.openWindows,
      favorites,
      recents,
      visits,
      lineHistory,
    },
  });
}
export async function newWorkspace(name: string): Promise<void> {
  if (getState().saved.workspaces.length >= maximumWorkspaces)
    throw new Error(
      `You can have up to ${maximumWorkspaces} workspaces. Delete one to add another.`,
    );
  await flushState();
  stopTour();
  const pane = folderPane(getState().bootstrap.home, {
    visible: getState().saved.ui.sidebar.inNewPlanes,
    width: 210,
  });
  const workspace = {
    id: uuid(),
    name,
    panes: [pane],
    roots: [pane.id],
    activePane: pane.id,
    arrangement: {},
  };
  adapters.set(workspace.id, new Map());
  savePatch({
    workspaces: [...getState().saved.workspaces, workspace],
    activeWorkspace: workspace.id,
    profile: undefined,
    workspaceVisits: { ...getState().saved.workspaceVisits, [workspace.id]: Date.now() },
  });
  update({ ...getState(), activePane: pane.id });
  await flushState(false);
}
/** Imported copies are appended; current documents, layouts and session ownership stay intact. */
export async function appendRestoredWorkspaces(imported: SavedState): Promise<void> {
  await flushState();
  const current = getState().saved;
  if (current.workspaces.length + imported.workspaces.length > maximumWorkspaces)
    throw new Error(
      `You can have up to ${maximumWorkspaces} workspaces. Delete some, then restore again. The backup’s documents were kept.`,
    );
  if (imported.workspaces.some((space) => current.workspaces.some((item) => item.id === space.id)))
    throw new Error('A workspace in this backup is already open.');
  for (const space of imported.workspaces)
    adapters.set(space.id, new Map(Object.entries(space.arrangement)));
  const favorites = [...current.favorites];
  for (const item of imported.favorites)
    if (!favorites.some((existing) => existing.path === item.path)) favorites.push(item);
  folderVisitSync.restore(imported.visits ?? {});
  savePatch({
    workspaces: [...current.workspaces, ...imported.workspaces],
    workspaceVisits: { ...current.workspaceVisits, ...imported.workspaceVisits },
    previewStates: { ...current.previewStates, ...imported.previewStates },
    previewHistory: { ...current.previewHistory, ...imported.previewHistory },
    favorites: favorites.slice(0, 200),
    recents: [...new Set([...current.recents, ...imported.recents])].slice(0, 50),
    visits: mergeFolderVisits(current.visits ?? {}, imported.visits ?? {}, Date.now()),
  });
  await flushState(false);
  await switchWorkspace(imported.activeWorkspace);
}
export function renameWorkspace(name: string, id = activeWorkspace().id): void {
  if (id === activeWorkspace().id) {
    changeWorkspace((space) => ({ ...space, name }));
    return;
  }
  if (getState().saved.openWindows?.includes(id))
    throw new Error('Switch to this workspace’s window to rename it.');
  savePatch({
    workspaces: getState().saved.workspaces.map((space) =>
      space.id === id ? { ...space, name } : space,
    ),
  });
}
/** A setting of the active workspace's own; undefined goes back to the general one. */
export function setWorkspaceOverride(path: string, value: unknown): void {
  if (!overridable(path)) return;
  changeWorkspace((space) => {
    const overrides: WorkspaceOverrides = { ...space.overrides };
    if (value === undefined) delete overrides[path];
    else Object.assign(overrides, { [path]: presentationValue(path, value) });
    const { overrides: _previous, ...rest } = space;
    return Object.keys(overrides).length ? { ...rest, overrides } : rest;
  });
}
/** Back to the general settings in the active workspace. */
export function clearWorkspaceOverrides(): void {
  changeWorkspace((space) => {
    const { overrides: _previous, ...rest } = space;
    return rest;
  });
}
/** The active workspace's tiling; undefined lets its planes go where they are. */
export function setTiling(tiling: Tiling | undefined): void {
  changeWorkspace((space) => {
    const { tiling: _previous, ...rest } = space;
    return tiling?.panes.length ? { ...rest, tiling } : rest;
  });
}
/** The active workspace's own space colour; empty goes back to the general one. */
export function setWorkspaceSpaceColor(color: string): void {
  const chosen = spaceColor(color);
  changeWorkspace((space) => {
    if (space.spaceColor === chosen) return space;
    const { spaceColor: _previous, ...rest } = space;
    return chosen ? { ...rest, spaceColor: chosen } : rest;
  });
}
/** Removes only saved Viewer layout. No filesystem service is involved. */
export async function deleteWorkspace(id: string): Promise<void> {
  const linked = getState().saved.workspaces.find((space) => space.id === id);
  if (linked?.definition && !definitionWasRemoved(linked, getState().bootstrap.definitions))
    throw new Error(
      'This workspace comes from a definition. Close it instead, or remove the definition with Edit Workspace Definitions.',
    );
  if (id !== activeWorkspace().id && getState().saved.openWindows?.includes(id))
    throw new Error('Switch to this workspace’s window to delete it.');
  const index = getState().saved.workspaces.findIndex((space) => space.id === id);
  if (index < 0) return;
  await flushState();
  const workspace = getState().saved.workspaces.find((space) => space.id === id);
  if (!workspace) return;
  const workspaces = getState().saved.workspaces.filter((space) => space.id !== id);
  let replacement: string | undefined;
  if (!workspaces.length) {
    replacement = uuid();
    workspaces.push({ id: replacement, name: 'Workspace', panes: [], roots: [], arrangement: {} });
    adapters.set(replacement, new Map());
  }
  // A replacement exists when the last workspace is deleted, so one always remains.
  const deletingActive = getState().saved.activeWorkspace === id;
  const active = deletingActive
    ? workspaces[Math.min(index, workspaces.length - 1)]!
    : activeWorkspace();
  update(
    {
      ...getState(),
      saved: {
        ...getState().saved,
        workspaces,
        activeWorkspace: active.id,
        workspaceVisits: mergeWorkspaceVisits(
          workspaces,
          getState().saved.workspaceVisits,
          deletingActive ? { [active.id]: Date.now() } : undefined,
        ),
      },
      ...(deletingActive
        ? {
            activePane: active.activePane || active.panes[0]?.id || '',
            quickPreview: null,
          }
        : {}),
      deletedWorkspace: { workspace, index, replacement },
    },
    true,
  );
  adapters.delete(id);
  closedPanes.delete(id);
  await flushState(false);
}
export async function restoreWorkspace(): Promise<void> {
  const deleted = getState().deletedWorkspace;
  if (!deleted) return;
  await flushState();
  // A second Undo that began during this flush finds it restored: it restored it again, and the
  // duplicate workspace ID made every later state save fail.
  if (
    getState().deletedWorkspace !== deleted ||
    getState().saved.workspaces.some((space) => space.id === deleted.workspace.id)
  )
    return;
  const workspaces = getState().saved.workspaces.filter(
    (space) => !(space.id === deleted.replacement && !space.panes.length),
  );
  if (workspaces.length >= maximumWorkspaces)
    throw new Error('Close a workspace before restoring this one.');
  workspaces.splice(Math.min(deleted.index, workspaces.length), 0, deleted.workspace);
  adapters.set(deleted.workspace.id, new Map(Object.entries(deleted.workspace.arrangement)));
  update(
    {
      ...getState(),
      saved: {
        ...getState().saved,
        workspaces,
        activeWorkspace: deleted.workspace.id,
        workspaceVisits: mergeWorkspaceVisits(workspaces, getState().saved.workspaceVisits, {
          [deleted.workspace.id]: Date.now(),
        }),
      },
      activePane: deleted.workspace.activePane || deleted.workspace.panes[0]?.id || '',
      deletedWorkspace: null,
    },
    true,
  );
  await flushState(false);
}
