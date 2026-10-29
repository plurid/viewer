import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pane, SavedState } from '../../domain/contracts';
import { CURRENT_STATE_VERSION } from '../../domain/contracts';
import type { DiffSource } from '../../domain/comparison/diff';
import type { TaskReference } from '../../domain/workspaces/tasks';
import type { TileSplit } from '../../domain/workspaces/tiling';
import { pathMapper, type FileChange } from '../../domain/files/changes';
import { fileViewValues } from '../../domain/previews/history';
import type { JSONValue } from '../../domain/workspaces/project';
import { containsPath } from '../files/containment';

const portableView = (values: Record<string, JSONValue>) => {
  const { _sourceVersion: _version, ...position } = fileViewValues(values);
  return position;
};

/** Restore identities belong to the new copy, including references in tasks and layout data. */
export function backupIdentityMap(state: SavedState, documents: readonly string[]) {
  const ids = new Map<string, string>();
  const add = (id: string) => {
    if (!ids.has(id)) ids.set(id, randomUUID());
  };
  for (const space of state.workspaces) {
    add(space.id);
    space.panes.forEach((pane) => {
      add(pane.id);
      if (pane.type === 'terminal' && pane.taskSessionID) add(pane.taskSessionID);
    });
    space.collections?.forEach((item) => add(item.id));
    space.taskAreas?.forEach((area) => {
      add(area.id);
      area.members.forEach((member) => {
        add(member.id);
        member.views.forEach(add);
        if (member.reference.kind === 'terminal') add(member.reference.sessionID);
      });
    });
  }
  documents.forEach(add);
  return ids;
}

