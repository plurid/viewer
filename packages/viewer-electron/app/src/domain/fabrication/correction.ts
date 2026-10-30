/**
 * A DXF CORRECTION, made: holes moved so one pitch becomes the value the drawing gives, the copy
 * written as nesting writes its sheets (`partDXF`) and measured again. The plan and its report are
 * in plan.ts; the desktop saves the copy (docs/reference/fabrication.md).
 */
import type { Drawing, DrawingEntity, Point } from '../previews/drawings/dxf/math';
import type { Primitive } from '../layout/nesting/drawing';
import type { Finding } from './answer';
import type { Grade } from './grade';
import type { Hole, Measurement } from './measure';
import type { CorrectionReport, DXFCorrection, PitchAxis } from './plan';
import { parseDrawing } from '../previews/drawings/dxf/geometry';
import { readCutDrawing, transformPrimitive } from '../layout/nesting/drawing';
import { partDXF } from '../layout/nesting/dxf-writer';
import { translation } from '../layout/nesting/geometry';
import {
  alignedAxis,
  holeOf,
  measureDrawing,
  millimetreText,
  pitchBetween,
  webAround,
} from './measure';

/** Positions agree this closely in millimetres, after writing to six decimals. */
const written = 1e-5;
/** A web thinner than this is pointed out in the notes, in millimetres. */
const thinWeb = 1;

/** A reviewed correction for a confirmed pitch finding: the drawing's value is the target, and
 * the holes the finding proposes to move move. Undefined when the finding offers none. */
export function correctionFor(
  finding: Finding,
  grade: Grade,
  measurement: Measurement,
): DXFCorrection | undefined {
  if (
    finding.kind !== 'pitch' ||
    grade.status !== 'confirmed' ||
    !finding.dxf ||
    !finding.proposal ||
    finding.drawing?.value === null ||
    finding.drawing?.value === undefined ||
    grade.measured === undefined
  )
    return undefined;
  const holes = [...new Set(finding.dxf.entities.map((id) => holeOf(measurement, id)))];
  const moving = new Set(finding.proposal.move.map((id) => holeOf(measurement, id)));
  if (holes.length !== 2 || holes.some((hole) => !hole) || moving.has(undefined)) return undefined;
  const [a, b] = holes as [Hole, Hole];
  if (moving.has(a) === moving.has(b)) return undefined;
  const [still, moved] = moving.has(b) ? [a, b] : [b, a];
  return {
    kind: 'dxf-correction',
    format: 'dxf',
    from: still.entities[0]!,
    to: moved.entities[0]!,
    axis: finding.dxf.axis ?? alignedAxis(a, b),
    target: finding.drawing.value,
    measured: grade.measured,
    move: [...moving]
      .filter((hole): hole is Hole => !!hole && hole !== moved)
      .map((hole) => hole.entities[0]!),
  };
}

function measured(drawing: Drawing, name: string): Measurement {
  const outcome = measureDrawing(drawing);
  if (outcome.status === 'refused') throw new Error(`${name}: ${outcome.reason}`);
  return outcome.measurement;
}
const near = (a: Point, b: Point, tolerance: number) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

/** The pitch a corrected copy measures between the holes now at `from` and `to`. */
export function measureCorrection(
  source: string,
  report: Pick<CorrectionReport, 'axis' | 'moved'>,
  from: Point,
): { pitch: number; measurement: Measurement } {
  const measurement = measured(parseDrawing(source), 'The corrected copy');
  const at = (centre: Point) =>
    measurement.holes.find((hole) => near(hole.centre, centre, written));
  const still = at(from),
    moved = at(report.moved[0]!.to);
  if (!still || !moved) throw new Error('The corrected copy lost a hole it should keep.');
  return { pitch: pitchBetween(still, moved, report.axis), measurement };
}

/**
 * The corrected copy's text and its report, measured again from that text. Refused, with the
 * reason, when the drawing changed since review, a named entity is not a hole, the holes cannot
 * move along the axis, or a moved hole would cut into the outline, a cut-out or another hole.
 */
