// The renderer state container: one immutable snapshot, change notification and saved-state patches.
import { useSyncExternalStore } from 'react';
import type {
  Bootstrap,
  OperationJob,
  SavedState,
  UIPreferences,
  Workspace,
} from '../../domain/contracts';
import type { SettingsSnapshot } from '../../domain/services';
import { errorMessage } from '../../domain/errors';
import { schedulePersist } from './persistence';

export interface ViewerState {
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
export const uuid = () => crypto.randomUUID();
export function activeWorkspace(state = current): Workspace {
  return state.saved.workspaces.find((workspace) => workspace.id === state.saved.activeWorkspace)!;
}
export function emit(): void {
  for (const listener of listeners) listener();
}
export function update(next: ViewerState, persist = false): void {
  current = next;
  emit();
  if (persist) schedulePersist(true);
}
export const getState = () => current;
/** Replaces the state without notifying subscribers, for saves and high-frequency values. */
export function replaceState(next: ViewerState): void {
  current = next;
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useViewer<T>(selector: (state: ViewerState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(current));
}
export function report(error: unknown): void {
  update({ ...current, notice: errorMessage(error) });
}
export function dismissNotice(): void {
  update({ ...current, notice: null });
}
export function savePatch(patch: Partial<SavedState>): void {
  update(
    {
      ...current,
      saved: { ...current.saved, ...patch, version: 4, ui: patch.ui ?? current.saved.ui },
    },
    true,
  );
}
export function changeWorkspace(transform: (space: Workspace) => Workspace): void {
  savePatch({
    workspaces: current.saved.workspaces.map((space) =>
      space.id === current.saved.activeWorkspace
        ? (() => {
            const next = transform(space);
            return next.project && next !== space
              ? { ...next, project: { ...next.project, dirty: true } }
              : next;
          })()
        : space,
    ),
  });
}
