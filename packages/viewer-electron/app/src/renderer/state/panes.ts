import { effectiveWindowSettings } from './effective-ui';
// Planes in the active workspace: creation, navigation, history and removal.
import type {
  FolderPane,
  Pane,
  PaneSidebar,
  NewRootFolderTarget,
  ScratchPane,
  TerminalPane,
  DiffPane,
  GitChangesPane,
  ChatPane,
  ServerPane,
  JournalPane,
  BrowserPane,
  MediaPane,
  NotePane,
  TaskPane,
  ReceiptPane,
  PreviewPane,
} from '../../domain/contracts';
import { normalizePreferences } from '../../domain/preferences/ui';
import { trimSessions } from '../workspace/sessions';
import { parentPath } from '../../domain/workspaces/planes';
import { languageFor } from '../../domain/editing/languages';
import { defaultSettings, newPlaneFolder } from '../../domain/services';
import {
  panePresentation,
  resolveFolderPresentation,
} from '../../domain/preferences/folder-presentation';
import {
  activeWorkspace,
  announce,
  changeWorkspace,
  getState,
  savePatch,
  update,
  uuid,
} from './core';
import { closedPanes } from './persistence';
import { remember } from './places';
import { folderPresentation, updateFolderPresentation } from './presentation';

export const folderPane = (path: string, sidebar?: PaneSidebar): FolderPane => ({
  id: uuid(),
  type: 'folder',
  path,
  ...panePresentation(
    getState()
      ? folderPresentation(path)
      : resolveFolderPresentation(path, defaultSettings(''), normalizePreferences()),
  ),
  history: [path],
  historyIndex: 0,
  sidebar,
});
export function setActivePane(id: string): void {
  if (getState().activePane !== id) {
    update(
      {
        ...getState(),
        activePane: id,
        saved: {
          ...getState().saved,
          workspaces: getState().saved.workspaces.map((space) =>
            space.id === getState().saved.activeWorkspace
              ? { ...space, activePane: id || undefined }
              : space,
          ),
        },
      },
      true,
    );
  }
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
    ...(pane?.type === 'note'
      ? {
          taskAreas: space.taskAreas?.map((area) => ({
            ...area,
            members: area.members.map((member) =>
              member.views.includes(id) && member.reference.kind === 'note'
                ? {
                    ...member,
                    title: ('title' in patch && patch.title) || pane.title,
                    reference: {
                      ...member.reference,
                      documentID: ('documentID' in patch && patch.documentID) || pane.documentID,
                    },
                  }
                : member,
            ),
          })),
        }
      : {}),
  }));
}
export function navigate(id: string, path: string, fromPair = false): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (!pane || pane.type !== 'folder' || pane.path === path) return;
  const previous = pane.path;
  const history = [...pane.history.slice(0, pane.historyIndex + 1), path].slice(-200);
  updatePane(id, {
    path,
    history,
    historyIndex: history.length - 1,
    ...panePresentation(folderPresentation(path)),
  });
  remember(path);
  if (!fromPair) followPair(id, previous, path);
}
/**
 * A folder plane's partner (2026-10-24), as a commander's other panel: the folder plane it is
 * paired with, while each names the other.
 */
export function pairOf(id: string): FolderPane | undefined {
  const panes = activeWorkspace().panes;
  const pane = panes.find((item) => item.id === id);
  if (pane?.type !== 'folder' || !pane.pair) return undefined;
  const partner = panes.find((item) => item.id === pane.pair);
  return partner?.type === 'folder' && partner.pair === id ? partner : undefined;
}
/** Two folder planes paired; a plane paired before with another lets it go. */
export function pairPanes(first: string, second: string): void {
  if (first === second) return;
  for (const id of [first, second]) {
    const before = pairOf(id);
    if (before && before.id !== first && before.id !== second)
      updatePane(before.id, { pair: undefined, pairSync: undefined });
  }
  updatePane(first, { pair: second, pairSync: undefined });
  updatePane(second, { pair: first, pairSync: undefined });
}
export function unpairPane(id: string): void {
  const partner = pairOf(id);
  updatePane(id, { pair: undefined, pairSync: undefined });
  if (partner) updatePane(partner.id, { pair: undefined, pairSync: undefined });
}
/** Whether the pair follows each other into subfolders and back up. */
export function setPairSync(id: string, on: boolean): void {
  const partner = pairOf(id);
  if (!partner) return;
  for (const pane of [id, partner.id]) updatePane(pane, { pairSync: on || undefined });
}
/**
 * The partner going where its pair went, when they follow each other: into the same subfolder,
 * or as many folders up. A jump elsewhere (Go to, a location) is the plane's own.
 */
