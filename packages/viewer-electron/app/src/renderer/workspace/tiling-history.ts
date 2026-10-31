import type { TreePlane } from '@plurid/plurid-data';
import type { Tiling } from '../../domain/workspaces/tiling';
import { activeWorkspace } from '../state/store';
import { setTiling } from '../state/workspaces';
import { flattenTree, hostID } from './tree';

const histories = new Map<string, Map<string, Tiling | undefined>>();

function placementKey(tree: TreePlane[]): string {
  return JSON.stringify(
    flattenTree(tree)
      .map((node) => ({
        id: hostID(node),
        location: node.location,
        width: node.width,
        height: node.height,
        pinned: node.pinned,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

/** Geometry history belongs to Plurid; this bounded index restores the matching Viewer policy. */
export function rememberTiling(tree: TreePlane[], tiling: Tiling | undefined): void {
  const id = activeWorkspace().id;
  const history = histories.get(id) ?? new Map();
  histories.set(id, history);
  history.set(placementKey(tree), tiling && structuredClone(tiling));
  if (history.size > 100) history.delete(history.keys().next().value!);
  if (histories.size > 30) histories.delete(histories.keys().next().value!);
}

export function restoreTiling(tree: TreePlane[]): void {
  const history = histories.get(activeWorkspace().id);
  const key = placementKey(tree);
  if (history?.has(key)) setTiling(structuredClone(history.get(key)));
}

/** Restored geometry already embodies its policy; replaying it would create another history step. */
export function tilingIsPlaced(tree: TreePlane[]): boolean {
  const workspace = activeWorkspace();
  const tiling = workspace.tiling;
  const placed = histories.get(workspace.id)?.get(placementKey(tree));
  return (
    !!tiling &&
    !!placed &&
    placed.layout === tiling.layout &&
    placed.main === tiling.main &&
    placed.panes.length === tiling.panes.length &&
    placed.panes.every((id, index) => id === tiling.panes[index]) &&
    JSON.stringify(placed.tree) === JSON.stringify(tiling.tree)
  );
}
