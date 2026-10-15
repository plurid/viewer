// Project files installed as workspaces.
import type { Pane, Workspace } from '../../domain/contracts';
import { panePresentation, type FolderOverride } from '../../domain/folder-presentation';
import {
  projectReference,
  resolveProjectPath,
  type ProjectDocument,
  type ProjectAssociation,
  type ProjectLayout,
} from '../../domain/project';
import { activeWorkspace, changeWorkspace, getState, savePatch, update, uuid } from './core';
import { folderPane } from './panes';
import { adapters, flushState } from './persistence';
import { scopedPresentation } from './presentation';

export async function installProject(
  document: ProjectDocument,
  bindings?: Record<string, string>,
): Promise<void> {
  await flushState();
  const existing = getState().saved.workspaces.find(
    (space) => space.project?.file === document.file,
  );
  bindings ??= existing?.project?.bindings ?? {};
  if (!existing && getState().saved.workspaces.length >= 30)
    throw new Error('Close a workspace before opening another project.');
  const folders: Record<string, FolderOverride> = {};
  for (const item of document.definition.folders) {
    const file = resolveProjectPath(document.root, item.target, bindings);
    if (file) folders[file] = item.view;
  }
  const association: ProjectAssociation = { ...document, bindings, folders, dirty: false };
  const id = existing?.id ?? uuid();
  const panes: Pane[] = document.definition.planes.flatMap((plane): Pane[] => {
    const path = resolveProjectPath(document.root, plane.target, bindings);
    if (!path) return [];
    if (plane.type === 'folder')
      return [
        {
          ...folderPane(path, { visible: getState().saved.ui.sidebar.inNewPlanes, width: 210 }),
          id: plane.id,
          ...panePresentation(
            scopedPresentation(path, getState().settings.settings, getState().saved.ui, {
              project: association,
            } as Workspace),
          ),
        },
      ];
    if (plane.type === 'preview') return [{ id: plane.id, type: 'preview', path }];
    if (plane.type === 'collection')
      return [{ id: plane.id, type: 'collection', path, collectionID: plane.collectionID }];
    if (plane.type === 'terminal')
      return [
        { id: plane.id, type: 'terminal', path, profileID: plane.profileID, startOnOpen: false },
      ];
    return [
      {
        id: plane.id,
        type: 'search',
        path,
        query: plane.query,
        name: plane.name,
        allLocations: false,
        recursive: plane.recursive,
        content: plane.content,
      },
    ];
  });
  const available = new Set(panes.map((pane) => pane.id));
  const placements = document.definition.layout.placements
    .filter((plane) => available.has(plane.id))
    .map((plane) => ({
      ...plane,
      parent: plane.parent && available.has(plane.parent) ? plane.parent : undefined,
    }));
  const layout = {
    placements,
    active: available.has(document.definition.layout.active || '')
      ? document.definition.layout.active
      : panes[0]?.id,
    docked: available.has(document.definition.layout.docked || '')
      ? document.definition.layout.docked
      : undefined,
  };
  const workspace: Workspace = {
    id,
    epoch: (existing?.epoch ?? 0) + 1,
    name: document.definition.name,
    panes,
    roots: placements.filter((plane) => !plane.parent).map((plane) => plane.id),
    activePane: layout.active,
    arrangement: {},
    layout,
    project: association,
    collections: document.definition.collections?.flatMap((collection) => {
      const sources = collection.sources.flatMap(
        (target) => resolveProjectPath(document.root, target, bindings) ?? [],
      );
      return sources.length ? [{ ...collection, sources }] : [];
    }),
  };
  const previewStates = { ...getState().saved.previewStates };
  for (const pane of document.definition.planes)
    if (pane.state) previewStates[id + ':' + pane.id] = pane.state;
  adapters.set(id, new Map());
  savePatch({
    workspaces: existing
      ? getState().saved.workspaces.map((space) => (space.id === id ? workspace : space))
      : [...getState().saved.workspaces, workspace],
    activeWorkspace: id,
    previewStates,
  });
  update({ ...getState(), activePane: layout.active ?? '', quickPreview: null });
  await flushState(false);
}
export function associateProject(project: ProjectAssociation): void {
  changeWorkspace((space) => ({ ...space, name: project.definition.name, project }));
  // Association follows a successful explicit save, rather than a draft edit.
  savePatch({
    workspaces: getState().saved.workspaces.map((space) =>
      space.id === getState().saved.activeWorkspace
        ? { ...space, project: { ...project, dirty: false } }
        : space,
    ),
  });
}
/** Detach only the definition. The workspace, engine, previews and files stay open. */
export function closeProject(): void {
  if (!activeWorkspace().project) return;
  changeWorkspace((space) => ({ ...space, project: undefined }));
}
export function consumeProjectLayout(layout: ProjectLayout): void {
  savePatch({
    workspaces: getState().saved.workspaces.map((space) =>
      space.id === getState().saved.activeWorkspace
        ? {
            ...space,
            roots: layout.placements.filter((plane) => !plane.parent).map((plane) => plane.id),
            layout: undefined,
          }
        : space,
    ),
  });
}
export function projectFolderReferences(project: ProjectAssociation) {
  return [
    ...Object.entries(project.folders).map(([file, view]) => ({
      target: projectReference(project.root, file, project.bindings),
      view,
    })),
    ...project.definition.folders.filter(
      (item) => item.target.binding && !Object.hasOwn(project.bindings, item.target.binding),
    ),
  ];
}
