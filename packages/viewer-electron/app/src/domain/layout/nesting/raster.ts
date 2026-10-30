/**
 * Parts as cells on a square grid, for collision tests. A part's raster marks every cell that
 * comes within `reach` of its material, holes left empty: two rasters that share no cell belong
 * to parts at least twice `reach` apart. Each column holds its marked cells as sorted spans.
 */
import { turn } from './geometry';

export interface Shape {
  /** Outlines and holes as x, y pairs, read even-odd. */
  rings: readonly (readonly number[])[];
  /** Open cut paths as x, y pairs. */
  paths: readonly (readonly number[])[];
}
export interface Orientation {
  rotation: number;
  mirror: boolean;
  columns: number;
  rows: number;
  /** Column j's spans are spans[offsets[j]] … spans[offsets[j + 1]], as [first row, end row). */
  offsets: Int32Array;
  spans: Int32Array;
  /** The turned part's box, in millimetres, in its own frame. */
  left: number;
  bottom: number;
  width: number;
  height: number;
  /** A hash of the spans, to drop orientations that look the same. */
  key: string;
}

/** Turns and rasterises a shape. Column 0, row 0 has its corner `cell + reach` below and left of
 * the turned part's box, so the box's corner sits on a cell corner. */
export function orient(
  shape: Shape,
  rotation: number,
  mirror: boolean,
  cell: number,
  reach: number,
): Orientation {
  const [cos, sin] = turn(rotation);
  const flip = mirror ? -1 : 1;
  const map = (values: readonly number[]) => {
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i += 2) {
      const x = values[i]! * flip,
        y = values[i + 1]!;
      out[i] = cos * x - sin * y;
      out[i + 1] = sin * x + cos * y;
    }
    return out;
  };
  const rings = shape.rings.map(map),
    paths = shape.paths.map(map);
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity;
  for (const values of [...rings, ...paths])
    for (let i = 0; i < values.length; i += 2) {
      left = Math.min(left, values[i]!);
      right = Math.max(right, values[i]!);
      bottom = Math.min(bottom, values[i + 1]!);
      top = Math.max(top, values[i + 1]!);
    }
  const pad = reach + cell;
  const ox = left - pad,
    oy = bottom - pad;
  const columns = Math.max(1, Math.ceil((right - left + 2 * pad) / cell));
  const rows = Math.max(1, Math.ceil((top - bottom + 2 * pad) / cell));
  if (columns * rows > 64_000_000)
    throw new Error('A part is too large for this resolution. Use a coarser one.');
  // Column-major, so each column's spans read in one pass.
  const grid = new Uint8Array(columns * rows);
  fill(grid, columns, rows, rings, ox, oy, cell);
  for (const ring of rings) band(grid, columns, rows, ring, true, ox, oy, cell, reach);
  for (const path of paths) band(grid, columns, rows, path, false, ox, oy, cell, reach);
  const offsets = new Int32Array(columns + 1),
    spans: number[] = [];
  let hash = 2166136261;
  for (let c = 0; c < columns; c++) {
    offsets[c] = spans.length;
    const base = c * rows;
    for (let r = 0; r < rows;) {
      if (!grid[base + r]) {
        r++;
        continue;
      }
      const start = r;
      while (r < rows && grid[base + r]) r++;
      spans.push(start, r);
      hash = Math.imul(hash ^ (c * 7919 + start), 16777619);
      hash = Math.imul(hash ^ r, 16777619);
    }
  }
  offsets[columns] = spans.length;
  return {
    rotation,
    mirror,
    columns,
    rows,
    offsets,
    spans: Int32Array.from(spans),
    left,
    bottom,
    width: right - left,
    height: top - bottom,
    key: `${columns}x${rows}:${spans.length}:${hash >>> 0}`,
  };
}

