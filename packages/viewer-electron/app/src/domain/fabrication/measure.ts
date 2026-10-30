/**
 * MEASUREMENT: Viewer's own reading of a part drawing, in millimetres, made on the entities the DXF
 * preview draws (`parseDrawing`), so every value names the entity ids the preview highlights.
 * Entities join into closed loops as nesting joins them. A loop at an even depth is an outline; a
 * round loop inside an outline is a hole, any other one a cut-out (docs/reference/fabrication.md).
 */
import type { Bounds, Drawing, DrawingEntity, Point } from '../previews/drawings/dxf/math';
import { pathLength, polygonArea } from '../previews/drawings/dxf/math';
import { unitInfo } from '../previews/drawings/dxf/units';
import { boundsOf, flat, insideRing, pointSegmentDistance } from '../layout/nesting/geometry';
import { chain, suggestedMarks } from '../layout/nesting/parts';
import type { PitchAxis } from './plan';

export { millimetreText, pitchAxes } from './plan';
export type { PitchAxis } from './plan';

/** Millimetres. */
export const measureTolerances = {
  /** Ends closer than this join, as nesting joins them. */
  join: 0.05,
  /** A loop whose points all lie this close to one circle is round. */
  round: 0.01,
  /** Holes whose centres differ this little in y share a row; in x, a column. */
  aligned: 0.05,
  /** Two round loops this close in centre and size are one hole drawn twice. */
  same: 0.001,
} as const;

export interface Hole {
  /** 1, 2, … in reading order: rows from the top, each from the left. */
  number: number;
  /** Every entity the hole is drawn with, as the preview numbers them. */
  entities: string[];
  centre: Point;
  diameter: number;
  /** Fitted to lines, a spline or an ellipse rather than read from arcs and circles. */
  approximate: boolean;
  /** The number of the outline it is cut from. */
  outline: number;
}
export interface Outline {
  number: number;
  entities: string[];
  bounds: Bounds;
  width: number;
  height: number;
  /** The loop as x, y pairs. */
  ring: number[];
}
/** An inner loop that is not round: a slot or a cut-out. */
export interface Cutout {
  entities: string[];
  bounds: Bounds;
  width: number;
  height: number;
  outline: number;
  ring: number[];
}
export interface Measurement {
  units: { code: number; label: string; millimetres: number };
  outlines: Outline[];
  /** Every outline's box. */
  bounds: Bounds;
  width: number;
  height: number;
  holes: Hole[];
  cutouts: Cutout[];
  notes: string[];
}
export type MeasureOutcome =
  { status: 'measured'; measurement: Measurement } | { status: 'refused'; reason: string };

export interface Pitch {
  axis: PitchAxis;
  value: number;
  /** Hole numbers. */
  from: number;
  to: number;
  entities: string[];
}

/** Entities a cutter follows; text, points, solids and faces are not cut. */
const cutTypes = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE']);
const curved = new Set(['CIRCLE', 'ARC']);
const polylines = new Set(['LWPOLYLINE', 'POLYLINE']);

interface Loop {
  points: Point[];
  entities: string[];
}
interface Ring extends Loop {
  area: number;
  bounds: Bounds;
  flat: number[];
  parent: number;
  depth: number;
}

const countText = (count: number, one: string, many = one + 's') =>
  `${count} ${count === 1 ? one : many}`;

