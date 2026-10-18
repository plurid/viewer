import {
  PLURID_ENTITY_TOOLBAR,
  type CameraDelta,
  type TreePlaneLocation,
} from '@plurid/plurid-data';

const inset = 8;
const gap = 12;

/** Use the full canvas width, reserving only the bottom toolbar. */
export function folderPairArea(surface: HTMLElement) {
  let bottom = inset;
  const toolbar = surface.querySelector<HTMLElement>(
    `[data-plurid-entity="${PLURID_ENTITY_TOOLBAR}"]`,
  );
  if (toolbar) bottom = Math.max(bottom, toolbar.offsetHeight + inset);
  return {
    x: inset,
    y: inset,
    width: surface.clientWidth - inset * 2,
    height: surface.clientHeight - inset - bottom,
  };
}

/** Manual sizes include headers. A unit-scale camera keeps file text at its ordinary size. */
export function folderPairGeometry(
  view: { width: number; height: number },
  area: { x: number; y: number; width: number; height: number },
  origin: TreePlaneLocation,
  axis: 'x' | 'y',
) {
  if (area.width <= gap || area.height <= gap)
    throw new Error('The workspace is too small for two folder planes. Enlarge the window.');
  const width = axis === 'x' ? (area.width - gap) / 2 : area.width;
  const height = axis === 'y' ? (area.height - gap) / 2 : area.height;
  const first = { ...origin, rotateX: 0, rotateY: 0 };
  const second = {
    ...first,
    translateX: first.translateX + (axis === 'x' ? width + gap : 0),
    translateY: first.translateY + (axis === 'y' ? height + gap : 0),
  };
  const camera: CameraDelta = {
    absolute: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      scale: 1,
      pivot: {
        x: first.translateX + area.width / 2,
        y: first.translateY + area.height / 2,
        z: first.translateZ,
      },
      offset: {
        x: area.x + area.width / 2 - view.width / 2,
        y: area.y + area.height / 2 - view.height / 2,
        z: 0,
      },
    },
  };
  return { width, height, first, second, camera };
}
