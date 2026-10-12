import { pathMapper, type FileChange } from '../../domain/changes';
import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { FileEntry } from '../../domain/contracts';

/** Lightweight view state outlives Plurid's detached components. Keys are host IDs. */
export interface BrowseSession {
  path: string;
  selection: string[];
  query: string;
  subtree: boolean;
  searchOpen: boolean;
  pathOpen: boolean;
  anchor: string;
  cursor: string;
  scroll: number;
  expanded: string[];
  listChildren: Map<string, FileEntry[]>;
  columnTrail: string[];
  columnScope: string;
  columnDirectory: string;
  cache: Map<string, FileEntry>;
}
const sessions = new Map<string, BrowseSession>();
const historySessions = new Map<string, Map<string, BrowseSession>>();
const listeners = new Map<string, Set<() => void>>();
export function browseSession(id: string, path: string): BrowseSession {
  let state = sessions.get(id);
  if (!state || state.path !== path) {
    const history = historySessions.get(id) || new Map<string, BrowseSession>();
    historySessions.set(id, history);
    if (state) history.set(state.path, state);
    const previous = history.get(path);
    if (previous) {
      sessions.set(id, previous);
      return previous;
    }
    while (history.size > 20) history.delete(history.keys().next().value!);
    state = {
      path,
      selection: [],
      query: '',
      subtree: false,
      searchOpen: false,
      pathOpen: false,
      anchor: '',
      cursor: '',
      scroll: 0,
      expanded: [],
      listChildren: new Map(),
      columnTrail: [],
      columnScope: path,
      columnDirectory: path,
      cache: new Map(),
    };
    sessions.set(id, state);
  }
  return state;
}
export function useBrowseField<K extends keyof BrowseSession>(
  id: string,
  path: string,
  key: K,
): [BrowseSession[K], Dispatch<SetStateAction<BrowseSession[K]>>] {
  const initial = browseSession(id, path);
  const value = useSyncExternalStore(
    (listener) => {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    () => (sessions.get(id) ?? initial)[key],
  );
  const set = useCallback(
    (next: SetStateAction<BrowseSession[K]>) => {
      const state = sessions.get(id);
      if (!state || state.path !== path) return;
      const value =
        typeof next === 'function'
          ? (next as (value: BrowseSession[K]) => BrowseSession[K])(state[key])
          : next;
      if (Object.is(value, state[key])) return;
      state[key] = value;
      listeners.get(id)?.forEach((listener) => listener());
    },
    [id, path, key],
  );
  return [value, set];
}
export function clearSessions(): void {
  sessions.clear();
  historySessions.clear();
}
export function trimSessions(ids: ReadonlySet<string>): void {
  for (const id of sessions.keys())
    if (!ids.has(id)) {
      sessions.delete(id);
      historySessions.delete(id);
    }
}
export function selectedFiles(id: string): FileEntry[] {
  const session = sessions.get(id);
  return session?.selection.flatMap((path) => session.cache.get(path) ?? []) ?? [];
}
export function focusFiles(id: string): void {
  const until = performance.now() + 1500;
  const focus = () => {
    if (
      document.querySelector('dialog[open]') ||
      document.activeElement?.matches(
        'input, textarea, select, [contenteditable], [role=separator]',
      )
    )
      return;
    const control = Array.from(document.querySelectorAll<HTMLElement>('[data-viewer-plane]')).find(
      (el) => el.dataset.viewerPlane === id,
    );
    const target = control
      ?.closest('[data-plurid-plane]')
      ?.querySelector<HTMLElement>('.folder-explorer');
    if (target) target.focus({ preventScroll: true });
    else if (performance.now() < until) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}
/** Live topology is authoritative; reservations cover the interval before a spawn mounts. */
export function rootOwners<T extends { children?: T[] }>(
  tree: T[],
  host: (node: T) => string,
  roots: readonly string[],
  pending: ReadonlyMap<string, string>,
): Map<string, string> {
  const owners = new Map(pending);
  for (const id of roots) owners.set(id, id);
  const visit = (nodes: T[], root: string) => {
    for (const node of nodes) {
      owners.set(host(node), root);
      visit(node.children ?? [], root);
    }
  };
  for (const node of tree) visit([node], host(node));
  return owners;
}

export function remapSessions(changes: readonly FileChange[]): void {
  const map = pathMapper(changes);
  for (const [id, current] of sessions) {
    const states = new Set([current, ...(historySessions.get(id)?.values() || [])]);
    for (const state of states) {
      state.path = map(state.path);
      state.selection = state.selection.map((path) => map(path)).filter(Boolean);
      state.anchor = map(state.anchor);
      state.cursor = map(state.cursor);
      state.expanded = state.expanded.map((path) => map(path)).filter(Boolean);
      state.columnTrail = state.columnTrail.map((path) => map(path)).filter(Boolean);
      state.columnScope = map(state.columnScope);
      state.columnDirectory = map(state.columnDirectory);
      state.listChildren = new Map(
        [...state.listChildren].map(([parent, entries]) => [
          map(parent),
          entries.map((entry) => ({
            ...entry,
            path: map(entry.path),
            parent: map(entry.parent),
            name: map(entry.path).split('/').pop() || entry.name,
          })),
        ]),
      );
      const cache = new Map<string, FileEntry>();
      for (const entry of state.cache.values()) {
        const path = map(entry.path);
        cache.set(path, {
          ...entry,
          path,
          parent: map(entry.parent),
          name: path.split('/').pop() || entry.name,
        });
      }
      // Mounted, memoized selection handlers retain this Map. Preserve its identity
      // while replacing the entries after a batch rename, including cyclic swaps.
      state.cache.clear();
      for (const [path, entry] of cache) state.cache.set(path, entry);
    }
    if (historySessions.has(id))
      historySessions.set(
        id,
        new Map([...states].filter((state) => state.path).map((state) => [state.path, state])),
      );
    listeners.get(id)?.forEach((listener) => listener());
  }
}
