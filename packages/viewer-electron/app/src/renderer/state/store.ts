import { useSyncExternalStore } from 'react';
import type {
  Bootstrap,
  FolderPane,
  OperationJob,
  Pane,
  SavedState,
  Workspace,
} from '../../domain/contracts';

interface ViewerState {
  saved: SavedState;
  bootstrap: Bootstrap;
  jobs: OperationJob[];
  activePane: string;
  quickPreview: string | null;
  notice: string | null;
  operationsOpen: boolean;
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
  const pane = folderPane(bootstrap.home);
  const workspace: Workspace = {
    id: uuid(),
    name: 'Workspace',
    panes: [pane],
    roots: [pane.id],
    arrangement: {},
  };
  const saved = bootstrap.state ?? {
    version: 1,
    workspaces: [workspace],
    activeWorkspace: workspace.id,
    favorites: [],
    recents: [],
    look: 'dark',
  };
  const active = activeWorkspace({ saved } as ViewerState);
  current = {
    bootstrap,
    saved,
    jobs: [],
    activePane: active.activePane || active.panes[0]?.id || '',
    quickPreview: null,
    notice: bootstrap.recovery || null,
    operationsOpen: false,
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
export function setOperationsOpen(open: boolean): void {
  update({ ...current, operationsOpen: open });
}
export function setJobs(jobs: OperationJob[]): void {
  update({ ...current, jobs });
}
export function receiveJob(job: OperationJob): void {
  const old = current.jobs.find((item) => item.id === job.id);
  update({
    ...current,
    jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)].slice(0, 100),
    operationsOpen: current.operationsOpen || job.status === 'collision',
  });
  if (old && old.status !== job.status && ['completed', 'failed', 'cancelled'].includes(job.status))
    window.dispatchEvent(new CustomEvent('viewer:refresh'));
}
function savePatch(patch: Partial<SavedState>): void {
  update({ ...current, saved: { ...current.saved, ...patch } }, true);
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
  savePatch({
    favorites: current.saved.favorites.some((item) => item.path === path)
      ? current.saved.favorites.filter((item) => item.path !== path)
      : [...current.saved.favorites, { path, name }],
  });
}
export function toggleLook(): void {
  savePatch({ look: current.saved.look === 'dark' ? 'light' : 'dark' });
}
export async function switchWorkspace(id: string): Promise<void> {
  if (id === current.saved.activeWorkspace) return;
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