/** Only state references are relinked; document text, URLs and commands remain literal. */
export function restoreBackupState(
  state: SavedState,
  ids: ReadonlyMap<string, string>,
  changes: FileChange[],
): SavedState {
  const id = (value: string) => ids.get(value) ?? value;
  const optionalID = (value: string | undefined) => (value === undefined ? undefined : id(value));
  const map = pathMapper(changes);
  const diff = (source: DiffSource): DiffSource =>
    source.kind === 'file'
      ? { ...source, path: map(source.path) }
      : source.kind === 'git'
        ? { ...source, repository: map(source.repository) }
        : source;
  const runtime = <
    T extends { runtimeID?: string; serverRuntimeID?: string; externalSessionID?: string },
  >(
    value: T,
  ) => {
    const {
      runtimeID: _runtime,
      serverRuntimeID: _server,
      externalSessionID: _agent,
      ...rest
    } = value;
    return rest;
  };
  const reference = (value: TaskReference): TaskReference => {
    const base = { ...value, path: map(value.path) };
    switch (base.kind) {
      case 'note':
        return { ...base, documentID: id(base.documentID) };
      case 'chat':
        return { ...runtime(base), conversationID: id(base.conversationID) };
      case 'receipt':
        return { ...base, receiptID: id(base.receiptID) };
      case 'terminal':
        return { ...base, sessionID: id(base.sessionID) };
      case 'browser':
        return { ...runtime(base), serverPath: base.serverPath && map(base.serverPath) };
      case 'server':
        return runtime(base);
      case 'diff':
        return { ...base, left: diff(base.left), right: diff(base.right) };
      default:
        return base;
    }
  };
  const pane = (value: Pane): Pane => {
    const base = { ...value, id: id(value.id), path: map(value.path) };
    switch (base.type) {
      case 'folder':
        return {
          ...base,
          history: base.history.map(map),
          pair: optionalID(base.pair),
          exploded: optionalID(base.exploded),
        };
      case 'preview':
        return {
          ...base,
          bufferID: optionalID(base.bufferID),
          evidence: base.evidence && { ...base.evidence, path: map(base.evidence.path) },
        };
      case 'scratch':
        return { ...base, bufferID: id(base.bufferID) };
      case 'note':
        return { ...base, documentID: id(base.documentID) };
      case 'media':
        return { ...base, draftID: id(base.draftID) };
      case 'chat':
        return { ...runtime(base), conversationID: id(base.conversationID) };
      case 'receipt':
        return { ...base, receiptID: id(base.receiptID) };
      case 'task':
        return { ...base, areaID: id(base.areaID) };
      case 'terminal':
        return {
          ...base,
          startOnOpen: false,
          gitAction: undefined,
          taskSessionID: optionalID(base.taskSessionID),
        };
      case 'browser':
        return { ...runtime(base), serverPath: base.serverPath && map(base.serverPath) };
      case 'server':
        return { ...runtime(base), sourceIdentity: undefined };
      case 'diff':
        return {
          ...base,
          bufferID: optionalID(base.bufferID),
          left: diff(base.left),
          right: diff(base.right),
        };
      default:
        return base;
    }
  };
  const split = (tree: TileSplit): TileSplit =>
    'pane' in tree
      ? { pane: id(tree.pane) }
      : { ...tree, first: split(tree.first), second: split(tree.second) };
  // Engine arrangement values contain only layout metadata. Replace exact identity tokens and
  // route segments, never substrings (old profiles may use a single-character plane ID).
  const token = (value: string) =>
    ids.has(value)
      ? id(value)
      : value
          .split('/')
          .map((part) => ids.get(part) ?? part)
          .join('/');
  const engine = (value: unknown, depth = 0): unknown => {
    if (depth > 100) throw new Error('The saved arrangement is too deeply nested.');
    if (typeof value === 'string') return token(value);
    if (Array.isArray(value)) return value.map((item) => engine(item, depth + 1));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [token(key), engine(item, depth + 1)]),
      );
    return value;
  };
  const arrangement = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        try {
          return [token(key), JSON.stringify(engine(JSON.parse(value)))];
        } catch {
          return [token(key), value];
        }
      }),
    );
  return {
    version: CURRENT_STATE_VERSION,
    look: state.look,
    ui: state.ui && {
      ...state.ui,
      sidebar: {
        ...state.ui.sidebar,
        locations: state.ui.sidebar.locations.map(map),
        hidden: state.ui.sidebar.hidden.map(map),
        labels: Object.fromEntries(
          Object.entries(state.ui.sidebar.labels).map(([key, label]) => [map(key), label]),
        ),
      },
    },
    activeWorkspace: id(state.activeWorkspace),
    favorites: state.favorites.map((item) => ({ ...item, path: map(item.path) })),
    recents: state.recents.map(map),
    visits:
      state.visits &&
      Object.fromEntries(Object.entries(state.visits).map(([key, value]) => [map(key), value])),
    lineHistory: state.lineHistory,
    promptHistory: state.promptHistory,
    previewStates:
      state.previewStates &&
      Object.fromEntries(
        state.workspaces.flatMap((space) =>
          space.panes.flatMap((item) => {
            const values = state.previewStates?.[space.id + ':' + item.id];
            return values ? [[id(space.id) + ':' + id(item.id), portableView(values)]] : [];
          }),
        ),
      ),
    previewHistory:
      state.previewHistory &&
      Object.fromEntries(
        Object.entries(state.previewHistory).map(([owner, entries]) => [
          id(owner),
          entries.map((entry) => ({
            ...entry,
            path: map(entry.path),
            values: portableView(entry.values),
          })),
        ]),
      ),
    workspaces: state.workspaces.map((space) => ({
      ...space,
      id: id(space.id),
      name: space.name.slice(0, 89) + ' (restored)',
      project: undefined,
      epoch: undefined,
      panes: space.panes.map(pane),
      roots: space.roots.map(id),
      activePane: optionalID(space.activePane),
      arrangement: arrangement(space.arrangement),
      layout: space.layout && {
        ...space.layout,
        active: optionalID(space.layout.active),
        docked: optionalID(space.layout.docked),
        placements: space.layout.placements.map((item) => ({
          ...item,
          id: id(item.id),
          parent: optionalID(item.parent),
        })),
      },
      tiling: space.tiling && {
        ...space.tiling,
        panes: space.tiling.panes.map(id),
        tree: space.tiling.tree && split(space.tiling.tree),
      },
      collections: space.collections?.map((item) => ({
        ...item,
        id: id(item.id),
        sources: item.sources.map(map),
      })),
      basket: space.basket?.map((item) => ({
        ...item,
        path: map(item.path),
        evidence: item.evidence && { ...item.evidence, path: map(item.evidence.path) },
      })),
      taskAreas: space.taskAreas?.map((area) => ({
        ...area,
        id: id(area.id),
        checkout: { ...area.checkout, path: map(area.checkout.path), identity: undefined },
        members: area.members.map((member) => ({
          ...member,
          id: id(member.id),
          views: member.views.map(id),
          reference: reference(member.reference),
        })),
      })),
    })),
  };
}

/** Shortest external folder ancestors are sufficient to relink all descendants in one choice. */
export function backupRoots(
  state: SavedState,
  privateRoot: string,
  extra: readonly string[],
): string[] {
  const folders = new Set(extra);
  for (const space of state.workspaces) {
    for (const pane of space.panes)
      folders.add(
        [
          'folder',
          'scratch',
          'note',
          'terminal',
          'chat',
          'server',
          'browser',
          'task',
          'receipt',
          'git-changes',
          'search',
          'collection',
          'journal',
        ].includes(pane.type)
          ? pane.path
          : path.dirname(pane.path),
      );
    space.taskAreas?.forEach((area) => folders.add(area.checkout.path));
  }
  const candidates = [...folders]
    .filter((file) => path.isAbsolute(file) && !containsPath(privateRoot, file))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates.filter(
    (file, index) => !candidates.slice(0, index).some((parent) => containsPath(parent, file)),
  );
}
