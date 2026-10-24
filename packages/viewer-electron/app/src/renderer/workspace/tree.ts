import type { TreePlane } from '@plurid/plurid-data';
import type { FileEntry, Pane, Workspace } from '../../domain/contracts';
import { normalizedPanePath } from '../../domain/planes';
export function flattenTree(tree: TreePlane[]): TreePlane[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
export function hostID(node: TreePlane): string {
  return node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';
}
const routeKinds: Record<Pane['type'], string> = {
  folder: 'folders',
  search: 'searches',
  terminal: 'terminals',
  collection: 'collections',
  preview: 'previews',
  // a scratch plane renders where a preview does, so Save As turns it into one in place
  scratch: 'previews',
  diff: 'diffs',
  'git-changes': 'git-changes',
  chat: 'chats',
};
/** The engine route that renders a host pane; `hostID` maps a plane back to its pane. */
export function paneRoute(type: Pane['type'], id: string): string {
  return `/${routeKinds[type]}/${id}`;
}
export function parentPaneID(tree: readonly TreePlane[], id: string): string | undefined {
  for (const node of tree) {
    if (node.children?.some((child) => hostID(child) === id)) return hostID(node);
    const parent = parentPaneID(node.children ?? [], id);
    if (parent) return parent;
  }
}
export function linkedPaneID(
  tree: TreePlane[],
  space: Workspace,
  parentID: string,
  entry: Pick<FileEntry, 'path' | 'directory'>,
  platform: string,
): string | undefined {
  const parent = flattenTree(tree).find((node) => hostID(node) === parentID);
  const children = new Set((parent?.children ?? []).map(hostID));
  const path = normalizedPanePath(entry.path, platform);
  return space.panes.find(
    (pane) =>
      children.has(pane.id) &&
      pane.type === (entry.directory ? 'folder' : 'preview') &&
      normalizedPanePath(pane.path, platform) === path,
  )?.id;
}