export function measureDrawing(drawing: Drawing): MeasureOutcome {
  const unit = unitInfo(drawing.units);
  if (!unit.mm)
    return {
      status: 'refused',
      reason: drawing.units
        ? `The drawing's units code ${drawing.units} is not one Viewer knows, so it is not measured.`
        : 'The drawing does not give its units ($INSUNITS), so it is not measured.',
    };
  const scale = unit.mm;
  const notes: string[] = [];
  const hidden = new Set(
    drawing.layers.filter((layer) => !layer.visible).map((layer) => layer.name),
  );
  const marks = new Set(
    suggestedMarks(
      drawing.layers.map((layer) => ({ name: layer.name, count: layer.count, hidden: false })),
    ),
  );
  const byID = new Map(drawing.entities.map((entity) => [entity.id, entity]));
  // An entity drawn twice is cut once; its twin's id stays with it for the preview.
  const twins = new Map<string, string[]>();
  const kept = new Map<string, string>();
  const cuts: DrawingEntity[] = [];
  for (const entity of drawing.entities) {
    if (!cutTypes.has(entity.type) || hidden.has(entity.layer) || marks.has(entity.layer)) continue;
    const key = entityKey(entity);
    const first = kept.get(key);
    if (first) twins.set(first, [...(twins.get(first) ?? []), entity.id]);
    else {
      kept.set(key, entity.id);
      cuts.push(entity);
    }
  }
  if (!cuts.length)
    return { status: 'refused', reason: 'The drawing has no lines, arcs or circles to measure.' };
  const twinCount = [...twins.values()].reduce((sum, list) => sum + list.length, 0);
  if (twinCount)
    notes.push(
      `${countText(twinCount, 'entity is', 'entities are')} drawn twice; each counts once.`,
    );
  const withTwins = (ids: readonly string[]) => ids.flatMap((id) => [id, ...(twins.get(id) ?? [])]);

  const loops: Loop[] = [];
  const runs: {
    points: Point[];
    entities: number[];
    length: number;
    widest: number;
    excess: number;
  }[] = [];
  for (const entity of cuts) {
    const points = entity.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    if (entity.closed) loops.push({ points: opened(points), entities: [entity.id] });
    else
      runs.push({
        points,
        entities: [Number(entity.id)],
        length: pathLength(points),
        widest: 0,
        excess: 0,
      });
  }
  const joined = chain(runs, measureTolerances.join);
  for (const run of joined.closed)
    loops.push({ points: opened(run.points), entities: run.entities.map(String) });
  if (joined.open.length) notes.push(`${countText(joined.open.length, 'open path')} not measured.`);

  const rings = nest(
    loops.flatMap((loop): Ring[] => {
      const area = polygonArea(loop.points);
      if (loop.points.length < 3 || area < 1e-9) return [];
      return [
        {
          ...loop,
          entities: withTwins(loop.entities),
          area,
          bounds: boundsOf(loop.points),
          flat: flat(loop.points),
          parent: -1,
          depth: 0,
        },
      ];
    }),
  );
  if (!rings.length) return { status: 'refused', reason: 'The drawing has no closed outline.' };

  const outer = readingOrder(
    rings.filter((ring) => ring.depth % 2 === 0),
    (ring) => ({ x: ring.bounds.min.x, y: ring.bounds.max.y }),
  );
  const outlines: Outline[] = outer.map((ring, index) => ({
    number: index + 1,
    entities: ring.entities,
    bounds: ring.bounds,
    width: ring.bounds.max.x - ring.bounds.min.x,
    height: ring.bounds.max.y - ring.bounds.min.y,
    ring: ring.flat,
  }));
  const outlineOf = (ring: Ring) => outer.indexOf(rings[ring.parent]!) + 1;
  const found: Omit<Hole, 'number'>[] = [];
  const cutouts: Cutout[] = [];
  for (const ring of rings) {
    if (ring.depth % 2 === 0) continue;
    const entities = ring.entities.map((id) => byID.get(id)!);
    const round = roundness(ring, entities, scale);
    if (round) {
      const twin = found.find(
        (hole) =>
          Math.hypot(hole.centre.x - round.centre.x, hole.centre.y - round.centre.y) <=
            measureTolerances.same &&
          Math.abs(hole.diameter - round.diameter) <= measureTolerances.same,
      );
      if (twin) {
        notes.push(
          `A hole is drawn twice: entities ${twin.entities.join(', ')} and ${ring.entities.join(', ')}.`,
        );
        twin.entities.push(...ring.entities);
      } else found.push({ ...round, entities: ring.entities, outline: outlineOf(ring) });
    } else
      cutouts.push({
        entities: ring.entities,
        bounds: ring.bounds,
        width: ring.bounds.max.x - ring.bounds.min.x,
        height: ring.bounds.max.y - ring.bounds.min.y,
        outline: outlineOf(ring),
        ring: ring.flat,
      });
  }
  const holes = readingOrder(found, (hole) => hole.centre).map((hole, index) => ({
    ...hole,
    number: index + 1,
  }));
  const approximate = holes.filter((hole) => hole.approximate);
  if (approximate.length)
    notes.push(
      `${countText(approximate.length, 'hole is', 'holes are')} fitted to lines or splines: ${approximate
        .map((hole) => hole.number)
        .join(', ')}.`,
    );
  const bounds = boundsOf(outlines.flatMap((outline) => [outline.bounds.min, outline.bounds.max]));
  return {
    status: 'measured',
    measurement: {
      units: { code: drawing.units, label: unit.label, millimetres: scale },
      outlines,
      bounds,
      width: bounds.max.x - bounds.min.x,
      height: bounds.max.y - bounds.min.y,
      holes,
      cutouts,
      notes,
    },
  };
}

