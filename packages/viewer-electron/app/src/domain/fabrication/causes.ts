/**
 * ONE CAUSE, ONE FINDING: confirmed pitch findings whose corrections move the same holes of one DXF
 * by the same amount share one cause, such as a hole drawn 2 mm off, and one correction fixes them
 * all. They are shown as one finding; each reading keeps its own grade and quote
 * (docs/reference/fabrication.md).
 */
import type { Finding } from './answer';
import type { Grade } from './grade';
import type { Hole, Measurement } from './measure';
import type { DXFCorrection } from './plan';
import type { Point } from '../previews/drawings/dxf/math';
import { plannedMove } from './correction';
import { lengthText } from './grade';
import { listText, millimetreText } from './plan';

/** A finding of the answer with its grade and, when it has one, its correction. */
export interface CauseReading {
  finding: Finding;
  grade: Grade;
  plan?: DXFCorrection;
}
export interface SharedCause {
  /** The readings it explains, by their order in the answer; the first leads. */
  readings: number[];
  /** "Hole 2 is 2.00 mm off along x: the 60 mm pitch reads 58.00 mm and the 28 mm pitch reads
   * 30.00 mm. Moving it, with hole 5, fixes both." */
  summary: string;
  /** The first reading's correction, which sets the others' pitches too. */
  plan: DXFCorrection;
  /** Confirmed, with every reading's reason. */
  grade: Grade;
}
/** Millimetres within which two moves are the same. */
const same = 1e-6;
interface Move {
  holes: Hole[];
  shift: Point;
}
const sameMove = (a: Move, b: Move) =>
  a.holes.length === b.holes.length &&
  a.holes.every((hole) => b.holes.includes(hole)) &&
  Math.abs(a.shift.x - b.shift.x) <= same &&
  Math.abs(a.shift.y - b.shift.y) <= same;

/** The causes several readings share, in the answer's order. A reading belongs to one at most. */
export function sharedCauses(
  readings: readonly CauseReading[],
  measurement: (ref: string) => Measurement | undefined,
): SharedCause[] {
  const moves = readings.map((reading) => {
    const measured = reading.finding.dxf && measurement(reading.finding.dxf.ref);
    return reading.plan && reading.grade.status === 'confirmed' && measured
      ? plannedMove(reading.plan, measured)
      : undefined;
  });
  const taken = new Set<number>();
  const causes: SharedCause[] = [];
  readings.forEach((reading, index) => {
    const move = moves[index];
    if (!move || taken.has(index)) return;
    const group = [index];
    for (let other = index + 1; other < readings.length; other++) {
      const next = moves[other];
      if (
        next &&
        !taken.has(other) &&
        readings[other]!.finding.dxf!.ref === reading.finding.dxf!.ref &&
        sameMove(move, next)
      )
        group.push(other);
    }
    if (group.length < 2) return;
    for (const member of group) taken.add(member);
    causes.push(
      cause(
        group.map((member) => readings[member]!),
        group,
        move,
      ),
    );
  });
  return causes;
}

function cause(members: readonly CauseReading[], readings: number[], move: Move): SharedCause {
  const [lead] = members;
  const { holes, shift } = move;
  const distance = Math.hypot(shift.x, shift.y);
  const direction =
    Math.abs(shift.y) <= same ? ' along x' : Math.abs(shift.x) <= same ? ' along y' : '';
  const pitches = members.map(
    ({ finding, grade }) =>
      `the ${lengthText(finding.drawing!.value!)} pitch reads ${millimetreText(grade.measured!)}`,
  );
  const others = holes.slice(1).map((hole) => hole.number);
  const fixes = members.length === 2 ? 'both' : `all ${members.length}`;
  const summary =
    `Hole ${holes[0]!.number} is ${millimetreText(distance)} off${direction}: ${listText(pitches)}. ` +
    `Moving it${others.length ? `, with ${others.length === 1 ? 'hole' : 'holes'} ${listText(others.map(String))},` : ''} fixes ${fixes}.`;
  return {
    readings,
    summary,
    plan: {
      ...lead!.plan!,
      also: members.slice(1).map(({ plan }) => ({
        from: plan!.from,
        to: plan!.to,
        axis: plan!.axis,
        target: plan!.target,
        measured: plan!.measured,
      })),
    },
    grade: {
      ...lead!.grade,
      entities: [...new Set(members.flatMap(({ grade }) => grade.entities))],
      reason: members.map(({ grade }) => grade.reason).join(' '),
    },
  };
}
