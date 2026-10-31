import type { SavedState, Workspace } from '../contracts';

export const maximumWorkspaces = 1000;
export const recentWorkspaceLimit = 5;

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
