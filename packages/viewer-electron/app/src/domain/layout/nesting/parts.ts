/**
 * Parts from a cut drawing: entities joined into closed loops, loops sorted into outlines and
 * holes, and the facts a cutting estimate needs. Everything is in millimetres; each part has its
 * own frame with the corner of its box at the origin.
 */
import {
  chordArea,
  closedPrimitive,
  primitiveLength,
  sweptArea,
  primitivePoints,
  transformPrimitive,
  type CutDrawing,
  type DrawingLayer,
  type Primitive,
} from './drawing';
import {
  boundsOf,
  emptyBounds,
  extend,
  finiteBounds,
  flat,
  insideRing,
  insideRings,
  pointSegmentDistance,
  scaling,
  signedArea,
  translation,
  type Bounds,
  type Point,
} from './geometry';

/** Millimetres. Chords stay within `flatten` of each curve; ends closer than `join` meet; an
 * outline whose two ends are within `gap` is closed across it, with a note. */
export const nestingTolerances = { flatten: 0.05, join: 0.05, gap: 0.5 } as const;
/** What an entity is to the cutter. */
export type CutRole = 'outer' | 'inner' | 'open' | 'mark';
export interface PartEntity {
  primitive: Primitive;
  role: CutRole;
}
export interface Part {
  /** Its place among the parts of its file, which a saved plan refers to. */
  index: number;
  name: string;
  /** Identical outlines in the file, each nested as a part of its own. */
  copies: number;
  width: number;
  height: number;
  /** Material area: outlines less their holes. */
  area: number;
  /** One copy's cut length: closed loops and open paths. */
  cutLength: number;
  /** One copy's pierces: one per closed loop and per open path. */
  pierces: number;
  markLength: number;
  /** Closed rings as x, y pairs: outlines and holes, read even-odd. */
  rings: number[][];
  holes: number;
  /** Open cut paths as x, y pairs. */
  paths: number[][];
  /** Marked lines as x, y pairs. */
  marks: number[][];
  entities: PartEntity[];
  /** A point well inside the material, for the part's number. */
  label: Point;
}
export interface PartsOptions {
  /** Millimetres per drawing unit. */
  scale: number;
  /** Layers drawn and marked, never cut. */
  marks: ReadonlySet<string>;
  /** Keep the drawing's separate outlines together as one part. */
  together: boolean;
}
export interface FileParts {
  parts: Part[];
  /** Separate outlines in the drawing, which can be nested together or apart. */
  outlines: number;
  /** Why the drawing cannot be nested, in a sentence. */
  problem?: string;
  notes: string[];
}

/** Layer names that usually hold marking, engraving or annotation, not cuts. */
const markNames = /engrav|mark|etch|text|scribe|label|annot|bend|defpoints/i;
export const suggestedMarks = (layers: readonly DrawingLayer[]) =>
  layers.filter((layer) => markNames.test(layer.name)).map((layer) => layer.name);

interface Run {
  points: Point[];
  entities: number[];
  length: number;
  /** The widest joint between its entities. */
  widest: number;
  /** The area between its curves and their chords, signed along its direction: what makes a
   * loop's area exact. */
  excess: number;
}
interface Ring extends Run {
  flat: number[];
  area: number;
  bounds: Bounds;
  parent: number;
  depth: number;
}
interface Piece {
  outer: number;
  holes: number[];
  open: Run[];
  marks: number[];
}

const close = (a: Point, b: Point, tolerance: number) =>
  Math.abs(a.x - b.x) <= tolerance &&
  Math.abs(a.y - b.y) <= tolerance &&
  Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const plural = (count: number, one: string, many = one + 's') =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