/** A loop's points without the closing repeat of its first. */
function opened(points: Point[]): Point[] {
  const first = points[0],
    last = points.at(-1);
  return first &&
    last &&
    points.length > 1 &&
    Math.hypot(first.x - last.x, first.y - last.y) <= measureTolerances.join
    ? points.slice(0, -1)
    : points;
}
function entityKey(entity: DrawingEntity): string {
  const r = (value: number) => Math.round(value * 1e6);
  const ends = [entity.points[0], entity.points.at(-1)]
    .map((p) => (p ? `${r(p.x)},${r(p.y)}` : ''))
    .sort()
    .join(';');
  return [
    entity.type === 'CIRCLE' || entity.type === 'ARC' ? 'arc' : entity.type,
    ends,
    entity.points.length,
    r(entity.length ?? 0),
    r(entity.radius ?? 0),
    `${r(entity.bounds.min.x)},${r(entity.bounds.min.y)},${r(entity.bounds.max.x)},${r(entity.bounds.max.y)}`,
  ].join('|');
}
/** Each ring's parent is the smallest ring around it; depth counts the rings around it. */
function nest(rings: Ring[]): Ring[] {
  const order = rings.map((_, index) => index).sort((a, b) => rings[b]!.area - rings[a]!.area);
  order.forEach((index, rank) => {
    const ring = rings[index]!,
      probe = ring.points[0]!;
    for (let k = rank - 1; k >= 0; k--) {
      const candidate = rings[order[k]!]!,
        b = candidate.bounds;
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
  return rings;
}
/** Items in reading order: rows from the top, each row from the left. */
function readingOrder<T>(items: readonly T[], at: (item: T) => Point): T[] {
  const sorted = [...items].sort((a, b) => at(b).y - at(a).y);
  const rows: T[][] = [];
  for (const item of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(at(row[0]!).y - at(item).y) <= measureTolerances.aligned) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => at(a).x - at(b).x));
}

/** The circle a loop follows, when it follows one: read from its arcs and circles, otherwise fitted
 * to its points and checked against every chord between them. */
function roundness(
  ring: Ring,
  entities: readonly DrawingEntity[],
  scale: number,
): { centre: Point; diameter: number; approximate: boolean } | undefined {
  if (entities.every((entity) => curved.has(entity.type) && entity.radius !== undefined)) {
    const circles = entities.map((entity) => {
      const centre = entity.snaps.find((snap) => snap.kind === 'Center')!.point;
      return { x: centre.x * scale, y: centre.y * scale, radius: entity.radius! * scale };
    });
    const [first] = circles;
    if (
      first &&
      circles.every(
        (circle) =>
          Math.hypot(circle.x - first.x, circle.y - first.y) <= measureTolerances.same &&
          Math.abs(circle.radius - first.radius) <= measureTolerances.same,
      )
    )
      return { centre: { x: first.x, y: first.y }, diameter: 2 * first.radius, approximate: false };
  }
  const fit = fitCircle(ring.points);
  if (!fit) return undefined;
  const points = ring.points;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!,
      b = points[(index + 1) % points.length]!;
    const chord = Math.hypot(a.x - b.x, a.y - b.y);
    // A chord's middle falls inside the circle by its sagitta: a polygon is not round.
    if (chord > fit.radius / 2 || (chord * chord) / (8 * fit.radius) > measureTolerances.round)
      return undefined;
    if (
      Math.abs(Math.hypot(a.x - fit.centre.x, a.y - fit.centre.y) - fit.radius) >
      measureTolerances.round
    )
      return undefined;
  }
  // Arcs and bulged polylines lie on their circle; lines, splines and ellipses are fitted.
  const exact = entities.every(
    (entity) =>
      curved.has(entity.type) ||
      (polylines.has(entity.type) &&
        entity.points.length > entity.snaps.filter((snap) => snap.kind === 'Endpoint').length + 1),
  );
  return { centre: fit.centre, diameter: 2 * fit.radius, approximate: !exact };
}
/** The least-squares circle through points (Kåsa), about their mean for precision. */
function fitCircle(points: readonly Point[]): { centre: Point; radius: number } | undefined {
  const n = points.length;
  if (n < 3) return undefined;
  let mx = 0,
    my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const p of points) {
    const u = p.x - mx,
      v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const determinant = suu * svv - suv * suv;
  if (!(Math.abs(determinant) > 1e-18 * (suu + svv) ** 2)) return undefined;
  const a = (suuu + suvv) / 2,
    b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / determinant,
    vc = (b * suu - a * suv) / determinant;
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return Number.isFinite(radius) && radius > 0
    ? { centre: { x: uc + mx, y: vc + my }, radius }
    : undefined;
}