export function correctDrawing(
  source: string,
  plan: DXFCorrection,
  /** The drawing's file name, for the reasons it gives. */
  name: string,
): { text: string; report: CorrectionReport; from: Point } {
  const drawing = parseDrawing(source);
  const before = measured(drawing, name);
  const entities = new Map(drawing.entities.map((item) => [item.id, item]));
  const hole = (id: string) => {
    const found = holeOf(before, id);
    if (!found) throw new Error(`Entity ${id} is not a hole in ${name}.`);
    return found;
  };
  const still = hole(plan.from),
    target = hole(plan.to);
  const moving = [target];
  for (const id of plan.move) {
    const found = hole(id);
    if (!moving.includes(found)) moving.push(found);
  }
  if (moving.includes(still)) throw new Error(`Hole ${still.number} cannot both stay and move.`);
  const fitted = moving.find((item) => item.approximate);
  if (fitted)
    throw new Error(
      `Hole ${fitted.number} is drawn with lines or a spline; Viewer moves holes drawn with circles, arcs or polylines.`,
    );
  const current = pitchBetween(still, target, plan.axis);
  if (Math.abs(current - plan.measured) > written)
    throw new Error(
      `${name} changed since it was checked: the pitch is now ${millimetreText(current)}, not ${millimetreText(plan.measured)}. Check it again.`,
    );
  const shift = shiftFor(still, target, plan.axis, plan.target - current);
  const numbers = new Set(moving.map((item) => item.number));
  let web = Infinity;
  for (const item of moving) {
    const centre = { x: item.centre.x + shift.x, y: item.centre.y + shift.y };
    const left = webAround(before, item, centre, numbers);
    if (left <= 0)
      throw new Error(
        `Moving hole ${item.number} by ${millimetreText(Math.hypot(shift.x, shift.y))} would cut into the part. Choose other holes to move.`,
      );
    web = Math.min(web, left);
  }

  const cut = readCutDrawing(source);
  const scale = before.units.millimetres;
  const step = translation(shift.x / scale, shift.y / scale);
  const primitives = [...cut.primitives];
  const taken = new Set<number>();
  for (const item of moving)
    for (const id of item.entities) {
      const found = entities.get(id);
      const index = found && primitiveFor(primitives, taken, found, scale);
      if (index === undefined) throw new Error(`Viewer could not find entity ${id} to move it.`);
      taken.add(index);
      primitives[index] = transformPrimitive(primitives[index]!, step);
    }
  const text = partDXF({
    primitives,
    units: cut.units,
    layers: cut.layers.filter((layer) => !layer.hidden).map((layer) => layer.name),
  });

  const notes: string[] = [];
  const left = Object.entries(cut.skipped).filter(([type]) => type !== 'tilted');
  if (left.length)
    notes.push(
      `Left out of the copy, as nesting leaves them out: ${left.map(([type, count]) => `${count} ${type.toLowerCase()}`).join(', ')}.`,
    );
  const hidden = cut.layers.filter((layer) => layer.hidden);
  if (hidden.length)
    notes.push(`Hidden layers left out: ${hidden.map((layer) => layer.name).join(', ')}.`);
  if (web < thinWeb)
    notes.push(`Only ${millimetreText(web)} of material is left beside a moved hole.`);
  const report: CorrectionReport = {
    axis: plan.axis,
    target: plan.target,
    before: current,
    after: Number.NaN,
    shift,
    moved: moving.map((item) => ({
      number: item.number,
      entities: item.entities,
      corrected: [],
      from: item.centre,
      to: { x: item.centre.x + shift.x, y: item.centre.y + shift.y },
    })),
    web,
    notes,
  };
  const again = measureCorrection(text, report, still.centre);
  checkCopy(before, again.measurement, report);
  report.after = again.pitch;
  if (Math.abs(report.after - plan.target) > written)
    throw new Error(
      `The corrected copy measures ${millimetreText(report.after)}, not ${millimetreText(plan.target)}. Nothing was saved.`,
    );
  return { text, report, from: still.centre };
}

/** How far to move so the pitch changes by `change`: along the axis, away from the hole that stays
 * when the pitch grows. */
function shiftFor(still: Hole, moved: Hole, axis: PitchAxis, change: number): Point {
  const dx = moved.centre.x - still.centre.x,
    dy = moved.centre.y - still.centre.y;
  if (axis === 'centre') {
    const length = Math.hypot(dx, dy);
    if (length <= written) throw new Error('The two holes share a centre.');
    return { x: (dx / length) * change, y: (dy / length) * change };
  }
  const along = axis === 'x' ? dx : dy;
  if (Math.abs(along) <= written)
    throw new Error(
      `Holes ${still.number} and ${moved.number} share their ${axis} position; set the pitch along the other axis or centre to centre.`,
    );
  const signed = Math.sign(along) * change;
  return axis === 'x' ? { x: signed, y: 0 } : { x: 0, y: signed };
}

/** Every hole of the original is in the copy: the moved ones where they were sent, the others
 * where they were; each moved hole learns its ids in the copy. */
function checkCopy(before: Measurement, after: Measurement, report: CorrectionReport): void {
  if (
    after.holes.length !== before.holes.length ||
    after.outlines.length !== before.outlines.length
  )
    throw new Error(
      'The corrected copy does not hold the same outlines and holes. Nothing was saved.',
    );
  const moved = new Map(report.moved.map((item) => [item.number, item]));
  for (const hole of before.holes) {
    const item = moved.get(hole.number);
    const expected = item ? item.to : hole.centre;
    const found = after.holes.find(
      (candidate) =>
        near(candidate.centre, expected, written) &&
        Math.abs(candidate.diameter - hole.diameter) <= written,
    );
    if (!found) throw new Error(`The corrected copy lost hole ${hole.number}. Nothing was saved.`);
    if (item) item.corrected = found.entities;
  }
}

/** The cut primitive a preview entity is: a circle or arc by centre, radius and start, a polyline by
 * its vertices. */
function primitiveFor(
  primitives: readonly Primitive[],
  taken: ReadonlySet<number>,
  entity: DrawingEntity,
  scale: number,
): number | undefined {
  const tolerance = written / scale;
  const close = (a: Point, b: Point) => near(a, b, tolerance);
  const centre = entity.snaps.find((snap) => snap.kind === 'Center')?.point;
  const first = entity.points[0];
  const ends = entity.snaps.filter((snap) => snap.kind === 'Endpoint').map((snap) => snap.point);
  const index = primitives.findIndex((primitive, at) => {
    if (taken.has(at)) return false;
    if (primitive.kind === 'arc')
      return (
        (entity.type === 'CIRCLE' || entity.type === 'ARC') &&
        !!centre &&
        !!first &&
        entity.radius !== undefined &&
        close(primitive.center, centre) &&
        Math.abs(primitive.radius - entity.radius) <= tolerance &&
        (entity.type === 'CIRCLE' ||
          close(
            {
              x: primitive.center.x + primitive.radius * Math.cos(primitive.start),
              y: primitive.center.y + primitive.radius * Math.sin(primitive.start),
            },
            first,
          ))
      );
    if (primitive.kind === 'polyline')
      return (
        (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') &&
        primitive.vertices.length === ends.length &&
        primitive.vertices.every((vertex, k) => close(vertex, ends[k]!))
      );
    return false;
  });
  return index < 0 ? undefined : index;
}
