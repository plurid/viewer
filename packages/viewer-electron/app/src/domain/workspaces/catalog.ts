import type { SavedState, Workspace } from '../contracts';
import type { DefinitionCatalog } from './definitions/schema';

export function definitionWasRemoved(space: Workspace, catalog?: DefinitionCatalog): boolean {
  return !!space.definition && !!catalog &&
    (catalog.file.state === 'read' || catalog.file.state === 'absent') &&
    catalog.projectManager.state !== 'unreadable' && catalog.projectManager.state !== 'needs-access' &&
    !catalog.definitions.some((item) => item.key === space.definition!.key);
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
