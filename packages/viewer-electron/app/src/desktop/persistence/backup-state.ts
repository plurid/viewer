import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pane, SavedState, Workspace } from '../../domain/contracts';
import { CURRENT_STATE_VERSION } from '../../domain/contracts';
import type { DiffSource } from '../../domain/comparison/diff';
import type { TaskReference } from '../../domain/workspaces/tasks';
import { pruneTileTree } from '../../domain/workspaces/tiling';
import type { TileSplit } from '../../domain/workspaces/tiling';
import { pathMapper } from '../../domain/files/changes';
import type { FileChange } from '../../domain/files/changes';
import { fileViewValues } from '../../domain/previews/history';
import type { JSONValue } from '../../domain/workspaces/project';

// A directory before ".." may be a link. Only the filesystem knows its parent.
function backupPath(value: string): string {
  return path.isAbsolute(value)
    ? value.replace(/\/{2,}/g, '/').replace(/\/(?:\.\/)+/g, '/')
    : value;
}

function backupFolder(folder: string): string {
  if (!path.isAbsolute(folder)) return folder;
  return backupPath(folder + '/').slice(0, -1) || '/';
}

function relinkRoot(folder: string): string {
  const value = backupFolder(folder);
  const traversal = value.search(/\/\.\.(?:\/|$)/);
  if (traversal >= 0) return path.dirname(value.slice(0, traversal) || '/');
  return value;
}

export const backupPathMapper = (changes: FileChange[]) =>
  pathMapper(
    changes.map(({ source, destination }) => ({ source: backupFolder(source), destination })),
    backupPath,
  );

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
    space.layout?.stacks?.forEach((stack) => add(stack.id));
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

function routePane(value: JSONValue | undefined) {
  if (typeof value !== 'string') return;
  const leaf = value.slice(value.lastIndexOf('/') + 1);
  return leaf.split('@', 1)[0];
}

function object(value: JSONValue | undefined): value is Record<string, JSONValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pruneSnapshot(
  snapshot: Record<string, JSONValue>,
  excluded: Set<string>,
  panes: Set<string>,
  roots: Set<string>,
  reachable: Set<string>,
) {
  const space = snapshot.space;
  if (!object(space) || !Array.isArray(space.tree)) return;
  const instances = new Set<string>();
  const namesSession = (value: JSONValue | undefined) =>
    typeof value === 'string' && (instances.has(value) || excluded.has(routePane(value) ?? ''));
  type Branch = { node: JSONValue; into: JSONValue[]; parent?: JSONValue; promote?: boolean };
  const tree: JSONValue[] = [];
  const branches: Branch[] = space.tree.map((node) => ({ node, into: tree })).reverse();
  while (branches.length) {
    const { node, into, parent, promote } = branches.pop()!;
    if (!object(node)) continue;
    const children = Array.isArray(node.children) ? node.children : [];
    const omit = [node.route, node.sourceID, node.planeID].some(namesSession);
    let destination = into;
    if (omit) {
      if (typeof node.planeID === 'string') instances.add(node.planeID);
    } else {
      const pane = routePane(node.route) ?? routePane(node.sourceID);
      if (pane && panes.has(pane)) {
        reachable.add(pane);
        if (!parent) roots.add(pane);
      }
      if (promote) {
        delete node.spawnedByLinkID;
        if (parent) node.parentPlaneID = parent;
        else delete node.parentPlaneID;
      }
      into.push(node);
      if (Array.isArray(node.children)) {
        destination = [];
        node.children = destination;
      }
    }
    for (let index = children.length - 1; index >= 0; index--)
      branches.push({
        node: children[index]!,
        into: destination,
        parent: omit ? parent : node.planeID,
        promote: omit,
      });
  }
  space.tree = tree;
  for (const key of ['activePlaneID', 'isolatePlane', 'lastClosedPlane', 'dockingPlaneID'])
    if (namesSession(space[key])) space[key] = '';
  if (Array.isArray(space.selectedPlaneIDs))
    space.selectedPlaneIDs = space.selectedPlaneIDs.filter((id) => !namesSession(id));
  if (Array.isArray(space.links))
    space.links = space.links.filter(
      (link) =>
        object(link) && !namesSession(link.sourcePlaneID) && !namesSession(link.targetPlaneID),
    );
  if (object(space.stacks))
    for (const [key, stack] of Object.entries(space.stacks)) {
      if (!object(stack) || !Array.isArray(stack.planeIDs)) continue;
      stack.planeIDs = stack.planeIDs.filter((plane) => !namesSession(plane));
      if (stack.planeIDs.length < 2) delete space.stacks[key];
      else if (object(stack.previous))
        stack.previous = Object.fromEntries(
          Object.entries(stack.previous).filter(([plane]) => !namesSession(plane)),
        );
    }
  return JSON.stringify(snapshot);
}

