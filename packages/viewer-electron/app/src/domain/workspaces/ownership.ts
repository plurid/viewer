import type { Pane, Workspace } from '../contracts';
import type { WorkspaceDefinition } from './definitions/schema';
import { insideRoot, parentFolder } from './found/roots';

export interface DefinitionShare {
  definition: WorkspaceDefinition;
  planes: string[];
  share: number;
}
type DefinitionSharePurpose = 'ownership' | 'proposal';
const indexes = new WeakMap<readonly WorkspaceDefinition[], Map<string, WorkspaceDefinition>>();
function rootIndex(definitions: readonly WorkspaceDefinition[]) {
  let index = indexes.get(definitions);
  if (!index) {
    index = new Map();
    for (const item of definitions) {
      const previous = index.get(item.root);
      if (!previous || (previous.source === 'found' && item.source !== 'found'))
        index.set(item.root, item);
    }
    indexes.set(definitions, index);
  }
  return index;
}
export function owningDefinition(
  folder: string,
  definitions: readonly WorkspaceDefinition[],
): WorkspaceDefinition | undefined {
  const index = rootIndex(definitions);
  for (let root = folder; root !== '/'; root = parentFolder(root)) {
    const definition = index.get(root);
    if (definition) return definition;
  }
  return index.get('/');
}
export function supportedPlaneFolder(pane: Pane): string | undefined {
  if (pane.type === 'search' && pane.allLocations) return;
  if (pane.type === 'preview') return parentFolder(pane.path);
  if (['folder', 'terminal', 'scratch', 'search'].includes(pane.type)) return pane.path;
}
export function definitionShares(
  workspace: Workspace,
  definitions: readonly WorkspaceDefinition[],
  purpose: DefinitionSharePurpose = 'ownership',
): DefinitionShare[] {
  const supported = workspace.panes.filter((pane) =>
    ['folder', 'preview', 'terminal', 'scratch', 'search'].includes(pane.type),
  );
  const panes = supported.flatMap((pane) => {
    const folder = purpose === 'proposal'
      ? pane.type === 'preview' ? parentFolder(pane.path) : pane.path
      : supportedPlaneFolder(pane);
    return folder ? [{ pane, folder }] : [];
  });
  const counts = new Map<WorkspaceDefinition, string[]>();
  for (const { pane, folder } of panes) {
    const owner = owningDefinition(folder, definitions);
    if (owner) counts.set(owner, [...(counts.get(owner) ?? []), pane.id]);
  }
  return [...counts]
    .map(([definition, ids]) => ({ definition, planes: ids, share: ids.length / supported.length }))
    .sort(
      (a, b) =>
        b.planes.length - a.planes.length ||
        Number(a.definition.source === 'found') - Number(b.definition.source === 'found') ||
        a.definition.root.length - b.definition.root.length,
    );
}
export function mostlyIn(
  workspace: Workspace,
  definitions: readonly WorkspaceDefinition[],
): WorkspaceDefinition | undefined {
  const primary = definitionShares(workspace, definitions)[0];
  return primary && ((primary.planes.length >= 2 && primary.share >= 0.6) || primary.share === 1)
    ? primary.definition
    : undefined;
}
export function addsToDefinition(workspace: Workspace, definition: WorkspaceDefinition): boolean {
  const represented = definition.planes.map(({ plane }) => plane);
  return (
    workspace.panes.some((pane) => {
      const folder = supportedPlaneFolder(pane);
      if (!folder || !insideRoot(definition.root, folder)) return false;
      const index = represented.findIndex((plane) => {
        if (pane.type === 'folder' || pane.type === 'preview')
          return (
            plane.kind === (pane.type === 'preview' ? 'file' : 'folder') &&
            'path' in plane &&
            plane.path === pane.path
          );
        if (pane.type === 'terminal')
          return (
            plane.kind === 'terminal' &&
            plane.path === pane.path &&
            (plane.profileID ?? definition.terminalProfile ?? pane.profileID) === pane.profileID
          );
        if (pane.type === 'scratch') return plane.kind === 'scratch';
        return (
          pane.type === 'search' &&
          plane.kind === 'search' &&
          plane.root === pane.path &&
          plane.query === pane.query &&
          (plane.name ?? pane.name) === pane.name &&
          (plane.recursive ?? true) === (pane.recursive ?? true) &&
          (plane.content ?? false) === (pane.content ?? false)
        );
      });
      if (index < 0) return true;
      represented.splice(index, 1);
      return false;
    }) ||
    !!workspace.tiling ||
    !!workspace.spaceColor ||
    Object.keys(workspace.arrangement).length > 0
  );
}
