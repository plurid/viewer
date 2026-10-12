import type { TreePlane } from '@plurid/plurid-data';
export function flattenTree(tree: TreePlane[]): TreePlane[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
export function hostID(node: TreePlane): string {
  return node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';
}