function withoutExternalSessions(space: Workspace): Workspace {
  const excluded = new Set(
    space.panes
      .filter((pane) => pane.type === 'chat' && pane.externalSessionID)
      .map((pane) => pane.id),
  );
  const keep = (id: string) => !excluded.has(id);
  const taskAreas = space.taskAreas?.map((area) => ({
    ...area,
    members: area.members
      .filter(({ reference }) => reference.kind !== 'chat' || !reference.externalSessionID)
      .map((member) => ({ ...member, views: member.views.filter(keep) })),
  }));
  if (!excluded.size) return { ...space, taskAreas };
  const panes = space.panes.filter((pane) => keep(pane.id));
  const placements = space.layout?.placements
    .filter((item) => keep(item.id))
    .map((item) => (item.parent && !keep(item.parent) ? { ...item, parent: undefined } : item));
  const roots = new Set(space.roots.filter(keep));
  const remaining = new Set(panes.map((pane) => pane.id));
  const reachable = new Set(roots);
  for (const placement of placements ?? []) {
    reachable.add(placement.id);
    if (!placement.parent) roots.add(placement.id);
  }
  const namesSession = (token: string) => token.split(/[/@#]/).some((part) => excluded.has(part));
  const arrangement: Record<string, string> = {};
  for (const [key, text] of Object.entries(space.arrangement)) {
    if (namesSession(key)) continue;
    if (key === 'pluridState-viewer-' + space.id) {
      const value: JSONValue = JSON.parse(text);
      arrangement[key] =
        (object(value) && pruneSnapshot(value, excluded, remaining, roots, reachable)) || text;
      continue;
    }
    let referenced = false;
    try {
      JSON.parse(text, (key, item: unknown) => {
        referenced ||= namesSession(key) || (typeof item === 'string' && namesSession(item));
        return item;
      });
    } catch {
      referenced = namesSession(text);
    }
    if (!referenced) arrangement[key] = text;
  }
  for (const pane of panes) if (!reachable.has(pane.id)) roots.add(pane.id);
  const tiling = space.tiling;
  const tiles = tiling?.panes.filter(keep);
  return {
    ...space,
    panes,
    roots: [...roots],
    taskAreas,
    activePane: space.activePane && keep(space.activePane) ? space.activePane : panes[0]?.id,
    arrangement,
    layout: space.layout && {
      placements: placements ?? [],
      active: space.layout.active && keep(space.layout.active) ? space.layout.active : undefined,
      docked: space.layout.docked && keep(space.layout.docked) ? space.layout.docked : undefined,
      stacks: space.layout.stacks?.flatMap((stack) => {
        const members = stack.panes.filter(keep);
        return members.length < 2
          ? []
          : [
              {
                ...stack,
                panes: members,
                previous: Object.fromEntries(
                  Object.entries(stack.previous).filter(([id]) => keep(id)),
                ),
              },
            ];
      }),
    },
    tiling:
      tiling && tiles?.length
        ? {
            ...tiling,
            panes: tiles,
            tree: tiling.tree && pruneTileTree(tiling.tree, new Set(tiles)),
          }
        : undefined,
  };
}

/** Only state references are relinked; document text, URLs and commands remain literal. */
export function restoreBackupState(
  state: SavedState,
  ids: ReadonlyMap<string, string>,
  changes: FileChange[],
): SavedState {
  const id = (value: string) => ids.get(value) ?? value;
  const optionalID = (value: string | undefined) => (value === undefined ? undefined : id(value));
  const map = backupPathMapper(changes);
  const mapKeys = <T>(values: Record<string, T> | undefined) =>
    values && Object.fromEntries(Object.entries(values).map(([key, value]) => [map(key), value]));
  const workspaces = state.workspaces.map(withoutExternalSessions);
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
      case 'layout':
        return {
          ...base,
          sources: base.sources.map(map),
          quantities: mapKeys(base.quantities),
          thicknesses: mapKeys(base.thicknesses),
        };
      case 'canvas':
        return { ...base, canvasID: id(base.canvasID) };
      case 'chat':
        return { ...runtime(base), conversationID: id(base.conversationID) };
      case 'receipt':
        return { ...base, receiptID: id(base.receiptID) };
      case 'task':
        return { ...base, areaID: id(base.areaID) };
      case 'check':
        return { ...base, checkID: id(base.checkID) };
      case 'terminal':
        return {
          ...base,
          definitionPlane: undefined,
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
    ids.get(value) ??
    value.replace(/\/([^/@#]+)(?=@|#|$)/g, (_match, part: string) => '/' + id(part));
  const engine = (value: JSONValue, field?: string): JSONValue => {
    if (field === 'bookmarks') return value;
    if (typeof value === 'string') {
      if (
        field === undefined ||
        value.startsWith('plurid://') ||
        value.startsWith('/') ||
        /(?:ID|IDs)$/.test(field) ||
        ['id', 'isolatePlane', 'lastClosedPlane'].includes(field)
      )
        return token(value);
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => engine(item, field));
    if (object(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          field === undefined || field === 'previous' || field === 'stacks' ? token(key) : key,
          engine(item, field === undefined ? undefined : key),
        ]),
      );
    return value;
  };
  const arrangement = (space: Workspace) =>
    Object.fromEntries(
      Object.entries(space.arrangement).map(([key, text]) => {
        const prefix = ['pluridState-viewer-', 'pluridContent-viewer-'].find(
          (name) => key === name + space.id,
        );
        const storageKey = prefix ? prefix + id(space.id) : token(key);
        let value: JSONValue;
        try {
          value = JSON.parse(text);
        } catch (error) {
          if (prefix === 'pluridState-viewer-') throw error;
          return [storageKey, text];
        }
        const snapshot = prefix === 'pluridState-viewer-';
        const mapped = engine(value, snapshot ? 'snapshot' : undefined);
        if (
          snapshot &&
          object(mapped) &&
          object(mapped.space) &&
          Array.isArray(mapped.space.tree)
        ) {
          const catalog = new Set(space.panes.map((pane) => id(pane.id)));
          const nodes = [...mapped.space.tree];
          while (nodes.length) {
            const node = nodes.pop();
            if (!object(node)) continue;
            const references = [node.route, node.sourceID, node.planeID, node.parentPlaneID]
              .filter((value) => typeof value === 'string' && value.includes('/'))
              .map(routePane);
            if (object(node.routeDivisions)) {
              for (const key of ['plane', 'path']) {
                const division = node.routeDivisions[key];
                if (
                  object(division) &&
                  object(division.parameters) &&
                  typeof division.parameters.id === 'string'
                )
                  references.push(division.parameters.id);
              }
            }
            if (references.some((pane) => pane && !catalog.has(pane)))
              throw new Error('A saved workspace route refers to an unknown plane.');
            if (Array.isArray(node.children)) for (const child of node.children) nodes.push(child);
          }
        }
        return [storageKey, JSON.stringify(mapped)];
      }),
    );
  return {
    version: CURRENT_STATE_VERSION,
    look: state.look,
    ui: state.ui && {
      ...state.ui,
      insightsDismissed: mapKeys(state.ui.insightsDismissed),
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
    workspaceVisits:
      state.workspaceVisits &&
      Object.fromEntries(
        Object.entries(state.workspaceVisits).map(([owner, last]) => [id(owner), last]),
      ),
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
        workspaces.flatMap((space) =>
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
    workspaces: workspaces.map((space) => ({
      ...space,
      id: id(space.id),
      name: space.name.slice(0, 89) + ' (restored)',
      project: undefined,
      definition: undefined,
      epoch: undefined,
      panes: space.panes.map(pane),
      roots: space.roots.map(id),
      activePane: optionalID(space.activePane),
      arrangement: arrangement(space),
      layout: space.layout && {
        ...space.layout,
        active: optionalID(space.layout.active),
        docked: optionalID(space.layout.docked),
        placements: space.layout.placements.map((item) => ({
          ...item,
          id: id(item.id),
          parent: optionalID(item.parent),
        })),
        stacks: space.layout.stacks?.map((stack) => ({
          ...stack,
          id: id(stack.id),
          panes: stack.panes.map(id),
          previous: Object.fromEntries(
            Object.entries(stack.previous).map(([plane, previous]) => [id(plane), previous]),
          ),
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
    for (const pane of space.panes) {
      if (pane.type === 'layout') pane.sources.forEach((file) => folders.add(path.dirname(file)));
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
          'check',
          'git-changes',
          'search',
          'collection',
          'journal',
          'overview',
          'layout',
          'tools',
        ].includes(pane.type)
          ? pane.path
          : path.dirname(pane.path),
      );
    }
    space.taskAreas?.forEach((area) => folders.add(area.checkout.path));
  }
  const privateFolder = backupFolder(privateRoot);
  const privatePrefix = privateFolder === '/' ? '/' : privateFolder + '/';
  const candidates = new Set(
    [...folders]
      .filter((file) => path.isAbsolute(file))
      .map(relinkRoot)
      .filter((file) => file !== privateFolder && !file.startsWith(privatePrefix)),
  );
  return [...candidates]
    .filter((file) => {
      let parent = path.dirname(file);
      while (parent !== file) {
        if (candidates.has(parent)) return false;
        file = parent;
        parent = path.dirname(file);
      }
      return true;
    })
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}
