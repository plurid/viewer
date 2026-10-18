import type { CameraDelta, CameraState, TreePlane, TreePlaneLocation } from '@plurid/plurid-data';
import type { PlaneLayoutEdit, PlaneSizeFraction } from '../../domain/plane-layout';

/** The same gutters as the two-folder views, so independently sized planes tile exactly. */
const gap = 12;
const fractionSize = (length: number, [numerator, denominator]: PlaneSizeFraction) =>
  ((length + gap) * numerator) / denominator - gap;
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

/** Frontmost corner of all sheets, including rotated planes. */
export function frontPlaneDepth(nodes: TreePlane[]) {
  return (
    Math.max(
      ...nodes.map((node) => {
        const x = (node.location.rotateX * Math.PI) / 180;
        const y = (node.location.rotateY * Math.PI) / 180;
        return (
          node.location.translateZ +
          Math.abs(node.width * Math.sin(y) * Math.cos(x)) +
          Math.abs(node.height * Math.sin(x))
        );
      }),
    ) + 1
  );
}

/** Author one plane in the viewport's tiling grid; other planes retain their geometry. */
export function planeLayoutGeometry(
  view: { width: number; height: number },
  area: { x: number; y: number; width: number; height: number },
  plane: Pick<TreePlane, 'width' | 'height' | 'location'>,
  camera: CameraState,
  edit: PlaneLayoutEdit,
  depth: number,
) {
  const width = edit.width
    ? fractionSize(area.width, edit.width)
    : Math.min(plane.width, area.width);
  const height = edit.height
    ? fractionSize(area.height, edit.height)
    : Math.min(plane.height, area.height);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('The workspace is too small. Enlarge the window.');
  // At natural scale the camera's pivot and screen pan define a shared grid. Keeping
  // them makes successive width/height/alignment commands compose without recentering.
  const originX = camera.pivot.x + area.x - view.width / 2 - camera.offset.x;
  const originY = camera.pivot.y + area.y - view.height / 2 - camera.offset.y;
  const x =
    edit.x === undefined
      ? clamp(plane.location.translateX - originX, area.width - width)
      : (area.width - width) * edit.x;
  const y =
    edit.y === undefined
      ? clamp(plane.location.translateY - originY, area.height - height)
      : (area.height - height) * edit.y;
  const location: TreePlaneLocation = {
    translateX: originX + x,
    translateY: originY + y,
    translateZ: depth,
    rotateX: 0,
    rotateY: 0,
  };
  const framing: CameraDelta = {
    absolute: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      scale: 1,
      pivot: { x: camera.pivot.x, y: camera.pivot.y, z: depth },
      offset: { x: camera.offset.x, y: camera.offset.y, z: 0 },
    },
  };
  return { width, height, location, camera: framing };
}
