import type { SavedState, Workspace } from '../contracts';
import type { DefinitionCatalog, WorkspaceDefinition } from './definitions/schema';
import type { FoundKeyChange } from './found/catalog';

export function rekeyFoundLinks(
  workspaces: Workspace[],
  changes: readonly FoundKeyChange[],
): Workspace[] {
  let changed = false;
  const keys = new Map(changes.map((change) => [change.from, change.to]));
  const next = workspaces.map((space) => {
    const link = space.definition;
    const key = link?.source === 'found' ? keys.get(link.key) : undefined;
    if (!link || !key || key === link.key) return space;
    changed = true;
    return { ...space, definition: { ...link, key } };
  });
  return changed ? next : workspaces;
}

export function definitionLinkMatches(
  space: Workspace,
  definition?: WorkspaceDefinition,
): definition is WorkspaceDefinition {
  return (
    !!definition &&
    space.definition?.key === definition.key &&
    (space.definition.source !== 'found' || definition.source === 'found')
  );
}
export function linkedDefinition(space: Workspace, catalog?: DefinitionCatalog) {
  return catalog?.definitions.find((item) => definitionLinkMatches(space, item));
}

/**
 * A definition that opens more than one folder plane at its root: several planes, a plane of
 * another kind, tiling or its own look. Manage marks it Rich; the workspace offer names it.
 */
export function richDefinition(definition: WorkspaceDefinition): boolean {
  return (
    definition.planes.length > 1 ||
    definition.planes[0]?.plane.kind !== 'folder' ||
    !!definition.tiling ||
    !!definition.look
  );
}

export function definitionSourceNotice(
  space: Workspace,
  catalog?: DefinitionCatalog,
): string | undefined {
  if (!space.definition || !catalog || linkedDefinition(space, catalog)) return;
  const source = catalog.projectManager;
  const origin = space.definition.source;
  if (origin === 'standalone') return;
  if (origin === 'found') {
    if (catalog.found?.state === 'off') return 'Finding workspaces is off.';
    return catalog.found?.state === 'loading' ? undefined : 'Viewer no longer finds this folder.';
  }
  if (source.state === 'undecided')
    return 'VS Code Project Manager is not in use. Choose Use VS Code Projects in Manage Workspaces to restore its projects.';
  if (source.state === 'off')
    return 'VS Code Project Manager is not in use. Turn it on in Settings → Configuration → Workspace definitions.';
  if (source.state === 'absent' && source.enabled === undefined)
    return 'VS Code Project Manager’s list was not found. This workspace keeps its definition link.';
}

export function definitionWasRemoved(space: Workspace, catalog?: DefinitionCatalog): boolean {
  return (
    !!space.definition &&
    !!catalog &&
    (catalog.file.state === 'read' || catalog.file.state === 'absent') &&
    (space.definition.source === 'standalone' ||
      space.definition.source === 'found' ||
      (catalog.projectManager.state !== 'unreadable' &&
        catalog.projectManager.state !== 'needs-access')) &&
    (space.definition.source !== 'found' ||
      catalog.definitions.some(
        (item) => item.key === space.definition!.key && item.source !== 'found',
      ) ||
      (catalog.found?.state !== 'loading' && catalog.found?.state !== 'off')) &&
    (!definitionSourceNotice(space, catalog) || space.definition.source === 'found') &&
    !catalog.diagnostics.some(
      (issue) => issue.key === space.definition!.key && issue.level === 'error',
    ) &&
    !linkedDefinition(space, catalog)
  );
}

export function withDefinitionOrigins(
  workspaces: Workspace[],
  catalog: DefinitionCatalog,
): Workspace[];
export function withDefinitionOrigins(
  workspaces: readonly Workspace[],
  catalog: DefinitionCatalog,
): readonly Workspace[];
export function withDefinitionOrigins(
  workspaces: readonly Workspace[],
  catalog: DefinitionCatalog,
): readonly Workspace[] {
  const origins = new Map(
    catalog.definitions.map((definition) => [definition.key, definition.source]),
  );
  let changed = false;
  const next = workspaces.map((space) => {
    if (!space.definition || space.definition.source) return space;
    const source = origins.get(space.definition.key);
    if (!source) return space;
    changed = true;
    return { ...space, definition: { ...space.definition, source } };
  });
  return changed ? next : workspaces;
}

export const maximumWorkspaces = 1000;
export const recentWorkspaceLimit = 5;

export function isPristineWorkspace(space: Workspace, home: string, emptyLocation = home): boolean {
  const [only] = space.panes;
  return (
    space.name === 'Workspace' &&
    !space.project &&
    !space.definition &&
    space.panes.length === 1 &&
    only?.type === 'folder' &&
    (only.path === home || only.path === emptyLocation) &&
    space.roots.length === 1 &&
    space.roots[0] === only.id
  );
}

/** Keep the first recipe association while preserving later workspaces as ad-hoc workspaces. */
export function uniqueDefinitionLinks(workspaces: readonly Workspace[]): Workspace[] {
  const keys = new Set<string>();
  return workspaces.map((space) => {
    if (!space.definition) return space;
    const key = space.definition.key;
    if (!keys.has(key)) {
      keys.add(key);
      return space;
    }
    const { definition: _definition, ...independent } = space;
    return {
      ...independent,
      panes: independent.panes.map((pane) => {
        if (pane.type !== 'terminal') return pane;
        const { definitionPlane: _plane, ...terminal } = pane;
        return terminal;
      }),
    };
  });
}

/** Usage is shared across windows without replacing a newer visit with a stale snapshot. */
export function mergeWorkspaceVisits(
  workspaces: readonly Workspace[],
  ...histories: SavedState['workspaceVisits'][]
): Record<string, number> {
  return Object.fromEntries(
    workspaces.flatMap(({ id }) => {
      const last = Math.max(0, ...histories.map((history) => history?.[id] ?? 0));
      return last ? [[id, last]] : [];
    }),
  );
}
export function orderedWorkspaces(
  saved: Pick<SavedState, 'workspaces' | 'activeWorkspace' | 'workspaceVisits'>,
): Workspace[] {
  return saved.workspaces.toSorted(
    (a, b) =>
      Number(b.id === saved.activeWorkspace) - Number(a.id === saved.activeWorkspace) ||
      (saved.workspaceVisits?.[b.id] ?? 0) - (saved.workspaceVisits?.[a.id] ?? 0) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
export function recentWorkspaceIDs(
  saved: Pick<SavedState, 'workspaces' | 'activeWorkspace' | 'workspaceVisits'>,
): string[] {
  return orderedWorkspaces(saved)
    .filter(
      (workspace) =>
        workspace.id === saved.activeWorkspace || saved.workspaceVisits?.[workspace.id],
    )
    .slice(0, recentWorkspaceLimit)
    .map((workspace) => `workspace:${workspace.id}`);
}