function followPair(id: string, from: string, to: string): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  const partner = pairOf(id);
  if (pane?.type !== 'folder' || !pane.pairSync || !partner) return;
  const base = from.replace(/\/$/, '');
  const target = to.startsWith(base + '/')
    ? partner.path.replace(/\/$/, '') + to.slice(base.length)
    : from.startsWith(to.replace(/\/$/, '') + '/')
      ? Array.from({
          length: from.slice(to.replace(/\/$/, '').length + 1).split('/').length,
        }).reduce<string>((folder) => parentPath(folder), partner.path)
      : undefined;
  if (!target || target === partner.path) return;
  void window.viewer
    .stat(target)
    .then((entry) => {
      if (entry.directory && pairOf(id)?.id === partner.id) navigate(partner.id, entry.path, true);
    })
    .catch(() => announce(`The other folder has no ${target.split('/').pop()}.`));
}
export function historyNavigate(id: string, delta: number): void {
  const pane = activeWorkspace().panes.find((item) => item.id === id);
  if (pane?.type !== 'folder') return;
  const index = pane.historyIndex + delta;
  const target = index >= 0 ? pane.history[index] : undefined;
  if (target !== undefined)
    updatePane(id, {
      path: target,
      historyIndex: index,
      ...panePresentation(folderPresentation(target)),
    });
}
export function addPane(
  path: string,
  type: 'folder' | 'preview',
  root: boolean,
  options?: {
    keepSeparate?: boolean;
    folderView?: Pick<FolderPane, 'mode' | 'sort' | 'descending' | 'showHidden'>;
    /** Explode folder opens many at once: they are not the person's visits. */
    remember?: boolean;
  },
): Pane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('This workspace has 200 planes. Close a plane or create another workspace.');
  const pane: Pane =
    type === 'folder'
      ? {
          ...folderPane(path, { visible: getState().saved.ui.sidebar.inNewPlanes, width: 210 }),
          ...options?.folderView,
        }
      : { id: uuid(), type, path, keepSeparate: options?.keepSeparate || undefined };
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, pane],
    roots: root ? [...space.roots, pane.id] : space.roots,
  }));
  if (options?.remember !== false) remember(path);
  return pane;
}

/** Register a typed content plane before the spatial adapter mounts its route. */
export function addContentPane(
  pane:
    | TaskPane
    | ReceiptPane
    | FolderPane
    | PreviewPane
    | TerminalPane
    | DiffPane
    | GitChangesPane
    | ChatPane
    | JournalPane
    | ServerPane
    | BrowserPane
    | MediaPane
    | NotePane,
  root = true,
): void {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('Close a plane before opening another.');
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, pane],
    roots: root ? [...space.roots, pane.id] : space.roots,
    activePane: pane.id,
  }));
  setActivePane(pane.id);
}

