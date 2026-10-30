/** Plane geometry for nesting, in millimetres with y up, as DXF drawings are. */
import type { Bounds, Point } from '../../previews/drawings/dxf/math';

export type { Bounds, Point };
/** An affine map: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export const tau = Math.PI * 2;

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export const apply = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scaling = (factor: number): Matrix => [factor, 0, 0, factor, 0, 0];
export const determinant = (m: Matrix) => m[0] * m[3] - m[1] * m[2];

/** Cosine and sine of a whole-degree angle; quarter turns are exact. */
export function turn(degrees: number): [number, number] {
  const quarter = (((Math.round(degrees) % 360) + 360) % 360) / 90;
  if (Number.isInteger(quarter) && Math.round(degrees) === degrees)
    return (
      [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as [number, number][]
    )[quarter]!;
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}
/** Where a part goes: mirrored across its vertical axis first, then turned, then moved. */
export function placementMatrix(rotation: number, mirror: boolean, x: number, y: number): Matrix {
  const [cos, sin] = turn(rotation);
  const flip = mirror ? -1 : 1;
  return [cos * flip, sin * flip, -sin, cos, x, y];
}
/** The uniform scale of a map that keeps circles round, or undefined when it shears or stretches. */
export function similarity(m: Matrix): number | undefined {
  const sx = Math.hypot(m[0], m[1]),
    sy = Math.hypot(m[2], m[3]);
  const orthogonal = Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * sx * sy;
  return orthogonal && Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) ? sx : undefined;
}

export const emptyBounds = (): Bounds => ({
  min: { x: Infinity, y: Infinity },
  max: { x: -Infinity, y: -Infinity },
});
export function extend(bounds: Bounds, p: Point): Bounds {
  bounds.min.x = Math.min(bounds.min.x, p.x);
  bounds.min.y = Math.min(bounds.min.y, p.y);
  bounds.max.x = Math.max(bounds.max.x, p.x);
  bounds.max.y = Math.max(bounds.max.y, p.y);
  return bounds;
}
export function boundsOf(points: readonly Point[]): Bounds {
  const bounds = emptyBounds();
  for (const p of points) extend(bounds, p);
  return bounds;
}
export const finiteBounds = (bounds: Bounds) =>
  Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.x);

/** The enclosed area, positive when the points run counter-clockwise. */
export function signedArea(points: readonly Point[]): number {
  const origin = points[0];
  if (!origin || points.length < 3) return 0;
  let sum = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    sum += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return sum / 2;
}
/** Even-odd containment, for a ring given as x, y pairs. */
export function insideRing(x: number, y: number, ring: ArrayLike<number>): boolean {
  let inside = false;
  const count = ring.length;
  for (let i = 0, j = count - 2; i < count; j = i, i += 2) {
    const xi = ring[i]!,
      yi = ring[i + 1]!,
      xj = ring[j]!,
      yj = ring[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Even-odd containment across several rings: outlines and their holes. */
export function insideRings(x: number, y: number, rings: readonly ArrayLike<number>[]): boolean {
  let inside = false;
  for (const ring of rings) if (insideRing(x, y, ring)) inside = !inside;
  return inside;
}
export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
/** The closest approach of two segments; zero when they cross or touch. */
export function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const d1 = cross(ax, ay, bx, by, cx, cy),
    d2 = cross(ax, ay, bx, by, dx, dy),
    d3 = cross(cx, cy, dx, dy, ax, ay),
    d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return 0;
  return Math.min(
    pointSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointSegmentDistance(bx, by, cx, cy, dx, dy),
    pointSegmentDistance(cx, cy, ax, ay, bx, by),
    pointSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}
/** Points along a circular arc, from `start` through `sweep` radians (counter-clockwise when
 * positive), whose chords stay within `tolerance` of the curve. Both ends are exact, and so are
 * the extremes along x and y, so a box around the points is the arc's own. */
export function arcPoints(
  center: Point,
  radius: number,
  start: number,
  sweep: number,
  tolerance: number,
): Point[] {
  const step = tolerance < radius ? 2 * Math.acos(1 - tolerance / radius) : Math.PI / 2;
  const count = Math.min(
    4096,
    Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)), Math.ceil(Math.abs(sweep) / step)),
  );
  const angles: number[] = [];
  for (let i = 0; i <= count; i++) angles.push(start + (sweep * i) / count);
  const low = Math.min(start, start + sweep),
    high = Math.max(start, start + sweep);
  for (let k = Math.ceil(low / (Math.PI / 2)); k * (Math.PI / 2) < high; k++) {
    const angle = k * (Math.PI / 2);
    if (angle > low + 1e-12 && angle < high - 1e-12) angles.push(angle);
  }
  angles.sort((a, b) => (sweep >= 0 ? a - b : b - a));
  return angles.map((angle) => ({
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  }));
}
/** A polyline bulge, tan(sweep / 4), as the arc it describes from `a` to `b`. */
export function bulgeArc(
  a: Point,
  b: Point,
  bulge: number,
): { center: Point; radius: number; start: number; sweep: number } | undefined {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge || chord < 1e-12) return undefined;
  const sweep = 4 * Math.atan(bulge),
    radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const offset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const center = {
    x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * offset,
    y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * offset,
  };
  return { center, radius, start: Math.atan2(a.y - center.y, a.x - center.x), sweep };
}
/** Flattens [x0, y0, x1, y1, …] point lists, for transfer and rasterising. */
export function flat(points: readonly Point[]): number[] {
  const values: number[] = [];
  for (const p of points) values.push(p.x, p.y);
  return values;
}
