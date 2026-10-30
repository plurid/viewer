/**
 * A MASK AS AN OUTLINE: the outer edge of a segmentation mask's largest connected region, traced
 * along its cells' sides, simplified, and placed on the picture as fractions of its width and
 * height, as a PDF page's `region` or a photo's `polygon` takes it.
 */
import type { EvidenceRegion } from '../files/inspection';
import type { PixelBox } from './sam';

/** Where the mask's cells lie: the source pixels they cover, on a picture of `frame` size. */
export interface MaskPlacement {
  bounds: PixelBox;
  frame: { width: number; height: number };
}
/** An outline has at most this many points (`evidenceRegionSchema`). */
const pointLimit = 512;

/** The cells of the largest 4-connected region of set cells. */
function largestRegion(raster: Uint8Array, width: number, height: number): Uint8Array {
  const seen = new Uint8Array(raster.length);
  let best: number[] = [];
  for (let start = 0; start < raster.length; start++) {
    if (!raster[start] || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop()!;
      cells.push(cell);
      const x = cell % width,
        y = Math.floor(cell / width);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (raster[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (cells.length > best.length) best = cells;
  }
  const region = new Uint8Array(raster.length);
  for (const cell of best) region[cell] = 1;
  return region;
}

/** The region's boundary loops, clockwise on the picture, as cell-corner points. */
function boundaryLoops(region: Uint8Array, width: number, height: number): [number, number][][] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && region[y * width + x] === 1;
  const key = (x: number, y: number) => y * (width + 1) + x;
  const edges = new Map<number, [number, number][]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const list = edges.get(key(ax, ay)) ?? [];
    list.push([bx, by]);
    edges.set(key(ax, ay), list);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops: [number, number][][] = [];
  for (const [start, list] of edges)
    while (list.length) {
      const first: [number, number] = [start % (width + 1), Math.floor(start / (width + 1))];
      const loop: [number, number][] = [first];
      let at = list.pop()!;
      while (at[0] !== first[0] || at[1] !== first[1]) {
        loop.push(at);
        const next = edges.get(key(at[0], at[1]))?.pop();
        if (!next) break;
        at = next;
      }
      loops.push(loop);
    }
  return loops;
}
const area = (loop: readonly [number, number][]) =>
  loop.reduce((sum, [x, y], index) => {
    const [nx, ny] = loop[(index + 1) % loop.length]!;
    return sum + x * ny - nx * y;
  }, 0) / 2;

/** Points where the outline turns. */
function corners(loop: readonly [number, number][]): [number, number][] {
  return loop.filter((point, index) => {
    const previous = loop[(index + loop.length - 1) % loop.length]!;
    const next = loop[(index + 1) % loop.length]!;
    return (
      (point[0] - previous[0]) * (next[1] - point[1]) !==
      (point[1] - previous[1]) * (next[0] - point[0])
    );
  });
}
/** Douglas–Peucker on a closed outline: points within `tolerance` cells of a chord go. */
function simplify(points: readonly [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 4) return [...points];
  const distance = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    return length
      ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length
      : Math.hypot(p[0] - a[0], p[1] - a[1]);
  };
  const keep = new Uint8Array(points.length);
  // the first point, and the point farthest from it, split the outline into two open runs
  let far = 0;
  for (let index = 1; index < points.length; index++)
    if (
      Math.hypot(points[index]![0] - points[0]![0], points[index]![1] - points[0]![1]) >
      Math.hypot(points[far]![0] - points[0]![0], points[far]![1] - points[0]![1])
    )
      far = index;
  keep[0] = keep[far] = 1;
  const runs: [number, number][] = [
    [0, far],
    [far, points.length],
  ];
  while (runs.length) {
    const [from, to] = runs.pop()!;
    const a = points[from]!,
      b = points[to % points.length]!;
    let worst = -1,
      at = -1;
    for (let index = from + 1; index < to; index++) {
      const d = distance(points[index]!, a, b);
      if (d > worst) [worst, at] = [d, index];
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      runs.push([from, at], [at, to]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** The outline of a `width` × `height` mask placed on its picture, or undefined when it is empty. */
export function maskPolygon(
  raster: Uint8Array,
  width: number,
  height: number,
  placement: MaskPlacement,
): EvidenceRegion | undefined {
  if (raster.length !== width * height || !raster.some((cell) => cell === 1)) return undefined;
  const loops = boundaryLoops(largestRegion(raster, width, height), width, height);
  const outer = loops.reduce<[number, number][] | undefined>(
    (best, loop) => (!best || Math.abs(area(loop)) > Math.abs(area(best)) ? loop : best),
    undefined,
  );
  if (!outer) return undefined;
  // A cell's corners stair-step along a curve; within three quarters of a cell they are one line.
  const turns = corners(outer);
  let tolerance = 0.75;
  let points = simplify(turns, tolerance);
  while (points.length > pointLimit) points = simplify(turns, (tolerance *= 2));
  if (points.length < 3) return undefined;
  const { bounds, frame } = placement;
  const scaleX = (bounds.right - bounds.left) / width,
    scaleY = (bounds.bottom - bounds.top) / height;
  const unit = (value: number) => Math.max(0, Math.min(1, Number(value.toFixed(6))));
  return points.map(([x, y]) => [
    unit((bounds.left + x * scaleX) / frame.width),
    unit((bounds.top + y * scaleY) / frame.height),
  ]);
}
