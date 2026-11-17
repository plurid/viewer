import * as THREE from 'three';
import type { CSSProperties } from 'react';
import { defaultModelUp } from './navigation';
import type { ModelCamera } from './navigation';

export type CubeViewKind = 'face' | 'edge' | 'corner';
export type CubeStep = 'left' | 'right' | 'up' | 'down';
type CubeDirection = readonly [number, number, number];

/**
 * A standard view, named by the sides it shows. Its direction points from the model to the
 * camera in cube coordinates: x to the right, y to the top, z to the front.
 */
export interface CubeView {
  id: string;
  label: string;
  direction: CubeDirection;
  kind: CubeViewKind;
}

function cubeView(x: number, y: number, z: number): CubeView {
  const sides = [
    y > 0 ? 'top' : y < 0 ? 'bottom' : '',
    z > 0 ? 'front' : z < 0 ? 'back' : '',
    x > 0 ? 'right' : x < 0 ? 'left' : '',
  ].filter(Boolean);
  const name = sides.join(' ');
  return {
    id: sides.join('-'),
    label: name.charAt(0).toUpperCase() + name.slice(1),
    direction: [x, y, z],
    kind: sides.length === 1 ? 'face' : sides.length === 2 ? 'edge' : 'corner',
  };
}

const kinds: readonly CubeViewKind[] = ['face', 'edge', 'corner'];
const directions = [-1, 0, 1].flatMap((x) =>
  [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => [x, y, z] as const)),
);
const faceOrder = ['front', 'right', 'back', 'left', 'top', 'bottom'];

/** The 6 faces, 12 edges and 8 corners, faces first in the order a person reads them. */
export const cubeViews: readonly CubeView[] = directions
  .filter((direction) => direction.some(Boolean))
  .map(([x, y, z]) => cubeView(x, y, z))
  .sort(
    (a, b) =>
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      (a.kind === 'face' ? faceOrder.indexOf(a.id) - faceOrder.indexOf(b.id) : 0),
  );

const byDirection = new Map(cubeViews.map((view) => [view.direction.join(','), view]));

function viewAt(x: number, y: number, z: number): CubeView {
  return byDirection.get([x, y, z].join(','))!;
}

/** Headings around the model, turning right from the front, as x and z. */
const headings: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

/** The view's place around the model; the top and bottom have none. */
export function cubeHeading(view: CubeView): number | undefined {
  const [x, , z] = view.direction;
  if (!x && !z) return;
  return headings.findIndex(([right, front]) => right === x && front === z);
}

/**
 * Arrow keys walk the views like a globe: Left and Right turn around the model at the same
 * height, Up and Down climb toward the top or bottom. From the top or bottom, Left and Right
 * turn around that pole and Up or Down leaves it, from the last `heading`.
 */
export function stepCubeView(view: CubeView, step: CubeStep, heading = 0): CubeView {
  const height = view.direction[1];
  const around = cubeHeading(view);
  if (around === undefined) {
    const turn = step === 'right' ? 1 : step === 'left' ? -1 : 0;
    const leaves = (step === 'down' && height > 0) || (step === 'up' && height < 0);
    if (!turn && !leaves) return view;
    const [x, z] = headings[(heading + turn + headings.length) % headings.length]!;
    return viewAt(x, height, z);
  }
  if (step === 'left' || step === 'right') {
    const [x, z] = headings[(around + (step === 'right' ? 1 : headings.length - 1)) % 8]!;
    return viewAt(x, height, z);
  }
  const next = height + (step === 'up' ? 1 : -1);
  if (Math.abs(next) > 1) return viewAt(0, Math.sign(next), 0);
  const [x, z] = headings[around]!;
  return viewAt(x, next, z);
}

/**
 * Cube coordinates in the model's own: right is +X, top is the format's up. CAD's top is +Z,
 * so its front is -Y, as CAD front views look along +Y.
 */
export function modelCubeBasis(extension: string): THREE.Matrix4 {
  const right = new THREE.Vector3(1, 0, 0);
  const top = new THREE.Vector3().fromArray(defaultModelUp(extension));
  return new THREE.Matrix4().makeBasis(right, top, right.clone().cross(top));
}

/** Where Frame model and Home view place the camera: front right, a little above. */
export function homeOffset(extension: string): THREE.Vector3 {
  return new THREE.Vector3(0.7, 0.5, 1).applyMatrix4(modelCubeBasis(extension));
}

/**
 * The camera for a standard view at the current target and distance. Its up vector is the
 * standard one, so the cube's labels read upright: the model's top for side views, and the back
 * from above or the front from below.
 */
