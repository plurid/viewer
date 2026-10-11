import { useSyncExternalStore } from 'react';
import type {
  Bootstrap,
  FolderPane,
  OperationJob,
  Pane,
  SavedState,
  UIPreferences,
  Workspace,
} from '../../domain/contracts';
import { normalizePreferences, reorder } from '../../domain/preferences';

interface ViewerState {
  saved: SavedState & { ui: UIPreferences };
  bootstrap: Bootstrap;
  jobs: OperationJob[];
  activePane: string;
  quickPreview: string | null;
  notice: string | null;
  operationsOpen: boolean;
  operationsHistory: boolean;
  acknowledgedJobs: string[];
  clipboard: { paths: string[]; cut: boolean } | null;
  deletedWorkspace: { workspace: Workspace; index: number; replacement?: string } | null;
}
let current: ViewerState;
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const adapters = new Map<string, Map<string, string>>();
// Host records survive an arrangement undo in memory, never as unreferenced saved panes.
const closedPanes = new Map<string, Map<string, { pane: Pane; root: boolean }>>();
const uuid = () => crypto.randomUUID();
export const folderPane = (path: string): FolderPane => ({
  id: uuid(),
  type: 'folder',
  path,
  mode: 'list',
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [path],
  historyIndex: 0,
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
  adapters.clear();
  closedPanes.clear();
  const pane = folderPane(bootstrap.home);
  const workspace: Workspace = {
    id: uuid(),
    name: 'Workspace',
    panes: [pane],
    roots: [pane.id],
    arrangement: {},
  };
  const original = bootstrap.state ?? {
    version: 1 as const,
    workspaces: [workspace],
    activeWorkspace: workspace.id,
    favorites: [],
    recents: [],
    look: 'dark' as const,
  };
  const saved = { ...original, ui: normalizePreferences(original.ui) };
  const active = activeWorkspace({ saved } as ViewerState);
  current = {
    bootstrap,
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
    update({ ...current, activePane: id });
    changeWorkspace((space) => ({ ...space, activePane: id || undefined }));
  }
}
export function quickPreview(path: string | null): void {
  update({ ...current, quickPreview: path });
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
  update({ ...current, jobs });
}
export function receiveJob(job: OperationJob): void {
  const old = current.jobs.find((item) => item.id === job.id);
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
function savePatch(patch: Partial<SavedState>): void {
  update(
    { ...current, saved: { ...current.saved, ...patch, ui: patch.ui ?? current.saved.ui } },
    true,
  );
}
export function changePreferences(transform: (ui: UIPreferences) => UIPreferences): void {
  savePatch({ ui: normalizePreferences(transform(current.saved.ui)) });
}
export function rememberCommand(id: string): void {
  changePreferences((ui) => ({
    ...ui,
    recentCommands: [id, ...ui.recentCommands.filter((item) => item !== id)].slice(0, 20),
  }));
}
export function setLook(look: 'dark' | 'light'): void {
  savePatch({ look });
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
  changeWorkspace((space) => ({
    ...space,
    panes: space.panes.map((pane) => (pane.id === id ? ({ ...pane, ...patch } as Pane) : pane)),
  }));
}
export function navigate(id: string, path: string): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (!pane || pane.type !== 'folder' || pane.path === path) return;
  const history = [...pane.history.slice(0, pane.historyIndex + 1), path].slice(-200);
  updatePane(id, { path, history, historyIndex: history.length - 1 });
  remember(path);
}
export function historyNavigate(id: string, delta: number): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (pane?.type !== 'folder') return;
  const index = pane.historyIndex + delta;
  if (index >= 0 && index < pane.history.length)
    updatePane(id, { path: pane.history[index], historyIndex: index });
}
export function remember(path: string): void {
  savePatch({
    recents: [path, ...current.saved.recents.filter((item) => item !== path)].slice(0, 50),
  });
}
export function addPane(path: string, type: 'folder' | 'preview', root: boolean): Pane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('This workspace has 200 planes. Close a plane or create another workspace.');
  const pane: Pane = type === 'folder' ? folderPane(path) : { id: uuid(), type, path };
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, pane],
    roots: root ? [...space.roots, pane.id] : space.roots,
  }));
  remember(path);
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
  const pane = folderPane(current.bootstrap.home);
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
      map.set(key, value);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        void flushState(false).catch(report);
      }, 400);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
export async function flushState(flushEngine = true): Promise<void> {
  clearTimeout(persistTimer);
  if (flushEngine) window.dispatchEvent(new Event('pagehide'));
  const saved = {
    ...current.saved,
    workspaces: current.saved.workspaces.map((space) => ({
      ...space,
      arrangement: Object.fromEntries(adapters.get(space.id) ?? []),
    })),
  };
  current = { ...current, saved };
  await window.viewer.save(saved);
}
