// Saving workspace state: engine arrangements, retained preview values and the debounced save.
import { flushBuffers } from '../editing/buffers';
import { flushMediaDrafts } from '../media/drafts';
import { flushChatDrafts } from '../chat/drafts';
import { flushNotes } from '../notes/sessions';
import { CURRENT_STATE_VERSION, type Pane, type SavedState } from '../../domain/contracts';
import { previewValuesSchema, type JSONValue } from '../../domain/workspaces/project';
import { activeWorkspace, getState, replaceState, report } from './core';
import { flushPreferences } from './preferences';
import { installPersistenceScheduler } from './persistence-request';
import { boundPreviewHistory, rememberFileView } from '../../domain/previews/history';

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let pendingEngineFlush = false;
let flushRequested = false;
let flushing: Promise<void> | undefined;
let nextArrangementRevision = 0;
/** Saves after a quiet period; a later request replaces an earlier one. */
export function schedulePersist(flushEngine: boolean): void {
  pendingEngineFlush ||= flushEngine;
  clearTimeout(persistTimer);
  if (flushing) {
    flushRequested = true;
    return;
  }
  persistTimer = setTimeout(() => {
    void flushState(pendingEngineFlush).catch(report);
  }, 400);
}
export const adapters = new Map<string, Map<string, string>>();
const dirtyArrangements = new Map<string, number>();
// Host records survive an arrangement undo in memory, never as unreferenced saved panes.
export const closedPanes = new Map<string, Map<string, { pane: Pane; root: boolean }>>();
export function resetPersistence(): void {
  clearTimeout(persistTimer);
  pendingEngineFlush = false;
  flushRequested = false;
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
      dirtyArrangements.set(id, ++nextArrangementRevision);
      schedulePersist(false);
    },
    removeItem: (key: string) => {
      if (map.delete(key)) {
        dirtyArrangements.set(id, ++nextArrangementRevision);
        schedulePersist(false);
      }
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
async function flushOnce(flushEngine: boolean): Promise<void> {
  if (flushEngine) window.dispatchEvent(new Event('pagehide'));
  // unsaved text first: a quit waits for this flush
  await flushBuffers();
  await flushNotes();
  await flushMediaDrafts();
  await flushChatDrafts();
  // After the engine's synchronous flush: a save it scheduled is covered by this one.
  clearTimeout(persistTimer);
  await flushPreferences();
  const arrangementRevisions = new Map(dirtyArrangements);
  const saved = {
    ...getState().saved,
    previewStates: retainedPreviewStates(),
    previewHistory:
      getState().saved.previewHistory &&
      boundPreviewHistory(
        getState().saved.previewHistory!,
        new Set(getState().saved.workspaces.map((space) => space.id)),
      ),
    workspaces: getState().saved.workspaces.map((space) =>
      dirtyArrangements.has(space.id)
        ? { ...space, arrangement: Object.fromEntries(adapters.get(space.id) ?? []) }
        : space,
    ),
  };
  replaceState({ ...getState(), saved });
  await window.viewer.save(saved);
  for (const [id, revision] of arrangementRevisions)
    if (dirtyArrangements.get(id) === revision) dirtyArrangements.delete(id);
}

/** All callers join the same durable barrier, including work arriving during a save. */
export function flushState(flushEngine = true): Promise<void> {
  clearTimeout(persistTimer);
  pendingEngineFlush ||= flushEngine;
  flushRequested = true;
  if (flushing) return flushing;
  const work = Promise.resolve()
    .then(async () => {
      while (flushRequested) {
        flushRequested = false;
        const engine = pendingEngineFlush;
        pendingEngineFlush = false;
        await flushOnce(engine);
      }
    })
    .finally(() => {
      if (flushing === work) flushing = undefined;
    });
  flushing = work;
  return work;
}

installPersistenceScheduler(schedulePersist);

export function previewValues(
  paneID: string,
  owner = activeWorkspace().id,
): Record<string, JSONValue> {
  const state = getState().saved;
  const own = state.previewStates?.[owner + ':' + paneID];
  if (own) return own;
  const pane = state.workspaces
    .find((space) => space.id === owner)
    ?.panes.find((pane) => pane.id === paneID);
  return pane?.type === 'preview'
    ? (state.previewHistory?.[owner]?.find((entry) => entry.path === pane.path)?.values ?? {})
    : {};
}
export function savePreviewValue(
  paneID: string,
  key: string,
  value: unknown,
  owner = activeWorkspace().id,
  resetView = false,
): boolean {
  const pane = getState()
    .saved.workspaces.find((space) => space.id === owner)
    ?.panes.find((pane) => pane.id === paneID);
  if (!pane) return false;
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
      previewHistory:
        pane.type === 'preview'
          ? rememberFileView(getState().saved.previewHistory, owner, pane.path, parsed.data)
          : getState().saved.previewHistory,
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

/** Quick Preview and embedded views share file recall without becoming saved planes. */
export function rememberPreviewFile(
  owner: string,
  path: string,
  values: Record<string, JSONValue>,
): void {
  if (!getState().saved.workspaces.some((space) => space.id === owner)) return;
  replaceState({
    ...getState(),
    saved: {
      ...getState().saved,
      previewHistory: rememberFileView(getState().saved.previewHistory, owner, path, values),
    },
  });
  schedulePersist(false);
}