/** Server panes retain a folder identity only; their listening session is never saved. */
export function addServerPane(
  path: string,
  sourceIdentity: string,
  runtimeID: string = uuid(),
): ServerPane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('Close a plane before opening another.');
  const pane: ServerPane = { id: uuid(), type: 'server', path, sourceIdentity, runtimeID };
  changeWorkspace((space) => ({ ...space, panes: [...space.panes, pane] }));
  setActivePane(pane.id);
  return pane;
}
/** An explicit new explorer is a fresh root, independent even when its path is already open. */
export function addRootFolder(target: NewRootFolderTarget = {}): FolderPane | undefined {
  const space = activeWorkspace();
  if (target.workspaceID && target.workspaceID !== space.id) return;
  const owner = space.panes.find((pane) => pane.id === (target.paneID ?? getState().activePane));
  if (target.paneID && !owner) return;
  const path =
    target.path ??
    newPlaneFolder(
      effectiveWindowSettings(getState()).browsing,
      getState().bootstrap.home,
      owner?.type === 'folder' || owner?.type === 'terminal' || owner?.type === 'server'
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
/** The folder Save As starts in: the Desktop. */
export function desktopFolder(): string {
  const { home, platform, locations } = getState().bootstrap;
  return (
    locations.find((location) => location.name === 'Desktop')?.path ??
    home.replace(/[\\/]+$/, '') + (platform === 'win32' ? '\\' : '/') + 'Desktop'
  );
}
/** The first “Untitled n” no scratch plane of any workspace is called. */
function untitledName(): string {
  const used = new Set(
    getState().saved.workspaces.flatMap((space) =>
      space.panes.flatMap((pane) => (pane.type === 'scratch' && pane.title ? [pane.title] : [])),
    ),
  );
  for (let number = 1; ; number++) if (!used.has(`Untitled ${number}`)) return `Untitled ${number}`;
}
/**
 * A new scratch plane (2026-10-23): text kept in the profile until it is saved as a file or
 * discarded. A recovered buffer comes back with its own id, title and language.
 */
export function addScratchPane(
  options: { bufferID?: string; title?: string; language?: string } = {},
): ScratchPane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('This workspace has 200 planes. Close a plane or create another workspace.');
  const pane: ScratchPane = {
    id: uuid(),
    type: 'scratch',
    path: desktopFolder(),
    bufferID: options.bufferID ?? uuid(),
    title: options.title ?? untitledName(),
    // the language of the configured new-file extension: Markdown by default
    language:
      options.language ??
      languageFor({
        name: '',
        extension: effectiveWindowSettings(getState()).browsing.newFileExtension,
      })?.id ??
      'plaintext',
  };
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, pane],
    roots: [...space.roots, pane.id],
  }));
  return pane;
}
/** Replaces a plane's record, keeping its id and so its place: a scratch plane saved as a file. */
export function replacePane(id: string, pane: Pane): void {
  changeWorkspace((space) => ({
    ...space,
    panes: space.panes.map((item) => (item.id === id ? pane : item)),
  }));
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
      ...getState().saved.workspaces.flatMap((space) => space.panes.map((pane) => pane.id)),
      ...records.keys(),
    ]),
  );
  changeWorkspace((space) => ({
    ...space,
    panes: space.panes.filter((pane) => !removed.has(pane.id)),
    roots: space.roots.filter((root) => !removed.has(root)),
    activePane: space.activePane && removed.has(space.activePane) ? undefined : space.activePane,
  }));
  if (removed.has(getState().activePane)) setActivePane(activeWorkspace().panes[0]?.id || '');
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
  const [first] = restored;
  if (first && !activeWorkspace().panes.some((pane) => pane.id === getState().activePane))
    setActivePane(first.pane.id);
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
    path: root || getState().bootstrap.home,
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
  savePatch({ version: Math.max(2, getState().saved.version) as 2 | 3 });
  setActivePane(pane.id);
  return pane.id;
}

export function addTerminalPane(
  path: string,
  profileID: string,
  root: boolean,
  task?: Pick<TerminalPane, 'id' | 'gitAction'>,
): TerminalPane {
  if (activeWorkspace().panes.length >= 200)
    throw new Error('Close a plane before opening another.');
  const pane: TerminalPane = {
    id: task?.id ?? uuid(),
    type: 'terminal',
    path,
    profileID,
    ...(task?.gitAction ? { gitAction: task.gitAction } : {}),
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
