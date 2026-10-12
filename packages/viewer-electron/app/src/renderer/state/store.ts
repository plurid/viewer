import { useMemo, useSyncExternalStore } from 'react';
import type {
  Bootstrap,
  FolderPane,
  OperationJob,
  OperationProgress,
  Pane,
  PaneSidebar,
  NewRootFolderTarget,
  SavedState,
  UIPreferences,
  Workspace,
} from '../../domain/contracts';
import { migratePlaneNavigation, normalizePreferences, reorder } from '../../domain/preferences';
import { clearSessions, focusFiles, trimSessions, remapSessions } from '../workspace/sessions';
import { pathMapper, type FileChange } from '../../domain/changes';
import { parentPath } from '../../domain/planes';
import { defaultSettings, newPlaneFolder, type SettingsSnapshot } from '../../domain/services';

import {
  panePresentation,
  resolveFolderPresentation,
  type FolderOverride,
  type FolderPresentation,
} from '../../domain/folder-presentation';

interface ViewerState {
  settings: SettingsSnapshot;
  saved: SavedState & { ui: UIPreferences };
  bootstrap: Bootstrap;
  jobs: OperationJob[];
  activePane: string;
  quickPreview: { paths: string[]; index: number; paneID?: string; workspaceID: string } | null;
  notice: string | null;
  operationsOpen: boolean;
  operationsHistory: boolean;
  acknowledgedJobs: string[];
  clipboard: { paths: string[]; cut: boolean } | null;
  deletedWorkspace: { workspace: Workspace; index: number; replacement?: string } | null;
}
let current: ViewerState;
const listeners = new Set<() => void>();
let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
const pendingPreferences = new Map<string, unknown>();
let preferenceWrite: Promise<void> | undefined;
async function flushPreferences(): Promise<void> {
  clearTimeout(preferenceTimer);
  if (preferenceWrite) {
    await preferenceWrite;
    if (pendingPreferences.size) await flushPreferences();
    return;
  }
  if (!pendingPreferences.size || !window.viewer.settingsPatch) return;
  const patches = [...pendingPreferences].map(([path, value]) =>
    path.startsWith('@')
      ? { path: 'settings.folders', keys: JSON.parse(path.slice(1)) as string[], value }
      : { path, value },
  );
  pendingPreferences.clear();
  preferenceWrite = window.viewer
    .settingsPatch(patches, current.settings.revision)
    .then(receiveSettings)
    .catch(report)
    .finally(() => {
      preferenceWrite = undefined;
    });
  await preferenceWrite;
  if (pendingPreferences.size) await flushPreferences();
}
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const adapters = new Map<string, Map<string, string>>();
const dirtyArrangements = new Set<string>();
// Host records survive an arrangement undo in memory, never as unreferenced saved panes.
const closedPanes = new Map<string, Map<string, { pane: Pane; root: boolean }>>();
const uuid = () => crypto.randomUUID();
export const folderPane = (path: string, sidebar?: PaneSidebar): FolderPane => ({
  id: uuid(),
  type: 'folder',
  path,
  ...panePresentation(
    current
      ? folderPresentation(path)
      : resolveFolderPresentation(path, defaultSettings(''), normalizePreferences()),
  ),
  history: [path],
  historyIndex: 0,
  sidebar,
});
export function activeWorkspace(state = current): Workspace {
  return state.saved.workspaces.find((workspace) => workspace.id === state.saved.activeWorkspace)!;
}
function emit(): void {
  for (const listener of listeners) listener();
}
function update(next: ViewerState, persist = false): void {
  current = next;
  emit();
  if (persist) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void flushState().catch(report);
    }, 400);
  }
}
export function initialize(bootstrap: Bootstrap): void {
  clearTimeout(persistTimer);
  clearTimeout(preferenceTimer);
  pendingPreferences.clear();
  adapters.clear();
  dirtyArrangements.clear();
  clearSessions();
  closedPanes.clear();
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
    ui: settings.ui,
    look: settings.look,
    workspaces: original.workspaces.map((space) => ({
      ...space,
      panes: space.panes.map((pane) =>
        pane.type === 'folder'
          ? {
              ...pane,
              ...panePresentation(
                resolveFolderPresentation(pane.path, settings.settings, settings.ui),
              ),
            }
          : pane,
      ),
    })),
  };
  if (bootstrap.freshSession && saved.workspaces.length < 30) {
    saved.workspaces = [...saved.workspaces, workspace];
    saved.activeWorkspace = workspace.id;
  }
  const active = activeWorkspace({ saved } as ViewerState);
  current = {
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
  };
  for (const space of saved.workspaces)
    adapters.set(space.id, new Map(Object.entries(space.arrangement)));
  emit();
}
export const getState = () => current;
export function useViewer<T>(selector: (state: ViewerState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => selector(current),
  );
}
export function report(error: unknown): void {
  update({ ...current, notice: error instanceof Error ? error.message : String(error) });
}
export function dismissNotice(): void {
  update({ ...current, notice: null });
}
export function setActivePane(id: string): void {
  if (current.activePane !== id) {
    update(
      {
        ...current,
        activePane: id,
        saved: {
          ...current.saved,
          workspaces: current.saved.workspaces.map((space) =>
            space.id === current.saved.activeWorkspace
              ? { ...space, activePane: id || undefined }
              : space,
          ),
        },
      },
      true,
    );
  }
}
export function quickPreview(
  paths: string | string[] | null,
  origin?: { paneID?: string; workspaceID: string },
): void {
  const old = current.quickPreview;
  update({
    ...current,
    quickPreview: paths
      ? {
          paths: typeof paths === 'string' ? [paths] : paths,
          index: 0,
          paneID: origin?.paneID ?? current.activePane,
          workspaceID: origin?.workspaceID ?? current.saved.activeWorkspace,
        }
      : null,
  });
  if (!paths && old?.paneID) focusFiles(old.paneID);
}
export function stepQuickPreview(delta: number): void {
  const quick = current.quickPreview;
  if (quick)
    update({
      ...current,
      quickPreview: {
        ...quick,
        index: (quick.index + delta + quick.paths.length) % quick.paths.length,
      },
    });
}
export function setOperationsOpen(open: boolean, history = false): void {
  update({
    ...current,
    operationsOpen: open,
    operationsHistory: history || current.jobs.some((job) => job.status === 'failed'),
    acknowledgedJobs: open
      ? [
          ...new Set([
            ...current.acknowledgedJobs,
            ...current.jobs.filter((job) => job.status === 'failed').map((job) => job.id),
          ]),
        ]
      : current.acknowledgedJobs,
  });
}
export function needsOperations(state = current): boolean {
  return state.jobs.some(
    (job) =>
      ['queued', 'running', 'collision'].includes(job.status) ||
      (job.status === 'failed' && !state.acknowledgedJobs.includes(job.id)),
  );
}
export function setJobs(jobs: OperationJob[]): void {
  // A jobs() reply can race newer IPC events. It must never rewind a job.
  const merged = new Map(jobs.map((job) => [job.id, job]));
  for (const job of current.jobs) {
    const fetched = merged.get(job.id);
    if (!fetched || job.revision > fetched.revision) merged.set(job.id, job);
  }
  for (const job of merged.values()) receiveJob(job);
}
export function receiveJob(job: OperationJob): void {
  const old = current.jobs.find((item) => item.id === job.id);
  if (old && job.revision < old.revision) return;
  const jobs = [job, ...current.jobs.filter((item) => item.id !== job.id)].slice(0, 100);
  update({
    ...current,
    jobs,
    operationsOpen:
      current.operationsOpen &&
      (current.operationsHistory ||
        jobs.some((job) => ['queued', 'running', 'collision', 'failed'].includes(job.status))),
    acknowledgedJobs:
      current.operationsOpen && job.status === 'failed'
        ? [...new Set([...current.acknowledgedJobs, job.id])]
        : current.acknowledgedJobs,
  });
  if (old && old.status !== job.status && ['completed', 'failed', 'cancelled'].includes(job.status))
    window.dispatchEvent(new CustomEvent('viewer:refresh'));
}
/** False asks the caller for an authoritative snapshot after an unknown/missed revision. */
export function receiveProgress(progress: OperationProgress): boolean {
  const job = current.jobs.find((job) => job.id === progress.id);
  if (!job) return false;
  if (progress.revision <= job.revision) return true;
  if (progress.revision !== job.revision + 1 || job.status !== 'running') return false;
  update({
    ...current,
    jobs: current.jobs.map((job) => (job.id === progress.id ? { ...job, ...progress } : job)),
  });
  return true;
}
function savePatch(patch: Partial<SavedState>): void {
  update(
    { ...current, saved: { ...current.saved, ...patch, ui: patch.ui ?? current.saved.ui } },
    true,
  );
}
export function changePreferences(transform: (ui: UIPreferences) => UIPreferences): void {
  const old = current.saved.ui;
  const ui = transform(old);
  if (ui === old) return;
  savePatch({ ui });
  for (const group of ['sidebar', 'space', 'list'] as const)
    for (const key of Object.keys(ui[group]) as (keyof (typeof ui)[typeof group])[]) {
      if (old[group][key] !== ui[group][key])
        pendingPreferences.set(`ui.${group}.${key}`, ui[group][key]);
    }
  if (old.recentCommands !== ui.recentCommands)
    pendingPreferences.set('ui.recentCommands', ui.recentCommands);
  clearTimeout(preferenceTimer);
  preferenceTimer = setTimeout(() => {
    void flushPreferences().catch(report);
  }, 80);
}
export function rememberCommand(id: string): void {
  changePreferences((ui) => ({
    ...ui,
    recentCommands: [id, ...ui.recentCommands.filter((item) => item !== id)].slice(0, 20),
  }));
}
export function setLook(look: 'dark' | 'light'): void {
  savePatch({ look });
  if (window.viewer.settingsPatch)
    void window.viewer
      .settingsPatch([{ path: 'settings.appearance', value: look }], current.settings.revision)
      .then(receiveSettings)
      .catch(report);
}
export async function refreshClipboard(): Promise<void> {
  const clipboard = await window.viewer.clipboardRead();
  update({ ...current, clipboard });
}
export async function writeFileClipboard(paths: string[], cut: boolean): Promise<void> {
  await window.viewer.clipboardWrite(paths, cut);
  update({ ...current, clipboard: { paths, cut } });
}
export function addFavorite(path: string, name: string, before?: string): void {
  if (
    current.saved.favorites.length >= 200 &&
    !current.saved.favorites.some((item) => item.path === path)
  )
    throw new Error('The sidebar has 200 favorites. Remove a shortcut before adding another.');
  const favorites = current.saved.favorites.some((item) => item.path === path)
    ? current.saved.favorites
    : [...current.saved.favorites, { path, name }];
  const order = reorder(
    favorites.map((item) => item.path),
    path,
    before,
  );
  savePatch({ favorites: order.map((path) => favorites.find((item) => item.path === path)!) });
}
export function removeFavorite(path: string): void {
  savePatch({ favorites: current.saved.favorites.filter((item) => item.path !== path) });
}
export function renameShortcut(path: string, name: string): void {
  changePreferences((ui) => ({
    ...ui,
    sidebar: { ...ui.sidebar, labels: { ...ui.sidebar.labels, [path]: name.trim() } },
  }));
}
export function changeWorkspace(transform: (space: Workspace) => Workspace): void {
  savePatch({
    workspaces: current.saved.workspaces.map((space) =>
      space.id === current.saved.activeWorkspace ? transform(space) : space,
    ),
  });
}
export function updatePane(id: string, patch: Partial<Pane>): void {
  const pane = activeWorkspace().panes.find((pane) => pane.id === id);
  if (pane?.type === 'folder' && !('path' in patch)) {
    const presentation = Object.fromEntries(
      Object.entries(patch).filter(([key]) =>
        ['mode', 'sort', 'descending', 'showHidden'].includes(key),
      ),
    );
    if (Object.keys(presentation).length) updateFolderPresentation(pane.path, presentation);
  }
  changeWorkspace((space) => ({
    ...space,
    panes: space.panes.map((pane) => (pane.id === id ? ({ ...pane, ...patch } as Pane) : pane)),
  }));
}
export function navigate(id: string, path: string): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (!pane || pane.type !== 'folder' || pane.path === path) return;
  const history = [...pane.history.slice(0, pane.historyIndex + 1), path].slice(-200);
  updatePane(id, {
    path,
    history,
    historyIndex: history.length - 1,
    ...panePresentation(folderPresentation(path)),
  });
  remember(path);
}
export function historyNavigate(id: string, delta: number): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (pane?.type !== 'folder') return;
  const index = pane.historyIndex + delta;
  if (index >= 0 && index < pane.history.length)
    updatePane(id, {
      path: pane.history[index],
      historyIndex: index,
      ...panePresentation(folderPresentation(pane.history[index])),
    });
}
export function remember(path: string): void {
  savePatch({
    recents: [path, ...current.saved.recents.filter((item) => item !== path)].slice(0, 50),
  });
}
export function addPane(
  path: string,
  type: 'folder' | 'preview',
  root: boolean,
  options?: {
    keepSeparate?: boolean;
    folderView?: Pick<FolderPane, 'mode' | 'sort' | 'descending' | 'showHidden'>;
  },
): Pane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('This workspace has 200 planes. Close a plane or create another workspace.');
  const pane: Pane =
    type === 'folder'
      ? {
          ...folderPane(path, { visible: current.saved.ui.sidebar.inNewPlanes, width: 210 }),
          ...options?.folderView,
        }
      : { id: uuid(), type, path, keepSeparate: options?.keepSeparate || undefined };
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, pane],
    roots: root ? [...space.roots, pane.id] : space.roots,
  }));
  remember(path);
  return pane;
}
/** An explicit new explorer is a fresh root, independent even when its path is already open. */
export function addRootFolder(target: NewRootFolderTarget = {}): FolderPane | undefined {
  const space = activeWorkspace();
  if (target.workspaceID && target.workspaceID !== space.id) return;
  const owner = space.panes.find((pane) => pane.id === (target.paneID ?? current.activePane));
  if (target.paneID && !owner) return;
  const path =
    target.path ??
    newPlaneFolder(
      current.settings.settings.browsing,
      current.bootstrap.home,
      owner?.type === 'folder' || owner?.type === 'terminal'
        ? owner.path
        : owner
          ? parentPath(owner.path)
          : undefined,
      space.panes.length === 0,
    );
  const pane = addPane(path, 'folder', true) as FolderPane;
  setActivePane(pane.id);
  return pane;
}
export function removePanes(ids: string[]): void {
  const removed = new Set(ids);
  const space = activeWorkspace();
  const records = closedPanes.get(space.id) ?? new Map();
  for (const pane of space.panes) {
    if (removed.has(pane.id)) records.set(pane.id, { pane, root: space.roots.includes(pane.id) });
  }
  // Match the engine's bounded history rather than retaining closed previews indefinitely.
  while (records.size > 200) records.delete(records.keys().next().value!);
  closedPanes.set(space.id, records);
  trimSessions(
    new Set([
      ...current.saved.workspaces.flatMap((space) => space.panes.map((pane) => pane.id)),
      ...records.keys(),
    ]),
  );
  changeWorkspace((space) => ({
    ...space,
    panes: space.panes.filter((pane) => !removed.has(pane.id)),
    roots: space.roots.filter((root) => !removed.has(root)),
    activePane: space.activePane && removed.has(space.activePane) ? undefined : space.activePane,
  }));
  if (removed.has(current.activePane)) setActivePane(activeWorkspace().panes[0]?.id || '');
}
export function reconcilePanes(ids: string[]): void {
  const live = new Set(ids);
  removePanes(
    activeWorkspace()
      .panes.filter((pane) => !live.has(pane.id))
      .map((pane) => pane.id),
  );
  const space = activeWorkspace();
  const records = closedPanes.get(space.id);
  const restored = ids
    .filter((id) => !space.panes.some((pane) => pane.id === id))
    .flatMap((id) => records?.get(id) ?? []);
  if (!restored.length) return;
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, ...restored.map((record) => record.pane)],
    roots: [
      ...space.roots,
      ...restored.filter((record) => record.root).map((record) => record.pane.id),
    ],
  }));
  if (!activeWorkspace().panes.some((pane) => pane.id === current.activePane))
    setActivePane(restored[0].pane.id);
}
export function favorite(path: string, name: string): void {
  if (current.saved.favorites.some((item) => item.path === path)) removeFavorite(path);
  else addFavorite(path, name);
}
export async function switchWorkspace(id: string): Promise<void> {
  if (id === current.saved.activeWorkspace) return;
  if (!current.saved.workspaces.some((space) => space.id === id)) return;
  await flushState();
  savePatch({ activeWorkspace: id });
  update({
    ...current,
    activePane: activeWorkspace().activePane || activeWorkspace().panes[0]?.id || '',
    quickPreview: null,
  });
  await flushState(false);
}
export async function newWorkspace(name: string): Promise<void> {
  if (current.saved.workspaces.length >= 30)
    throw new Error('The maximum of 30 workspaces has been reached.');
  await flushState();
  const pane = folderPane(current.bootstrap.home, {
    visible: current.saved.ui.sidebar.inNewPlanes,
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
    workspaces: [...current.saved.workspaces, workspace],
    activeWorkspace: workspace.id,
  });
  update({ ...current, activePane: pane.id });
  await flushState(false);
}
export function renameWorkspace(name: string): void {
  changeWorkspace((space) => ({ ...space, name }));
}
/** Removes only saved Viewer layout. No filesystem service is involved. */
export async function deleteWorkspace(id: string): Promise<void> {
  const index = current.saved.workspaces.findIndex((space) => space.id === id);
  if (index < 0) return;
  await flushState();
  const workspace = current.saved.workspaces.find((space) => space.id === id);
  if (!workspace) return;
  const workspaces = current.saved.workspaces.filter((space) => space.id !== id);
  let replacement: string | undefined;
  if (!workspaces.length) {
    replacement = uuid();
    workspaces.push({ id: replacement, name: 'Workspace', panes: [], roots: [], arrangement: {} });
    adapters.set(replacement, new Map());
  }
  const active =
    current.saved.activeWorkspace === id
      ? workspaces[Math.min(index, workspaces.length - 1)]
      : activeWorkspace();
  update(
    {
      ...current,
      saved: { ...current.saved, workspaces, activeWorkspace: active.id },
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
  const deleted = current.deletedWorkspace;
  if (!deleted) return;
  await flushState();
  const workspaces = current.saved.workspaces.filter(
    (space) => !(space.id === deleted.replacement && !space.panes.length),
  );
  if (workspaces.length >= 30) throw new Error('Close a workspace before restoring this one.');
  workspaces.splice(Math.min(deleted.index, workspaces.length), 0, deleted.workspace);
  adapters.set(deleted.workspace.id, new Map(Object.entries(deleted.workspace.arrangement)));
  update(
    {
      ...current,
      saved: { ...current.saved, workspaces, activeWorkspace: deleted.workspace.id },
      activePane: deleted.workspace.activePane || deleted.workspace.panes[0]?.id || '',
      deletedWorkspace: null,
    },
    true,
  );
  await flushState(false);
}
export function storageAdapter(id: string) {
  const map = adapters.get(id) ?? new Map<string, string>();
  adapters.set(id, map);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (map.get(key) === value) return;
      map.set(key, value);
      dirtyArrangements.add(id);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        void flushState(false).catch(report);
      }, 400);
    },
    removeItem: (key: string) => {
      if (map.delete(key)) dirtyArrangements.add(id);
    },
  };
}
export async function flushState(flushEngine = true): Promise<void> {
  clearTimeout(persistTimer);
  if (flushEngine) window.dispatchEvent(new Event('pagehide'));
  await flushPreferences();
  const saved = {
    ...current.saved,
    workspaces: current.saved.workspaces.map((space) =>
      dirtyArrangements.has(space.id)
        ? { ...space, arrangement: Object.fromEntries(adapters.get(space.id) ?? []) }
        : space,
    ),
  };
  current = { ...current, saved };
  dirtyArrangements.clear();
  await window.viewer.save(saved);
}

