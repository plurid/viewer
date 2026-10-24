// Saving workspace state: engine arrangements, retained preview values and the debounced save.
import { flushBuffers } from '../editing/buffers';
import { flushChatDrafts } from '../chat/drafts';
import { CURRENT_STATE_VERSION, type Pane, type SavedState } from '../../domain/contracts';
import { previewValuesSchema, type JSONValue } from '../../domain/project';
import { activeWorkspace, getState, replaceState, report } from './core';
import { flushPreferences } from './preferences';

let persistTimer: ReturnType<typeof setTimeout> | undefined;
/** Saves after a quiet period; a later request replaces an earlier one. */
export function schedulePersist(flushEngine: boolean): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushState(flushEngine).catch(report);
  }, 400);
}
export const adapters = new Map<string, Map<string, string>>();
const dirtyArrangements = new Set<string>();
// Host records survive an arrangement undo in memory, never as unreferenced saved panes.
export const closedPanes = new Map<string, Map<string, { pane: Pane; root: boolean }>>();
export function resetPersistence(): void {
  clearTimeout(persistTimer);
  adapters.clear();
  dirtyArrangements.clear();
  closedPanes.clear();
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
      schedulePersist(false);
    },
    removeItem: (key: string) => {
      if (map.delete(key)) dirtyArrangements.add(id);
    },
  };
}
/** Preview state outlives its pane only while arrangement or workspace Undo can
 * still bring that pane back; otherwise it would grow until saving fails. */
function retainedPreviewStates(): SavedState['previewStates'] {
  const states = getState().saved.previewStates;
  if (!states) return states;
  const keep = new Set<string>();
  const workspaces = [...getState().saved.workspaces];
  const deleted = getState().deletedWorkspace;
  if (deleted) workspaces.push(deleted.workspace);
  for (const space of workspaces) {
    for (const pane of space.panes) keep.add(space.id + ':' + pane.id);
    for (const id of closedPanes.get(space.id)?.keys() ?? []) keep.add(space.id + ':' + id);
  }
  const entries = Object.entries(states);
  const kept = entries.filter(([key]) => keep.has(key));
  return kept.length === entries.length ? states : Object.fromEntries(kept);
}
export async function flushState(flushEngine = true): Promise<void> {
  if (flushEngine) window.dispatchEvent(new Event('pagehide'));
  // unsaved text first: a quit waits for this flush
  await flushBuffers();
  await flushChatDrafts();
  // After the engine's synchronous flush: a save it scheduled is covered by this one.
  clearTimeout(persistTimer);
  await flushPreferences();
  const saved = {
    ...getState().saved,
    previewStates: retainedPreviewStates(),
    workspaces: getState().saved.workspaces.map((space) =>
      dirtyArrangements.has(space.id)
        ? { ...space, arrangement: Object.fromEntries(adapters.get(space.id) ?? []) }
        : space,
    ),
  };
  replaceState({ ...getState(), saved });
  dirtyArrangements.clear();
  await window.viewer.save(saved);
}

export function previewValues(
  paneID: string,
  owner = activeWorkspace().id,
): Record<string, JSONValue> {
  return getState().saved.previewStates?.[owner + ':' + paneID] ?? {};
}
export function savePreviewValue(
  paneID: string,
  key: string,
  value: unknown,
  owner = activeWorkspace().id,
  resetView = false,
): boolean {
  if (
    !getState()
      .saved.workspaces.find((space) => space.id === owner)
      ?.panes.some((pane) => pane.id === paneID)
  )
    return false;
  const previous = previewValues(paneID, owner);
  const values = {
    ...(resetView
      ? Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('notes.')))
      : previous),
    [key]: value,
  };
  const parsed = previewValuesSchema.safeParse(values);
  // Callers that hold irreplaceable input (plane notes) report a refused save.
  if (!parsed.success) return false;
  // Preview pan/zoom already has local React state. Avoid invalidating all commands
  // on every pointer move; the private session write uses the usual debounce.
  replaceState({
    ...getState(),
    saved: {
      ...getState().saved,
      version: CURRENT_STATE_VERSION,
      previewStates: {
        ...getState().saved.previewStates,
        [owner + ':' + paneID]: parsed.data,
      },
      workspaces: getState().saved.workspaces.map((space) =>
        space.id === owner && space.project
          ? { ...space, project: { ...space.project, dirty: true } }
          : space,
      ),
    },
  });
  schedulePersist(false);
  return true;
}