export function standardModelView(
  view: CubeView,
  extension: string,
  current: ModelCamera,
): ModelCamera {
  const basis = modelCubeBasis(extension);
  const direction = new THREE.Vector3().fromArray(view.direction).transformDirection(basis);
  const top = new THREE.Vector3().fromArray(defaultModelUp(extension));
  const front = new THREE.Vector3(0, 0, 1).transformDirection(basis);
  const pole = Math.abs(direction.dot(top)) > 1 - 1e-9;
  let up: THREE.Vector3;
  if (current.rotation === 'turntable') {
    // A turntable turns around the model's top. Straight above or below, the camera sits a
    // millionth of a turn toward the front, so the controls keep the front at the bottom.
    up = top;
    if (pole) direction.addScaledVector(front, 1e-6).normalize();
  } else if (pole) {
    up = front.clone().multiplyScalar(direction.dot(top) > 0 ? -1 : 1);
  } else {
    up = top.clone().addScaledVector(direction, -top.dot(direction)).normalize();
  }
  const target = new THREE.Vector3().fromArray(current.target);
  const distance = new THREE.Vector3().fromArray(current.position).distanceTo(target);
  return {
    ...current,
    position: direction.multiplyScalar(distance).add(target).toArray(),
    up: up.toArray(),
  };
}

const unitDirections = cubeViews.map((view) =>
  new THREE.Vector3().fromArray(view.direction).normalize(),
);

/** The standard view closest to where the camera looks from. */
export function nearestCubeView(camera: THREE.Camera, extension: string): CubeView {
  const backward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(camera.quaternion)
    .applyMatrix4(modelCubeBasis(extension).transpose());
  let nearest = 0;
  for (const [index, direction] of unitDirections.entries())
    if (direction.dot(backward) > unitDirections[nearest]!.dot(backward)) nearest = index;
  return cubeViews[nearest]!;
}

/** CSS has a downward y axis: reflect a rotation's input and output to draw it. */
function cssMatrix(rotation: THREE.Matrix4): string {
  const reflect = new THREE.Matrix4().makeScale(1, -1, 1);
  const matrix = rotation.clone().premultiply(reflect).multiply(reflect);
  return `matrix3d(${matrix.elements.map((value) => +value.toFixed(6)).join(',')})`;
}

/** The cube turned as the camera sees the model, so its labels match the view. */
export function cubeTransform(camera: THREE.Camera, extension: string): string {
  return cssMatrix(
    new THREE.Matrix4()
      .makeRotationFromQuaternion(camera.quaternion.clone().invert())
      .multiply(modelCubeBasis(extension)),
  );
}

/** Half the cube's width, and half a face's: the 9 pixels between them are the bevel. */
const half = 31;
const inset = 22;
const seam = 0.5;

/**
 * One clickable patch of a bevelled cube: a square for a face, a strip for an edge and a
 * triangle for a corner, each a single target for its standard view.
 */
export function cubePatch(view: CubeView): CSSProperties {
  const signs = [...view.direction];
  const axes = signs.flatMap((value, axis) => (value ? [axis] : []));
  const vertices: THREE.Vector3[] = [];
  if (axes.length === 1) {
    const axis = axes[0]!;
    const others = [0, 1, 2].filter((index) => index !== axis);
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const point = new THREE.Vector3();
      point.setComponent(axis, signs[axis]! * half);
      point.setComponent(others[0]!, a * inset);
      point.setComponent(others[1]!, b * inset);
      vertices.push(point);
    }
  } else if (axes.length === 2) {
    const missing = [0, 1, 2].find((axis) => !signs[axis])!;
    for (const [outer, end] of [
      [0, -1],
      [1, -1],
      [1, 1],
      [0, 1],
    ] as const) {
      const axis = axes[outer]!;
      const point = new THREE.Vector3().fromArray(signs).multiplyScalar(inset);
      point.setComponent(axis, signs[axis]! * half);
      point.setComponent(missing, end * inset);
      vertices.push(point);
    }
  } else {
    for (const axis of axes) {
      const point = new THREE.Vector3().fromArray(signs).multiplyScalar(inset);
      point.setComponent(axis, signs[axis]! * half);
      vertices.push(point);
    }
  }
  const normal = new THREE.Vector3().fromArray(signs).normalize();
  // Text on the top reads with the back above it, and on the bottom with the front above it.
  const hint =
    Math.abs(normal.y) > 0.99
      ? new THREE.Vector3(0, 0, -Math.sign(normal.y))
      : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();
  const center = vertices
    .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
    .divideScalar(vertices.length);
  const points = vertices.map((vertex) => {
    const offset = vertex.clone().sub(center);
    return { x: offset.dot(right), y: offset.dot(up) };
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  center.addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
  // Half a pixel inside each side leaves a hairline between neighbouring patches.
  const corners = points.map((point) => {
    const x = seam + ((point.x - minX) / width) * (width - 2 * seam);
    const y = seam + ((maxY - point.y) / height) * (height - 2 * seam);
    return `${+x.toFixed(3)}px ${+y.toFixed(3)}px`;
  });
  return {
    width,
    height,
    left: -width / 2,
    top: -height / 2,
    transform:
      `translate3d(${+center.x.toFixed(3)}px, ${+(-center.y).toFixed(3)}px, ${+center.z.toFixed(3)}px) ` +
      cssMatrix(new THREE.Matrix4().makeBasis(right, up, normal)),
    clipPath: `polygon(${corners.join(', ')})`,
  };
}
