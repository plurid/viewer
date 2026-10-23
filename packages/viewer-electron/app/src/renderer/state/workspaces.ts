// Workspace lifecycle: startup, switching, creation, deletion and restoring.
import {
  CURRENT_STATE_VERSION,
  type Bootstrap,
  type SavedState,
  type Workspace,
} from '../../domain/contracts';
import { migratePlaneNavigation, normalizePreferences } from '../../domain/preferences';
import { clearSessions } from '../workspace/sessions';
import { defaultSettings } from '../../domain/services';
import { panePresentation, resolveFolderPresentation } from '../../domain/folder-presentation';
import {
  type ViewerState,
  activeWorkspace,
  changeWorkspace,
  emit,
  getState,
  replaceState,
  savePatch,
  update,
  uuid,
} from './core';
import { folderPane } from './panes';
import { adapters, closedPanes, flushState, resetPersistence } from './persistence';
import { resetPreferences } from './preferences';
import { scopedPresentation } from './presentation';

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
  const pane = {
    ...folderPane(bootstrap.home, { visible: settings.ui.sidebar.inNewPlanes, width: 210 }),
    ...panePresentation(resolveFolderPresentation(bootstrap.home, settings.settings, settings.ui)),
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
    const pristine = saved.workspaces.findLast((space) => {
      const [only] = space.panes;
      return (
        space.name === workspace.name &&
        !space.project &&
        space.panes.length === 1 &&
        only?.type === 'folder' &&
        only.path === bootstrap.home &&
        space.roots.length === 1 &&
        space.roots[0] === only.id
      );
    });
    if (pristine) saved.activeWorkspace = pristine.id;
    else if (saved.workspaces.length < 30) {
      saved.workspaces = [...saved.workspaces, workspace];
      saved.activeWorkspace = workspace.id;
    }
  }
  const active = activeWorkspace({ saved } as ViewerState);
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
  savePatch({ activeWorkspace: id });
  update({
    ...getState(),
    activePane: activeWorkspace().activePane || activeWorkspace().panes[0]?.id || '',
    quickPreview: null,
  });
  await flushState(false);
}
export async function newWorkspace(name: string): Promise<void> {
  if (getState().saved.workspaces.length >= 30)
    throw new Error('The maximum of 30 workspaces has been reached.');
  await flushState();
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
  });
  update({ ...getState(), activePane: pane.id });
  await flushState(false);
}
export function renameWorkspace(name: string): void {
  changeWorkspace((space) => ({ ...space, name }));
}
/** Removes only saved Viewer layout. No filesystem service is involved. */
export async function deleteWorkspace(id: string): Promise<void> {
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
  const active =
    getState().saved.activeWorkspace === id
      ? workspaces[Math.min(index, workspaces.length - 1)]!
      : activeWorkspace();
  update(
    {
      ...getState(),
      saved: { ...getState().saved, workspaces, activeWorkspace: active.id },
      activePane: active.activePane || active.panes[0]?.id || '',
      quickPreview: null,
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
  // duplicate workspace ID made every later state save fail (2026-10-20).
  if (
    getState().deletedWorkspace !== deleted ||
    getState().saved.workspaces.some((space) => space.id === deleted.workspace.id)
  )
    return;
  const workspaces = getState().saved.workspaces.filter(
    (space) => !(space.id === deleted.replacement && !space.panes.length),
  );
  if (workspaces.length >= 30) throw new Error('Close a workspace before restoring this one.');
  workspaces.splice(Math.min(deleted.index, workspaces.length), 0, deleted.workspace);
  adapters.set(deleted.workspace.id, new Map(Object.entries(deleted.workspace.arrangement)));
  update(
    {
      ...getState(),
      saved: { ...getState().saved, workspaces, activeWorkspace: deleted.workspace.id },
      activePane: deleted.workspace.activePane || deleted.workspace.panes[0]?.id || '',
      deletedWorkspace: null,
    },
    true,
  );
  await flushState(false);
}
