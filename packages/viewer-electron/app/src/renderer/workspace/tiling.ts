import type { RefObject } from 'react';
import { pluridStateModules, type PluridApplicationHandle } from '@plurid/plurid-react';
import { PLURID_PUBSUB_TOPIC, type TreePlane } from '@plurid/plurid-data';
import { tilingRects } from '../../domain/tiling';
import { activeWorkspace } from '../state/store';
import { setTiling } from '../state/workspaces';
import { flattenTree, hostID } from './tree';
import { cancelWorkspaceFraming, frameWorkspace } from './framing';
import { folderPairArea } from './folder-pair';
import { frontPlaneDepth } from './plane-layout';
import { rememberTiling } from './tiling-history';

/**
 * TILING IN THE SPACE (2026-10-23): the active workspace's tiled planes placed face-on in the space's
 * area, as one arrangement step, and the camera at natural scale so their text reads at its size.
 * New planes are waited for: a split adds one that mounts a moment later. A plane closed meanwhile
 * leaves the tiling.
 */
export function applyTiling(
  engine: RefObject<PluridApplicationHandle | null>,
  surface: RefObject<HTMLDivElement | null>,
  attempts = 60,
): void {
  const space = activeWorkspace();
  const tiling = space.tiling;
  const api = engine.current;
  const element = surface.current;
  if (!tiling || !api || !element) return;
  const panes = tiling.panes.filter((id) => space.panes.some((pane) => pane.id === id));
  if (panes.length !== tiling.panes.length) {
    setTiling(panes.length ? { ...tiling, panes } : undefined);
    if (!panes.length) return;
  }
  const previous = api.tree.get();
  const nodes = flattenTree(previous);
  const byPane = new Map(nodes.map((node) => [hostID(node), node]));
  if (panes.some((id) => !byPane.has(id))) {
    if (attempts > 0) requestAnimationFrame(() => applyTiling(engine, surface, attempts - 1));
    return;
  }
  const area = folderPairArea(element);
  const camera = api.camera.get();
  // the same grid as the plane layout commands: the camera's pivot and pan at natural scale
  const originX = camera.pivot.x + area.x - element.clientWidth / 2 - camera.offset.x;
  const originY = camera.pivot.y + area.y - element.clientHeight / 2 - camera.offset.y;
  const rects = tilingRects({ ...tiling, panes }, area);
  const placed = new Map(panes.map((id, index) => [byPane.get(id)!.planeID, rects[index]!]));
  // in front of every other plane; not of the tiles themselves, or each resize would move them nearer
  const others = nodes.filter((node) => !placed.has(node.planeID));
  const depth = others.length ? frontPlaneDepth(others) : 0;
  const replace = (tree: TreePlane[]): TreePlane[] =>
    tree.map((node) => {
      const next = node.children?.length ? { ...node, children: replace(node.children) } : node;
      const rect = placed.get(node.planeID);
      return rect
        ? {
            ...next,
            width: rect.width,
            height: rect.height,
            location: {
              translateX: originX + rect.x,
              translateY: originY + rect.y,
              translateZ: depth,
              rotateX: 0,
              rotateY: 0,
            },
            sizeMode: 'manual',
            manuallyPositioned: true,
            show: true,
          }
        : next;
    });
  cancelWorkspaceFraming(api);
  api.store.dispatch(pluridStateModules.space.actions.historyBegin());
  try {
    api.store.dispatch(
      pluridStateModules.space.actions.restoreArrangement({
        tree: replace(previous),
        links: api.getSnapshot().space.links,
      }),
    );
    api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.ISOLATE_PLANE, data: { planeID: '' } });
  } finally {
    api.store.dispatch(pluridStateModules.space.actions.historyEnd());
  }
  rememberTiling(api.tree.get(), { ...tiling, panes });
  frameWorkspace(engine, surface, panes, {
    camera: {
      absolute: {
        yaw: 0,
        pitch: 0,
        roll: 0,
        scale: 1,
        pivot: { x: camera.pivot.x, y: camera.pivot.y, z: depth },
        offset: { x: camera.offset.x, y: camera.offset.y, z: 0 },
      },
    },
  });
}