/** Marks cells whose centres lie inside the rings, even-odd. */
function fill(
  grid: Uint8Array,
  columns: number,
  rows: number,
  rings: readonly Float64Array[],
  ox: number,
  oy: number,
  cell: number,
): void {
  const crossings: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = oy + (r + 0.5) * cell;
    crossings.length = 0;
    for (const ring of rings) {
      const count = ring.length;
      for (let i = 0, j = count - 2; i < count; j = i, i += 2) {
        const yi = ring[i + 1]!,
          yj = ring[j + 1]!;
        if (yi > y !== yj > y) {
          const xi = ring[i]!,
            xj = ring[j]!;
          crossings.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
        }
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k]! - ox) / cell - 0.5)),
        to = Math.min(columns - 1, Math.floor((crossings[k + 1]! - ox) / cell - 0.5));
      for (let c = from; c <= to; c++) grid[c * rows + r] = 1;
    }
  }
}

/** Marks cells whose square comes within `reach` of a polyline's segments. Long segments are cut
 * into short pieces so only cells near each piece are tested. */
function band(
  grid: Uint8Array,
  columns: number,
  rows: number,
  values: Float64Array,
  closed: boolean,
  ox: number,
  oy: number,
  cell: number,
  reach: number,
): void {
  const count = values.length / 2;
  const segments = closed ? count : count - 1;
  const piece = 4 * cell,
    limit = reach * reach + 1e-12;
  for (let s = 0; s < segments; s++) {
    const i = 2 * s,
      j = 2 * ((s + 1) % count);
    const ax = values[i]!,
      ay = values[i + 1]!,
      bx = values[j]!,
      by = values[j + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / piece));
    for (let k = 0; k < steps; k++) {
      const px = ax + ((bx - ax) * k) / steps,
        py = ay + ((by - ay) * k) / steps,
        qx = ax + ((bx - ax) * (k + 1)) / steps,
        qy = ay + ((by - ay) * (k + 1)) / steps;
      const c0 = Math.max(0, Math.floor((Math.min(px, qx) - reach - ox) / cell)),
        c1 = Math.min(columns - 1, Math.floor((Math.max(px, qx) + reach - ox) / cell)),
        r0 = Math.max(0, Math.floor((Math.min(py, qy) - reach - oy) / cell)),
        r1 = Math.min(rows - 1, Math.floor((Math.max(py, qy) + reach - oy) / cell));
      for (let c = c0; c <= c1; c++) {
        const x0 = ox + c * cell,
          base = c * rows;
        for (let r = r0; r <= r1; r++) {
          if (grid[base + r]) continue;
          const y0 = oy + r * cell;
          if (boxSegmentDistance2(x0, y0, x0 + cell, y0 + cell, px, py, qx, qy) <= limit)
            grid[base + r] = 1;
        }
      }
    }
  }
}

/** The squared distance between an axis-aligned box and a segment; zero when they meet. */
export function boxSegmentDistance2(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  // Liang-Barsky: does the segment enter the box?
  const dx = bx - ax,
    dy = by - ay;
  let t0 = 0,
    t1 = 1,
    meets = true;
  const clip = (p: number, q: number) => {
    if (!meets) return;
    if (p === 0) {
      if (q < 0) meets = false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) meets = false;
        else if (t > t0) t0 = t;
      } else if (t < t0) meets = false;
      else if (t < t1) t1 = t;
    }
  };
  clip(-dx, ax - x0);
  clip(dx, x1 - ax);
  clip(-dy, ay - y0);
  clip(dy, y1 - ay);
  if (meets) return 0;
  const pointBox = (px: number, py: number) => {
    const ex = Math.max(x0 - px, 0, px - x1),
      ey = Math.max(y0 - py, 0, py - y1);
    return ex * ex + ey * ey;
  };
  const pointSegment = (px: number, py: number) => {
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
    const ex = px - ax - t * dx,
      ey = py - ay - t * dy;
    return ex * ex + ey * ey;
  };
  return Math.min(
    pointBox(ax, ay),
    pointBox(bx, by),
    pointSegment(x0, y0),
    pointSegment(x1, y0),
    pointSegment(x0, y1),
    pointSegment(x1, y1),
  );
}