/** The hole an entity id belongs to. */
export const holeOf = (measurement: Measurement, entity: string): Hole | undefined =>
  measurement.holes.find((hole) => hole.entities.includes(entity));
export function pitchBetween(a: Hole, b: Hole, axis: PitchAxis): number {
  const dx = b.centre.x - a.centre.x,
    dy = b.centre.y - a.centre.y;
  return axis === 'x' ? Math.abs(dx) : axis === 'y' ? Math.abs(dy) : Math.hypot(dx, dy);
}
/** The axis two holes line up on, or centre to centre when they line up on neither. */
export function alignedAxis(a: Hole, b: Hole): PitchAxis {
  if (Math.abs(a.centre.y - b.centre.y) <= measureTolerances.aligned) return 'x';
  if (Math.abs(a.centre.x - b.centre.x) <= measureTolerances.aligned) return 'y';
  return 'centre';
}
export const pitchOf = (a: Hole, b: Hole, axis: PitchAxis): Pitch => ({
  axis,
  value: pitchBetween(a, b, axis),
  from: a.number,
  to: b.number,
  entities: [...a.entities, ...b.entities],
});
/** Neighbouring holes of each outline in reading order: along x within each row from the top, then
 * along y within each column from the left. */
export function rowPitches(measurement: Measurement): Pitch[] {
  const pitches: Pitch[] = [];
  for (const outline of measurement.outlines) {
    const holes = measurement.holes.filter((hole) => hole.outline === outline.number);
    for (const axis of ['x', 'y'] as const) {
      const across = axis === 'x' ? 'y' : 'x';
      // Rows run top to bottom and left to right; columns left to right and top to bottom.
      const sign = axis === 'x' ? -1 : 1;
      const lines: Hole[][] = [];
      for (const hole of [...holes].sort((a, b) => sign * (a.centre[across] - b.centre[across]))) {
        const line = lines.at(-1);
        if (
          line &&
          Math.abs(line[0]!.centre[across] - hole.centre[across]) <= measureTolerances.aligned
        )
          line.push(hole);
        else lines.push([hole]);
      }
      for (const line of lines) {
        line.sort((a, b) => -sign * (a.centre[axis] - b.centre[axis]));
        for (let index = 1; index < line.length; index++)
          pitches.push(pitchOf(line[index - 1]!, line[index]!, axis));
      }
    }
  }
  return pitches;
}
/** Each hole's nearest neighbour in its outline, centre to centre, once for each pair: the
 * pitches of holes that line up on neither axis, such as a bolt circle. */
