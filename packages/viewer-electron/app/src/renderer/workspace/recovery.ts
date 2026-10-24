import type { TreePlane } from '@plurid/plurid-data';
import type { Workspace } from '../../domain/contracts';
import { normalizedPanePath } from '../../domain/workspaces/planes';

const hostID = (node: TreePlane) =>
  node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';

/** Plan a user-invoked recovery; never discard branches, pinned views, or explicit copies. */
export function repeatedPreviews(
  workspace: Workspace,
  tree: TreePlane[],
  active: string,
  platform: string,
): { keep: TreePlane; close: TreePlane[] }[] {
  const records = new Map(workspace.panes.map((pane) => [pane.id, pane]));
  const instances = new Map<string, number>();
  const count = (nodes: TreePlane[]) => {
    for (const node of nodes) {
      const id = hostID(node);
      instances.set(id, (instances.get(id) ?? 0) + 1);
      count(node.children ?? []);
    }
  };
  count(tree);
  const groups = new Map<string, TreePlane[]>();
  const visit = (nodes: TreePlane[]) => {
    for (const node of nodes) {
      visit(node.children ?? []);
      const pane = records.get(hostID(node));
      if (
        pane?.type !== 'preview' ||
        instances.get(pane.id) !== 1 ||
        pane.keepSeparate ||
        node.children?.length ||
        node.manuallyPositioned ||
        node.show === false
      )
        continue;
      const key = JSON.stringify([
        node.parentPlaneID ?? '',
        normalizedPanePath(pane.path, platform),
      ]);
      const group = groups.get(key) ?? [];
      group.push(node);
      groups.set(key, group);
    }
  };
  visit(tree);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => {
      const keep = group.find((node) => hostID(node) === active) ?? group[0];
      return keep ? [{ keep, close: group.filter((node) => node !== keep) }] : [];
    });
}
