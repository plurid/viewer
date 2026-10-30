/**
 * The exact check of a nesting, independent of the raster that made it: every placed outline is
 * at least the spacing from every other and inside the sheet's margin. Flattened curves may stray
 * up to `tolerance` from the drawing, so polygons are held that much further apart and in.
 */
import { insideRings, placementMatrix, segmentDistance } from './geometry';
import { sheetLength, sheetWidth } from './nest';
import type { Placement, SheetSize } from './plan';
import type { Shape } from './raster';

export interface Verification {
  ok: boolean;
  /** The closest two parts on any sheet, as flattened, in millimetres; Infinity with fewer than
   * two. */
  closest: number;
  problems: string[];
}
interface Placed {
  /** Every edge as x0, y0, x1, y1. */
  edges: Float64Array;
  rings: Float64Array[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A point on its outline, for containment. */
  px: number;
  py: number;
}

export interface VerifiedProblem {
  parts: readonly Shape[];
  formats: readonly SheetSize[];
  margin: number;
  spacing: number;
  tolerance: number;
}

export function verifyNest(
  problem: VerifiedProblem,
  sheets: readonly { format: number; placements: readonly Placement[] }[],
): Verification {
  const problems: string[] = [];
  let closest = Infinity;
  const need = problem.spacing + 2 * problem.tolerance - 1e-6,
    inset = problem.margin + problem.tolerance - 1e-6;
  sheets.forEach((sheet, number) => {
    const format = problem.formats[sheet.format]!;
    const length = sheetLength(format),
      width = sheetWidth(format);
    const placed = sheet.placements.map((placement) => place(problem, placement));
    placed.forEach((item, index) => {
      if (item.x0 < inset || item.y0 < inset || item.x1 > length - inset || item.y1 > width - inset)
        problems.push(`Sheet ${number + 1}: part ${index + 1} crosses the margin.`);
    });
    // Sweep along x: only parts whose boxes come within the spacing are compared.
    const order = placed.map((_, index) => index).sort((a, b) => placed[a]!.x0 - placed[b]!.x0);
    for (let i = 0; i < order.length; i++) {
      const a = placed[order[i]!]!;
      for (let j = i + 1; j < order.length; j++) {
        const b = placed[order[j]!]!;
        if (b.x0 > a.x1 + need) break;
        if (b.y0 > a.y1 + need || a.y0 > b.y1 + need) continue;
        const distance = gap(a, b, need);
        closest = Math.min(closest, distance);
        if (distance < need)
          problems.push(`Sheet ${number + 1}: two parts are ${distance.toFixed(2)} mm apart.`);
      }
    }
  });
  return { ok: !problems.length, closest, problems };
}

function place(problem: VerifiedProblem, placement: Placement): Placed {
  const part = problem.parts[placement.part]!;
  const m = placementMatrix(placement.rotation, placement.mirror, placement.x, placement.y);
  const map = (values: readonly number[]) => {
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i += 2) {
      out[i] = m[0] * values[i]! + m[2] * values[i + 1]! + m[4];
      out[i + 1] = m[1] * values[i]! + m[3] * values[i + 1]! + m[5];
    }
    return out;
  };
  const rings = part.rings.map(map),
    paths = part.paths.map(map);
  const edges: number[] = [];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const take = (values: Float64Array, closed: boolean) => {
    const count = values.length / 2;
    for (let i = 0; i < count; i++) {
      x0 = Math.min(x0, values[2 * i]!);
      x1 = Math.max(x1, values[2 * i]!);
      y0 = Math.min(y0, values[2 * i + 1]!);
      y1 = Math.max(y1, values[2 * i + 1]!);
      if (i + 1 < count || closed) {
        const k = (i + 1) % count;
        edges.push(values[2 * i]!, values[2 * i + 1]!, values[2 * k]!, values[2 * k + 1]!);
      }
    }
  };
  for (const ring of rings) take(ring, true);
  for (const path of paths) take(path, false);
  const first = rings[0] ?? paths[0]!;
  return { edges: Float64Array.from(edges), rings, x0, y0, x1, y1, px: first[0]!, py: first[1]! };
}

/** The distance between two placed parts, from their nearest edges; zero when one lies on the
 * other's material. Only edges near the other part's box are compared. */
function gap(a: Placed, b: Placed, near: number): number {
  const window = (p: Placed, q: Placed) => {
    const indexes: number[] = [];
    for (let i = 0; i < p.edges.length; i += 4) {
      const ex0 = Math.min(p.edges[i]!, p.edges[i + 2]!),
        ex1 = Math.max(p.edges[i]!, p.edges[i + 2]!),
        ey0 = Math.min(p.edges[i + 1]!, p.edges[i + 3]!),
        ey1 = Math.max(p.edges[i + 1]!, p.edges[i + 3]!);
      if (ex1 >= q.x0 - near && ex0 <= q.x1 + near && ey1 >= q.y0 - near && ey0 <= q.y1 + near)
        indexes.push(i);
    }
    return indexes;
  };
  const ea = window(a, b),
    eb = window(b, a);
  let best = Infinity;
  for (const i of ea)
    for (const j of eb) {
      const d = segmentDistance(
        a.edges[i]!,
        a.edges[i + 1]!,
        a.edges[i + 2]!,
        a.edges[i + 3]!,
        b.edges[j]!,
        b.edges[j + 1]!,
        b.edges[j + 2]!,
        b.edges[j + 3]!,
      );
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  // Without an edge nearby, one part can still lie wholly on the other's material.
  if (a.rings.length && b.rings.length) {
    if (insideRings(b.px, b.py, a.rings) || insideRings(a.px, a.py, b.rings)) return 0;
  }
  return best;
}