export function receiveFileChanges(changes: FileChange[]): void {
  const map = pathMapper(changes);
  const saved = current.saved;
  update(
    {
      ...current,
      saved: {
        ...saved,
        workspaces: saved.workspaces.map((space) => ({
          ...space,
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
      quickPreview: current.quickPreview
        ? { ...current.quickPreview, paths: current.quickPreview.paths.map(map) }
        : null,
    },
    true,
  );
  for (const key of ['labels', 'locations', 'hidden'] as const)
    if (JSON.stringify(current.saved.ui.sidebar[key]) !== JSON.stringify(saved.ui.sidebar[key]))
      pendingPreferences.set('ui.sidebar.' + key, current.saved.ui.sidebar[key]);
  clearTimeout(preferenceTimer);
  preferenceTimer = setTimeout(() => {
    void flushPreferences().catch(report);
  }, 80);
  const folders = Object.fromEntries(
    Object.entries(current.settings.settings.folders).map(([path, value]) => [map(path), value]),
  );
  if (JSON.stringify(folders) !== JSON.stringify(current.settings.settings.folders)) {
    current = {
      ...current,
      settings: { ...current.settings, settings: { ...current.settings.settings, folders } },
    };
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

export function folderPresentation(path: string): FolderPresentation {
  return resolveFolderPresentation(path, current.settings.settings, current.saved.ui);
}
export function useFolderPresentation(path: string): FolderPresentation {
  const browsing = useViewer((state) => state.settings.settings.browsing);
  const override = useViewer((state) => state.settings.settings.folders[path]);
  const list = useViewer((state) => state.saved.ui.list);
  return useMemo(() => folderPresentation(path), [path, browsing, override, list]);
}
export function updateFolderPresentation(path: string, patch: FolderOverride | null): void {
  const folders = { ...current.settings.settings.folders };
  if (patch === null) delete folders[path];
  else
    folders[path] = {
      ...folders[path],
      ...patch,
      ...(patch.list ? { list: { ...folders[path]?.list, ...patch.list } } : {}),
    };
  const settings = { ...current.settings.settings, folders };
  const saved = {
    ...current.saved,
    workspaces: current.saved.workspaces.map((space) => ({
      ...space,
      panes: space.panes.map((pane) =>
        pane.type === 'folder' && pane.path === path
          ? {
              ...pane,
              ...panePresentation(resolveFolderPresentation(path, settings, current.saved.ui)),
            }
          : pane,
      ),
    })),
  };
  update({ ...current, settings: { ...current.settings, settings }, saved }, true);
  if (patch === null)
    pendingPreferences.set('@' + JSON.stringify(['settings', 'folders', path]), null);
  else
    for (const [key, value] of Object.entries(patch))
      pendingPreferences.set(
        '@' + JSON.stringify(['settings', 'folders', path, key]),
        key === 'list' ? folders[path].list : value,
      );
  clearTimeout(preferenceTimer);
  preferenceTimer = setTimeout(() => {
    void flushPreferences().catch(report);
  }, 80);
}
export function useFolderAsDefaults(path: string): void {
  const value = folderPresentation(path);
  const { list, mode, sort, descending, showHidden, density, foldersFirst, group, columnWidth } =
    value;
  void window.viewer
    .settingsPatch(
      [
        {
          path: 'settings.browsing',
          value: {
            ...current.settings.settings.browsing,
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
      current.settings.revision,
    )
    .then(receiveSettings)
    .catch(report);
}
export function receiveSettings(snapshot: SettingsSnapshot): void {
  if (snapshot.revision < current.settings.revision) return;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const next = structuredClone({ ui: snapshot.ui, settings: snapshot.settings });
  for (const [path, value] of pendingPreferences) {
    const keys: string[] = path.startsWith('@') ? JSON.parse(path.slice(1)) : path.split('.');
    let object = next as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      object[key] ||= {};
      object = object[key] as Record<string, unknown>;
    }
    if (value === null && keys[1] === 'folders') delete object[keys.at(-1)!];
    else object[keys.at(-1)!] = value;
  }
  const { ui, settings } = next;
  for (const [path, override] of Object.entries(settings.folders))
    if (same(override, current.settings.settings.folders[path]))
      settings.folders[path] = current.settings.settings.folders[path];
  for (const key of Object.keys(ui) as (keyof typeof ui)[])
    if (same(ui[key], current.saved.ui[key])) Object.assign(ui, { [key]: current.saved.ui[key] });
  for (const key of Object.keys(settings) as (keyof typeof settings)[])
    if (same(settings[key], current.settings.settings[key]))
      Object.assign(settings, { [key]: current.settings.settings[key] });
  const workspaces = current.saved.workspaces.map((space) => {
    let changed = false;
    const panes = space.panes.map((pane) => {
      if (pane.type !== 'folder') return pane;
      const value = panePresentation(resolveFolderPresentation(pane.path, settings, ui));
      if (Object.entries(value).every(([key, value]) => pane[key as keyof typeof pane] === value))
        return pane;
      changed = true;
      return { ...pane, ...value };
    });
    return changed ? { ...space, panes } : space;
  });
  update({
    ...current,
    settings: { ...snapshot, settings, ui },
    saved: {
      ...current.saved,
      workspaces,
      ui,
      look: snapshot.look,
      preferencesRevision: snapshot.revision,
    },
  });
}
export function addSearchPane(
  query: string,
  name: string,
  root?: string,
  recursive = true,
  content = false,
): string {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('Close a plane before adding another.');
  const pane: Pane = {
    id: uuid(),
    type: 'search',
    recursive,
    content,
    path: root || current.bootstrap.home,
    query,
    name,
    allLocations: !root,
  };
  changeWorkspace((space) => ({
    ...space,
    roots: [...space.roots, pane.id],
    panes: [...space.panes, pane],
    activePane: pane.id,
  }));
  savePatch({ version: Math.max(2, current.saved.version) as 2 | 3 });
  setActivePane(pane.id);
  return pane.id;
}

export function addTerminalPane(
  path: string,
  profileID: string,
  root: boolean,
): import('../../domain/contracts').TerminalPane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('Close a plane before opening another.');
  const pane: import('../../domain/contracts').TerminalPane = {
    id: uuid(),
    type: 'terminal',
    path,
    profileID,
  };
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, pane],
    roots: root ? [...space.roots, pane.id] : space.roots,
    activePane: pane.id,
  }));
  savePatch({ version: 3 });
  setActivePane(pane.id);
  return pane;
}