export function nearestPitches(measurement: Measurement): Pitch[] {
  const pairs = new Map<string, Pitch>();
  for (const hole of measurement.holes) {
    let nearest: Hole | undefined,
      distance = Infinity;
    for (const other of measurement.holes) {
      if (other === hole || other.outline !== hole.outline) continue;
      const between = pitchBetween(hole, other, 'centre');
      if (between < distance) {
        distance = between;
        nearest = other;
      }
    }
    if (!nearest) continue;
    const [a, b] = hole.number < nearest.number ? [hole, nearest] : [nearest, hole];
    const key = `${a.number}:${b.number}`;
    if (!pairs.has(key)) pairs.set(key, pitchOf(a, b, 'centre'));
  }
  return [...pairs.values()];
}
/** The thinnest material around a hole placed at `centre`: to its outline, the cut-outs and every
 * hole not in `moving`. Negative when it would cut into one of them. */
export function webAround(
  measurement: Measurement,
  hole: Hole,
  centre: Point,
  moving: ReadonlySet<number>,
): number {
  const radius = hole.diameter / 2;
  const outline = measurement.outlines.find((item) => item.number === hole.outline);
  let web = Infinity;
  const toRing = (ring: readonly number[]) => {
    let nearest = Infinity;
    for (let k = 0, l = ring.length - 2; k < ring.length; l = k, k += 2)
      nearest = Math.min(
        nearest,
        pointSegmentDistance(centre.x, centre.y, ring[l]!, ring[l + 1]!, ring[k]!, ring[k + 1]!),
      );
    return nearest;
  };
  if (outline)
    web = insideRing(centre.x, centre.y, outline.ring)
      ? Math.min(web, toRing(outline.ring) - radius)
      : -radius;
  for (const cutout of measurement.cutouts)
    if (cutout.outline === hole.outline)
      web = Math.min(
        web,
        insideRing(centre.x, centre.y, cutout.ring) ? -radius : toRing(cutout.ring) - radius,
      );
  for (const other of measurement.holes)
    if (!moving.has(other.number) && other.outline === hole.outline)
      web = Math.min(
        web,
        Math.hypot(other.centre.x - centre.x, other.centre.y - centre.y) -
          radius -
          other.diameter / 2,
      );
  return web;
}

/** Holes and pitches past these are left out of a summary, which says so. */
const summaryLimits = { holes: 200, pitches: 400 } as const;
const rounded = (value: number) => Math.round(value * 1000) / 1000;
/** The measurement as the model reads it: millimetres to the thousandth, entity ids, no paths. */
export function measurementSummary(measurement: Measurement) {
  const rows = rowPitches(measurement);
  const paired = new Set(rows.map((pitch) => `${pitch.from}:${pitch.to}`));
  const pitches = [
    ...rows,
    ...nearestPitches(measurement).filter(
      (pitch) =>
        !paired.has(`${pitch.from}:${pitch.to}`) && !paired.has(`${pitch.to}:${pitch.from}`),
    ),
  ];
  const notes = [...measurement.notes];
  if (measurement.holes.length > summaryLimits.holes)
    notes.push(
      `Only the first ${summaryLimits.holes} of ${measurement.holes.length} holes are listed.`,
    );
  if (pitches.length > summaryLimits.pitches)
    notes.push(`Only the first ${summaryLimits.pitches} of ${pitches.length} pitches are listed.`);
  return {
    units: 'mm' as const,
    drawnIn: measurement.units.label,
    size: { width: rounded(measurement.width), height: rounded(measurement.height) },
    outlines: measurement.outlines.map((outline) => ({
      number: outline.number,
      entities: outline.entities,
      width: rounded(outline.width),
      height: rounded(outline.height),
    })),
    holes: measurement.holes.slice(0, summaryLimits.holes).map((hole) => ({
      number: hole.number,
      entities: hole.entities,
      centre: [rounded(hole.centre.x), rounded(hole.centre.y)],
      diameter: rounded(hole.diameter),
      outline: hole.outline,
      ...(hole.approximate ? { approximate: true } : {}),
    })),
    pitches: pitches.slice(0, summaryLimits.pitches).map((pitch) => ({
      axis: pitch.axis,
      value: rounded(pitch.value),
      holes: [pitch.from, pitch.to],
      entities: pitch.entities,
    })),
    cutouts: measurement.cutouts.map((cutout) => ({
      entities: cutout.entities,
      width: rounded(cutout.width),
      height: rounded(cutout.height),
      outline: cutout.outline,
    })),
    notes,
  };
}
export type MeasurementSummary = ReturnType<typeof measurementSummary>;