export function extractParts(drawing: CutDrawing, options: PartsOptions, name: string): FileParts {
  const notes: string[] = [];
  const scaled = drawing.primitives.map((p) => transformPrimitive(p, scaling(options.scale)));
  const isMark = (p: Primitive) => p.kind === 'text' || options.marks.has(p.layer);
  const cuts: number[] = [],
    marks: number[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  scaled.forEach((primitive, index) => {
    if (isMark(primitive)) return void marks.push(index);
    const key = identity(primitive);
    if (seen.has(key)) return void duplicates++;
    seen.add(key);
    cuts.push(index);
  });
  if (duplicates)
    notes.push(
      `${plural(duplicates, 'duplicate entity', 'duplicate entities')} left out: each line is cut once.`,
    );
  const skipped = Object.entries(drawing.skipped).filter(([type]) => type !== 'tilted');
  if (skipped.length)
    notes.push(
      `Left out: ${skipped.map(([type, count]) => `${count} ${type.toLowerCase()}`).join(', ')}.`,
    );
  if (drawing.skipped.tilted) notes.push('Entities drawn on a tilted plane are left out.');
  const hidden = drawing.layers.filter((layer) => layer.hidden);
  if (hidden.length)
    notes.push(`Hidden layers left out: ${hidden.map((layer) => layer.name).join(', ')}.`);
  if (!cuts.length)
    return { parts: [], outlines: 0, problem: `${name} has nothing to cut.`, notes };

  // Each entity is a closed loop by itself, or a run waiting to be joined.
  const rings: Run[] = [],
    runs: Run[] = [];
  for (const index of cuts) {
    const primitive = scaled[index]!;
    const points = primitivePoints(primitive, nestingTolerances.flatten);
    const run = {
      points,
      entities: [index],
      length: primitiveLength(primitive),
      widest: 0,
      excess: sweptArea(primitive, points[0]!) - chordArea(points, points[0]!),
    };
    const returns =
      closedPrimitive(primitive) ||
      (points.length > 2 && close(points[0]!, points.at(-1)!, nestingTolerances.join));
    (returns ? rings : runs).push(run);
  }
  const joined = chain(runs, nestingTolerances.join);
  rings.push(...joined.closed);
  const bridged = chain(joined.open, nestingTolerances.gap);
  for (const ring of bridged.closed)
    notes.push(`Closed a ${ring.widest.toFixed(2)} mm gap in an outline. Check the drawing.`);
  rings.push(...bridged.closed);
  const open = bridged.open;
  const closed: Ring[] = [];
  for (const run of rings) {
    const ring = ringOf(run);
    if (ring) closed.push(ring);
    else open.push(run);
  }
  if (!closed.length) {
    const nearest = nearestEnds(open);
    return {
      parts: [],
      outlines: 0,
      problem:
        `${name} has no closed outline.` +
        (nearest !== undefined ? ` Its nearest open ends are ${nearest.toFixed(2)} mm apart.` : ''),
      notes,
    };
  }
  nestRings(closed);
  // Pieces in reading order: down the drawing in rows, then across.
  const pieces: Piece[] = closed
    .map((ring, index) => ({ ring, index }))
    .filter(({ ring }) => ring.depth % 2 === 0)
    .sort(
      (a, b) =>
        Math.round(b.ring.bounds.max.y) - Math.round(a.ring.bounds.max.y) ||
        a.ring.bounds.min.x - b.ring.bounds.min.x,
    )
    .map(({ index }) => ({
      outer: index,
      holes: closed.flatMap((ring, hole) => (ring.parent === index ? [hole] : [])),
      open: [],
      marks: [],
    }));
  const pieceAt = (p: Point): Piece | undefined => {
    let deepest = -1;
    closed.forEach((ring, index) => {
      if (
        p.x >= ring.bounds.min.x &&
        p.x <= ring.bounds.max.x &&
        p.y >= ring.bounds.min.y &&
        p.y <= ring.bounds.max.y &&
        insideRing(p.x, p.y, ring.flat) &&
        (deepest < 0 || ring.depth > closed[deepest]!.depth)
      )
        deepest = index;
    });
    if (deepest < 0) return undefined;
    const owner = closed[deepest]!.depth % 2 === 0 ? deepest : closed[deepest]!.parent;
    return pieces.find((piece) => piece.outer === owner);
  };
  let outside = 0;
  for (const run of open) {
    const inside = pieceAt(run.points[0]!);
    if (!inside) outside++;
    (inside ?? nearestPiece(pieces, closed, run.points[0]!)).open.push(run);
  }
  if (open.length)
    notes.push(
      `${plural(open.length, 'open path')} ${open.length === 1 ? 'is' : 'are'} cut as drawn` +
        (outside ? `, ${outside} outside every outline.` : '.'),
    );
  let stray = 0;
  for (const index of marks) {
    const primitive = scaled[index]!;
    const at = primitive.kind === 'text' ? primitive.at : primitivePoints(primitive, 1)[0];
    const piece = at && pieceAt(at);
    if (piece) piece.marks.push(index);
    else stray++;
  }
  if (stray) notes.push(`${plural(stray, 'mark')} outside every outline left out.`);
  if (scaled.some((p) => p.kind === 'text'))
    notes.push('Text is kept as text on the marking layer, not cut.');

  const groups: Piece[][] = [];
  if (options.together || pieces.length === 1) groups.push(pieces);
  else {
    const bySignature = new Map<string, Piece[]>();
    for (const piece of pieces) {
      const key = signature(piece, closed, scaled);
      const group = bySignature.get(key);
      if (group) group.push(piece);
      else {
        const created = [piece];
        bySignature.set(key, created);
        groups.push(created);
      }
    }
  }
  const parts = groups.map((group, index) => ({
    ...partOf(options.together ? group : [group[0]!], closed, scaled, index),
    name: groups.length === 1 ? name : `${name} ${index + 1}`,
    copies: options.together ? 1 : group.length,
  }));
  return { parts, outlines: pieces.length, notes };
}

/** A key that two copies of one entity share, in either direction. */
function identity(p: Primitive): string {
  const r = (value: number) => Math.round(value * 1000);
  const at = (q: Point) => `${r(q.x)},${r(q.y)}`;
  switch (p.kind) {
    case 'line':
      return 'l' + [at(p.a), at(p.b)].sort().join(';');
    case 'arc':
      return `a${at(p.center)};${r(p.radius)};${p.sweep >= Math.PI * 2 - 1e-9 ? 'o' : `${r(p.start)};${r(p.sweep)}`}`;
    case 'polyline': {
      const forward = p.vertices.map((v) => `${at(v)}:${r(v.bulge)}`).join(';');
      return `p${p.closed ? 'c' : 'o'}${forward}`;
    }
    case 'ellipse':
      return `e${at(p.center)};${at(p.u)};${at(p.v)};${r(p.start)};${r(p.sweep)}`;
    case 'spline':
      return `s${p.degree};${p.controls.map(at).join(';')}`;
    case 'text':
      return `t${at(p.at)};${p.value}`;
  }
}

/** Joins runs end to end, reversing any that point the other way. */
export function chain(runs: readonly Run[], tolerance: number): { closed: Run[]; open: Run[] } {
  const cell = Math.max(tolerance, 1e-9);
  const key = (p: Point) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
  const grid = new Map<string, { run: number; end: 0 | 1 }[]>();
  runs.forEach((run, index) => {
    for (const end of [0, 1] as const) {
      const p = end ? run.points.at(-1)! : run.points[0]!;
      const k = key(p);
      grid.set(k, [...(grid.get(k) ?? []), { run: index, end }]);
    }
  });
  const used = new Uint8Array(runs.length);
  const find = (p: Point) => {
    let best: { run: number; end: 0 | 1 } | undefined,
      distance = Infinity;
    const cx = Math.floor(p.x / cell),
      cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const candidate of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (used[candidate.run]) continue;
          const run = runs[candidate.run]!;
          const q = candidate.end ? run.points.at(-1)! : run.points[0]!;
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d <= tolerance && d < distance) {
            best = candidate;
            distance = d;
          }
        }
    return best;
  };
  const closed: Run[] = [],
    open: Run[] = [];
  runs.forEach((first, index) => {
    if (used[index]) return;
    used[index] = 1;
    let points = [...first.points];
    const entities = [...first.entities];
    let length = first.length,
      widest = first.widest,
      excess = first.excess;
    const returned = () =>
      (entities.length > 1 || points.length > 2) &&
      close(points[0]!, points.at(-1)!, tolerance) &&
      length > 2 * tolerance;
    const join = (next: { run: number; end: 0 | 1 }, tail: boolean) => {
      used[next.run] = 1;
      const run = runs[next.run]!;
      const from = tail ? points.at(-1)! : points[0]!;
      const reversed = next.end === (tail ? 1 : 0);
      const along = reversed ? [...run.points].reverse() : run.points;
      excess += reversed ? -run.excess : run.excess;
      const meets = tail ? along[0]! : along.at(-1)!;
      widest = Math.max(widest, run.widest, Math.hypot(from.x - meets.x, from.y - meets.y));
      points = tail ? points.concat(along.slice(1)) : along.slice(0, -1).concat(points);
      if (tail) entities.push(...run.entities);
      else entities.unshift(...run.entities);
      length += run.length;
    };
    for (let next = find(points.at(-1)!); next && !returned(); next = find(points.at(-1)!))
      join(next, true);
    for (
      let next = returned() ? undefined : find(points[0]!);
      next && !returned();
      next = find(points[0]!)
    )
      join(next, false);
    if (returned()) {
      const a = points[0]!,
        b = points.at(-1)!;
      widest = Math.max(widest, Math.hypot(a.x - b.x, a.y - b.y));
      closed.push({ points, entities, length, widest, excess });
    } else open.push({ points, entities, length, widest, excess });
  });
  return { closed, open };
}
function nearestEnds(runs: readonly Run[]): number | undefined {
  const ends = runs.flatMap((run) => [run.points[0]!, run.points.at(-1)!]);
  let best: number | undefined;
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const d = Math.hypot(ends[i]!.x - ends[j]!.x, ends[i]!.y - ends[j]!.y);
      if (best === undefined || d < best) best = d;
    }
  return best;
}
function ringOf(run: Run): Ring | undefined {
  const points = [...run.points];
  if (points.length > 1 && close(points[0]!, points.at(-1)!, nestingTolerances.gap)) points.pop();
  const area = signedArea(points) + run.excess;
  if (points.length < 3 || Math.abs(area) < 1e-6) return undefined;
  return {
    ...run,
    points,
    flat: flat(points),
    area: Math.abs(area),
    bounds: boundsOf(points),
    parent: -1,
    depth: 0,
  };
}
/** Each ring's parent is the smallest ring around it: outlines at even depths, holes at odd. */
function nestRings(rings: Ring[]): void {
  const order = rings.map((_, index) => index).sort((a, b) => rings[b]!.area - rings[a]!.area);
  order.forEach((index, rank) => {
    const ring = rings[index]!,
      probe = ring.points[0]!;
    for (let k = rank - 1; k >= 0; k--) {
      const candidate = rings[order[k]!]!;
      const b = candidate.bounds;
      if (
        candidate.area > ring.area &&
        ring.bounds.min.x >= b.min.x - 1e-9 &&
        ring.bounds.max.x <= b.max.x + 1e-9 &&
        ring.bounds.min.y >= b.min.y - 1e-9 &&
        ring.bounds.max.y <= b.max.y + 1e-9 &&
        insideRing(probe.x, probe.y, candidate.flat)
      ) {
        ring.parent = order[k]!;
        break;
      }
    }
  });
  for (const index of order) {
    const ring = rings[index]!;
    ring.depth = ring.parent < 0 ? 0 : rings[ring.parent]!.depth + 1;
  }
}
function nearestPiece(pieces: readonly Piece[], rings: readonly Ring[], p: Point): Piece {
  let best = pieces[0]!,
    distance = Infinity;
  for (const piece of pieces) {
    const b = rings[piece.outer]!.bounds;
    const d = Math.hypot(
      Math.max(b.min.x - p.x, 0, p.x - b.max.x),
      Math.max(b.min.y - p.y, 0, p.y - b.max.y),
    );
    if (d < distance) {
      best = piece;
      distance = d;
    }
  }
  return best;
}
/** What two translated copies of a piece have in common, and a mirrored copy does not. */
function signature(piece: Piece, rings: readonly Ring[], primitives: readonly Primitive[]): string {
  const loops = [piece.outer, ...piece.holes].map((index) => rings[index]!);
  const bounds = rings[piece.outer]!.bounds;
  let area = 0,
    cx = 0,
    cy = 0,
    xx = 0,
    yy = 0,
    xy = 0;
  for (const [n, ring] of loops.entries()) {
    const sign = n === 0 ? 1 : -1,
      points = ring.points;
    const oriented = signedArea(points) >= 0 ? 1 : -1;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!;
      const x0 = a.x - bounds.min.x,
        y0 = a.y - bounds.min.y,
        x1 = b.x - bounds.min.x,
        y1 = b.y - bounds.min.y;
      const c = (x0 * y1 - x1 * y0) * sign * oriented;
      area += c / 2;
      cx += ((x0 + x1) * c) / 6;
      cy += ((y0 + y1) * c) / 6;
      xx += ((x0 * x0 + x0 * x1 + x1 * x1) * c) / 12;
      yy += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12;
      xy += ((x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c) / 24;
    }
  }
  const length = piece.open.reduce((sum, run) => sum + run.length, 0);
  const marked = piece.marks.reduce((sum, index) => sum + primitiveLength(primitives[index]!), 0);
  return [
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    area,
    cx / area,
    cy / area,
    xx,
    yy,
    xy,
    length,
    marked,
  ]
    .map((value) => Number(value.toPrecision(6)))
    .concat([piece.holes.length, piece.open.length, piece.marks.length])
    .join(',');
}
function partOf(
  pieces: readonly Piece[],
  rings: readonly Ring[],
  primitives: readonly Primitive[],
  index: number,
): Omit<Part, 'name' | 'copies'> {
  const bounds = emptyBounds();
  for (const piece of pieces) {
    const b = rings[piece.outer]!.bounds;
    extend(bounds, b.min);
    extend(bounds, b.max);
    for (const run of piece.open) for (const p of run.points) extend(bounds, p);
  }
  if (!finiteBounds(bounds)) throw new Error('A part has no extent.');
  const origin = bounds.min;
  const shift = translation(-origin.x, -origin.y);
  const local = (values: number[]) =>
    values.map((value, i) => value - (i % 2 ? origin.y : origin.x));
  const entities: PartEntity[] = [];
  const take = (indexes: readonly number[], role: CutRole) => {
    for (const entity of indexes)
      entities.push({ primitive: transformPrimitive(primitives[entity]!, shift), role });
  };
  let area = 0,
    cutLength = 0,
    pierces = 0,
    markLength = 0,
    holes = 0;
  const outlineRings: number[][] = [],
    paths: number[][] = [],
    marks: number[][] = [];
  for (const piece of pieces) {
    const outer = rings[piece.outer]!;
    outlineRings.push(local(outer.flat));
    take(outer.entities, 'outer');
    area += outer.area;
    cutLength += outer.length;
    pierces++;
    for (const hole of piece.holes) {
      const ring = rings[hole]!;
      outlineRings.push(local(ring.flat));
      take(ring.entities, 'inner');
      area -= ring.area;
      cutLength += ring.length;
      pierces++;
      holes++;
    }
    for (const run of piece.open) {
      paths.push(local(flat(run.points)));
      take(run.entities, 'open');
      cutLength += run.length;
      pierces++;
    }
    take(piece.marks, 'mark');
    for (const mark of piece.marks) {
      const primitive = primitives[mark]!;
      markLength += primitiveLength(primitive);
      const points = primitivePoints(primitive, nestingTolerances.flatten);
      if (points.length > 1) marks.push(local(flat(points)));
    }
  }
  const width = bounds.max.x - bounds.min.x,
    height = bounds.max.y - bounds.min.y;
  return {
    index,
    width,
    height,
    area,
    cutLength,
    pierces,
    markLength,
    rings: outlineRings,
    holes,
    paths,
    marks,
    entities,
    label: labelPoint(outlineRings, width, height),
  };
}
/** The sampled point farthest from every edge, inside the material. */
export function labelPoint(rings: readonly number[][], width: number, height: number): Point {
  let best: Point = { x: width / 2, y: height / 2 },
    clearance = -1;
  const steps = 24;
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) {
      const x = ((i + 0.5) * width) / steps,
        y = ((j + 0.5) * height) / steps;
      if (!insideRings(x, y, rings)) continue;
      let nearest = Infinity;
      for (const ring of rings)
        for (let k = 0, l = ring.length - 2; k < ring.length; l = k, k += 2)
          nearest = Math.min(
            nearest,
            pointSegmentDistance(x, y, ring[l]!, ring[l + 1]!, ring[k]!, ring[k + 1]!),
          );
      if (nearest > clearance) {
        clearance = nearest;
        best = { x, y };
      }
    }
  return best;
}
