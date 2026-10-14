export interface Point {
  x: number;
  y: number;
}
export interface Bounds {
  min: Point;
  max: Point;
}
export interface DrawingEntity {
  id: string;
  type: string;
  layer: string;
  color?: string;
  points: Point[];
  snaps: { point: Point; kind: 'Endpoint' | 'Midpoint' | 'Center' | 'Quadrant' }[];
  closed: boolean;
  bounds: Bounds;
  length?: number;
  area?: number;
  radius?: number;
  axes?: [number, number];
  approximate?: boolean;
  text?: { value: string; height: number; rotation: number };
}
export interface Drawing {
  entities: DrawingEntity[];
  layers: { name: string; visible: boolean; count: number }[];
  bounds: Bounds;
  units: number;
  warnings: string[];
}
export const DXF_MAX_BYTES = 32 * 1024 * 1024;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function polygonArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  // Translate to a local origin to avoid cancellation for drawings far from zero.
  const origin = points[0];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    sum += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return Math.abs(sum) / 2;
}
export function angleAt(a: Point, vertex: Point, b: Point): number | undefined {
  const length = distance(a, vertex) * distance(b, vertex);
  if (length < 1e-18) return undefined;
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          ((a.x - vertex.x) * (b.x - vertex.x) + (a.y - vertex.y) * (b.y - vertex.y)) / length,
        ),
      ),
    ) *
      180) /
    Math.PI
  );
}
