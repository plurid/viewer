import type { TreePlane } from '@plurid/plurid-data';
import type { FileEntry, Pane, Workspace } from '../../domain/contracts';
import { itemPlaneType, normalizedPanePath } from '../../domain/workspaces/planes';
export function flattenTree(tree: TreePlane[]): TreePlane[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
export function hostID(node: TreePlane): string {
  return node.routeDivisions.plane.parameters.id || node.routeDivisions.path.parameters.id || '';
}
const routeKinds: Record<Pane['type'], string> = {
  task: 'tasks',
  receipt: 'receipts',
  folder: 'folders',
  search: 'searches',
  terminal: 'terminals',
  collection: 'collections',
  preview: 'previews',
  // a scratch plane renders where a preview does, so Save As turns it into one in place
  scratch: 'previews',
  note: 'previews',
  diff: 'diffs',
  'git-changes': 'git-changes',
  chat: 'chats',
  server: 'servers',
  browser: 'browsers',
  media: 'media',
  layout: 'layouts',
  journal: 'journals',
  overview: 'overviews',
};
/** The engine route that renders a host pane; `hostID` maps a plane back to its pane. */
export function paneRoute(type: Pane['type'], id: string): string {
  return `/${routeKinds[type]}/${id}`;
}
/**
 * The roots the workspace surface hands the engine, a route a line: a stable string, so the engine's
 * `view` is rebuilt only when a route changes. A project layout lists every plane.
 */
export function surfaceRoutes(space: Pick<Workspace, 'layout' | 'panes' | 'roots'>): string {
  return (space.layout ? space.panes.map((pane) => pane.id) : space.roots)
    .map((id) => paneRoute(space.panes.find((item) => item.id === id)?.type ?? 'preview', id))
    .join('\n');
}
export function parentPaneID(tree: readonly TreePlane[], id: string): string | undefined {
  for (const node of tree) {
    if (node.children?.some((child) => hostID(child) === id)) return hostID(node);
    const parent = parentPaneID(node.children ?? [], id);
    if (parent) return parent;
  }
}
const linkKey = (type: 'folder' | 'preview', path: string) => type + '\0' + path;
const linkIndexes = new WeakMap<
  TreePlane[],
  { panes: Workspace['panes']; platform: string; links: Map<string, Map<string, string>> }
>();

/**
 * For each plane, its linked children by kind and path. Every file row asks for its link on
 * each render; the index is built once per change of the tree or the panes.
 */
function linkIndex(tree: TreePlane[], space: Workspace, platform: string) {
  const cached = linkIndexes.get(tree);
  if (cached?.panes === space.panes && cached.platform === platform) return cached.links;
  const links = new Map<string, Map<string, string>>();
  for (const node of flattenTree(tree)) {
    const id = hostID(node);
    if (links.has(id)) continue;
    const children = new Set((node.children ?? []).map(hostID));
    const byPath = new Map<string, string>();
    // the first matching pane, in the workspace's order
    for (const pane of space.panes)
      if (children.has(pane.id) && (pane.type === 'folder' || pane.type === 'preview')) {
        const key = linkKey(pane.type, normalizedPanePath(pane.path, platform));
        if (!byPath.has(key)) byPath.set(key, pane.id);
      }
    links.set(id, byPath);
  }
  linkIndexes.set(tree, { panes: space.panes, platform, links });
  return links;
}
export function linkedPaneID(
  tree: TreePlane[],
  space: Workspace,
  parentID: string,
  entry: Pick<FileEntry, 'path' | 'directory' | 'extension'>,
  platform: string,
): string | undefined {
  const key = linkKey(itemPlaneType(entry), normalizedPanePath(entry.path, platform));
  return linkIndex(tree, space, platform).get(parentID)?.get(key);
}
