import { ROOTS_GAP } from '@plurid/plurid-data';
import { pluridStateModules } from '@plurid/plurid-react';
import type { TreePlane, TreePlaneLocation } from '@plurid/plurid-data';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import { activeWorkspace, getState, subscribe } from '../state/core';
import { flattenTree, hostID } from './tree';

/** A plane as the space holds it: its top left corner, the way it faces and its size. */
export type PlaneBox = Pick<TreePlane, 'location' | 'width' | 'height'>;
export type PlaneSize = Pick<TreePlane, 'width' | 'height'>;
/** The sides of a plane a new one can open on, in the order they are tried. */
export type BesideSide = 'right' | 'left' | 'below' | 'above';
const sides: readonly BesideSide[] = ['right', 'left', 'below', 'above'];
/** Part of the anchor's face, in px from its top left corner: across it and down it. */
interface FaceRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const radians = Math.PI / 180;
/** A plane's own across direction in the space: the engine turns planes about the vertical only. */
function acrossOf(location: TreePlaneLocation) {
  return {
    x: Math.cos(location.rotateY * radians),
    z: -Math.sin(location.rotateY * radians),
  };
}
/** Where `plane` covers the anchor's face as seen face on, whatever its depth. */
function faceRect(plane: PlaneBox, anchor: TreePlaneLocation, fallback: PlaneSize): FaceRect {
  const across = acrossOf(anchor);
  const own = acrossOf(plane.location);
  const start =
    (plane.location.translateX - anchor.translateX) * across.x +
    (plane.location.translateZ - anchor.translateZ) * across.z;
  // a plane turned away from the anchor covers only a sliver of its face
  const end = start + (plane.width || fallback.width) * (own.x * across.x + own.z * across.z);
  const top = plane.location.translateY - anchor.translateY;
  return {
    left: Math.min(start, end),
    right: Math.max(start, end),
    top,
    bottom: top + (plane.height || fallback.height),
  };
}
const overlaps = (a: FaceRect, b: FaceRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
/** The face rect of the `step`-th place out on `side` of an anchor of size `anchor`. */
function slot(
  side: BesideSide,
  step: number,
  anchor: PlaneSize,
  size: PlaneSize,
  gap: number,
): FaceRect {
  const across = (step - 1) * (size.width + gap);
  const down = (step - 1) * (size.height + gap);
  const rect = (left: number, top: number) => ({
    left,
    right: left + size.width,
    top,
    bottom: top + size.height,
  });
  switch (side) {
    case 'right':
      return rect(anchor.width + gap + across, 0);
    case 'left':
      return rect(-(size.width + gap) - across, 0);
    case 'below':
      return rect(0, anchor.height + gap + down);
    case 'above':
      return rect(0, -(size.height + gap) - down);
  }
}

/**
 * Where a new independent plane of `size` opens beside `anchor`: facing the way the anchor faces,
 * top edges level, `gap` apart, on the first side with room. Right, left, below and above are
 * tried, then the same sides one place further out. A plane is in the way when it covers the place
 * as seen face on, at any depth, so the new plane is never hidden behind or in front of another.
 */
export function besideLocation(
  anchor: PlaneBox,
  size: PlaneSize,
  planes: readonly PlaneBox[],
  gap: number = ROOTS_GAP,
): TreePlaneLocation {
  const own = { width: anchor.width || size.width, height: anchor.height || size.height };
  const taken = planes.map((plane) => faceRect(plane, anchor.location, size));
  const across = acrossOf(anchor.location);
  const at = (place: FaceRect): TreePlaneLocation => ({
    ...anchor.location,
    translateX: anchor.location.translateX + across.x * place.left,
    translateY: anchor.location.translateY + place.top,
    translateZ: anchor.location.translateZ + across.z * place.left,
  });
  for (let step = 1; step <= taken.length + 1; step++)
    for (const side of sides) {
      const place = slot(side, step, own, size, gap);
      if (!taken.some((rect) => overlaps(rect, place))) return at(place);
    }
  // large planes all around: past the farthest one on the right, where nothing can be
  const left = Math.max(own.width, ...taken.map((rect) => rect.right)) + gap;
  return at({ left, right: left + size.width, top: 0, bottom: size.height });
}

/** The size the engine gives a plane it has not measured: `elements.plane`, by the engine's rule. */
function configuredSize(handle: PluridApplicationHandle): PlaneSize {
  const { configuration, space } = handle.getSnapshot();
  // `1`, or a number with a decimal up to `4`, is a share of the view; any other number is px
  const length = (value: number | undefined, extent: number) =>
    !value || value < 0
      ? 0
      : value === 1 || (!Number.isInteger(value) && value <= 4)
        ? value * extent
        : value;
  const width = length(configuration.elements.plane.width, space.viewSize.width);
  const height = length(configuration.elements.plane.height, space.viewSize.height);
  return { width, height: height || Math.max(200, Math.round(width * 0.7)) };
}
/**
 * A root that stays where it is: pinned, so the engine's layout leaves it, and at a fixed size, so
 * a resized window or a reload in another one cannot grow it over its neighbours.
 */
function held(node: TreePlane, size: PlaneSize): TreePlane {
  const sized = node.sizeMode === 'manual' || node.sizeMode === 'declared';
  if (node.manuallyPositioned && sized) return node;
  return {
    ...node,
    manuallyPositioned: true,
    ...(sized
      ? {}
      : {
          sizeMode: 'manual',
          width: node.width || size.width,
          height: node.height || size.height,
        }),
  };
}
/**
 * Writes the arrangement exactly. It is written while the engine applies the change that called for
 * it (a root opening or closing), so arrangement history records both as that one step.
 */
function write(handle: PluridApplicationHandle, tree: TreePlane[]): void {
  handle.store.dispatch({
    ...pluridStateModules.space.actions.restoreArrangement({
      tree,
      links: handle.getSnapshot().space.links,
    }),
    meta: { history: 'skip' },
  });
}
const sameIDs = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Roots open beside the plane in use, and no root moves when another opens or closes.
 *
 * The engine lays roots out by count (two columns of `ceil(n / 2)`), so each new root moved the
 * earlier ones and landed where one of them was. Whenever the engine's roots change, the ones its
 * layout still owns are put back where they were and held there (`held`), and a root the workspace
 * opened is moved beside the plane that was active as it opened (`besideLocation`). This happens
 * while the engine applies the change, before anything renders. A root someone placed (an Undo, a
 * split, a project layout) keeps its place, and a lone first root stays the layout's, fitted to the
 * window.
 *
 * Returns the function that stops it; one engine serves one workspace.
 */
export function placeRoots(handle: PluridApplicationHandle): () => void {
  const workspaceID = activeWorkspace().id;
  let roots = activeWorkspace().roots;
  let active = getState().activePane;
  /** Roots opened that the engine has not laid out yet, each with the pane active as it opened. */
  const waiting = new Map<string, string>();
  const stopWorkspace = subscribe(() => {
    const space = activeWorkspace();
    if (space.id !== workspaceID) return;
    const previous = { roots, active };
    roots = space.roots;
    active = getState().activePane;
    if (sameIDs(roots, previous.roots)) return;
    const laid = new Set(handle.tree.get().map(hostID));
    for (const id of waiting.keys()) if (!roots.includes(id)) waiting.delete(id);
    for (const id of roots)
      if (!previous.roots.includes(id) && !laid.has(id)) waiting.set(id, previous.active);
  });
  /** The tree with each waiting root the engine has laid out moved beside its anchor. */
  const placeArrived = (tree: TreePlane[], size: PlaneSize): TreePlane[] => {
    const unplaced = new Set(waiting.keys());
    let next = tree;
    for (const id of roots) {
      const node = next.find((root) => hostID(root) === id);
      const anchorID = waiting.get(id);
      if (!node || anchorID === undefined) continue;
      waiting.delete(id);
      const planes = flattenTree(next).filter((plane) => !unplaced.has(hostID(plane)));
      unplaced.delete(id);
      // the pane active as it opened, else the last root placed
      const anchor =
        planes.find((plane) => plane.show && hostID(plane) === anchorID) ??
        next.findLast((root) => root.show && root !== node && !unplaced.has(hostID(root)));
      if (!anchor || !node.show) continue;
      const placed: TreePlane = {
        ...node,
        location: besideLocation(anchor, size, planes),
        manuallyPositioned: true,
        sizeMode: 'manual',
        width: size.width,
        height: size.height,
      };
      next = next.map((root) => (root === node ? placed : root));
    }
    return next;
  };
  let previous = handle.tree.get();
  let writing = false;
  const stopEngine = handle.store.subscribe(() => {
    const tree = handle.tree.get();
    if (writing || tree === previous) return;
    const before = previous;
    previous = tree;
    if (
      !handle.getSnapshot().space.resolvedLayout ||
      activeWorkspace().id !== workspaceID ||
      // a project's arrangement places every plane itself (`restoreLayout`)
      activeWorkspace().layout ||
      sameIDs(tree.map(hostID), before.map(hostID))
    )
      return;
    const size = configuredSize(handle);
    const earlier = new Map(before.map((node) => [hostID(node), node]));
    // the layout's own roots, laid out again for the new count: back where they were, with the
    // linked planes the layout moved along with them
    const kept = tree.map((node) => {
      const was = earlier.get(hostID(node));
      if (!was || was.manuallyPositioned || node.manuallyPositioned) return node;
      return held({ ...node, location: was.location, children: was.children }, size);
    });
    const next = placeArrived(kept, size);
    if (next.every((node, index) => node === tree[index])) return;
    writing = true;
    try {
      write(handle, next);
    } finally {
      writing = false;
    }
    previous = handle.tree.get();
  });
  return () => {
    stopWorkspace();
    stopEngine();
  };
}
