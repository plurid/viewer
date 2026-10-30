/**
 * GRADING: each finding of a model's answer against Viewer's own measurement of the DXF it names.
 * Confirmed: Viewer measures the finding's DXF value, within tolerance, and that differs from the
 * drawing's value by more than the tolerance. Refuted: Viewer measures otherwise. Unverified: Viewer
 * cannot measure it, as with a claim only a photo shows. The model's numbers are never trusted
 * (docs/reference/fabrication.md).
 */
import type { Finding, InventoryItem } from './answer';
import type { FindingGrade } from '../tours/tour';
import type { Hole, MeasureOutcome, Measurement, PitchAxis } from './measure';
import { alignedAxis, holeOf, millimetreText, pitchBetween } from './measure';
import { readJobName } from './names';

/** Millimetres between two lengths that count as the same; counts must match exactly. */
export const gradeTolerance = 0.05;

export interface Grade {
  finding: string;
  /** The grades a tour shows (`findingGrades`). */
  status: FindingGrade;
  /** Viewer's own value, in millimetres or pieces, when it measured one. */
  measured?: number;
  /** What Viewer measured, for the preview to highlight. */
  entities: string[];
  /** The values and the reason, in a sentence or two. */
  reason: string;
  tolerance: number;
}
/** What grading reads, resolved by ref: the job's inventory, its DXF measurements and page text. */
export interface GradeJob {
  inventory: readonly InventoryItem[];
  /** A DXF part's file name and measurement. */
  dxf(ref: string): { name: string; outcome: MeasureOutcome } | undefined;
  /** A drawing or request page's text; undefined when the page has none, such as a scan. */
  text?(ref: string, page: number): string | undefined;
  /** Millimetres; `gradeTolerance` unless given. */
  tolerance?: number;
}

/** What a value counts. */
type Unit = 'mm' | 'pieces' | 'holes';
const nouns: Record<Exclude<Unit, 'mm'>, [one: string, many: string]> = {
  pieces: ['piece', 'pieces'],
  holes: ['hole', 'holes'],
};
/** "50 mm", "12.5 mm", "4 pieces". */
function amount(value: number, unit: Unit): string {
  if (unit === 'mm') return `${Number(value.toFixed(3)).toLocaleString('en')} mm`;
  const [one, many] = nouns[unit];
  return `${value.toLocaleString('en')} ${value === 1 ? one : many}`;
}
const axisText: Record<PitchAxis, string> = {
  x: 'along x',
  y: 'along y',
  centre: 'centre to centre',
};
/** Text as it compares: one form of each character, case and spacing ignored. */
const squashed = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/⌀/g, 'ø').replace(/\s+/g, '');
/** Whether a quote is on a page's text, ignoring case and spacing. */
export const quoteOn = (text: string, quote: string) => squashed(text).includes(squashed(quote));
/** Whether a quote gives a value: one of its numbers is it, a decimal comma read as a point. */
export const quoteGives = (quote: string, value: number) =>
  (quote.match(/\d+(?:[.,]\d+)?/g) ?? []).some(
    (number) => Math.abs(Number(number.replace(',', '.')) - value) < 1e-9,
  );

interface Reading {
  value: number;
  unit: Unit;
  /** "Viewer measured 48.00 mm between holes 1 and 2 along x". */
  lead: string;
  entities: string[];
}

export function gradeFinding(finding: Finding, job: GradeJob): Grade {
  const tolerance = job.tolerance ?? gradeTolerance;
  const verdict = (status: FindingGrade, reason: string, reading?: Reading): Grade => ({
    finding: finding.id,
    status,
    ...(reading ? { measured: reading.value } : {}),
    entities: reading?.entities ?? [],
    reason,
    tolerance: reading?.unit === 'mm' ? tolerance : 0,
  });
  const unverified = (reason: string, reading?: Reading) => verdict('unverified', reason, reading);
  const byRef = new Map(job.inventory.map((item) => [item.ref, item]));

  if (!finding.dxf)
    return unverified(
      finding.photo
        ? 'Only a photo shows this; Viewer measures DXF drawings.'
        : 'The finding names no DXF part, so Viewer has nothing to measure.',
    );
  if (finding.kind === 'material' || finding.kind === 'other')
    return unverified(
      finding.kind === 'material'
        ? 'Viewer does not measure material; check it against the request.'
        : 'Viewer has no measurement for this kind of finding.',
    );
  const part = byRef.get(finding.dxf.ref);
  const read = part?.kind === 'dxf' ? job.dxf(part.ref) : undefined;
  if (!part || !read) return unverified(`${finding.dxf.ref} is not a DXF part in this job.`);

  if (finding.drawing) {
    const source = byRef.get(finding.drawing.ref);
    if (!source || (source.kind !== 'drawing' && source.kind !== 'request'))
      return unverified(`${finding.drawing.ref} is not a drawing or request in this job.`);
    const { quote, page } = finding.drawing;
    const text = quote ? job.text?.(source.ref, page ?? 1) : undefined;
    if (quote && text && !quoteOn(text, quote))
      return unverified(
        `“${quote}” is not on page ${page ?? 1} of ${source.name}, so the ${source.kind} value is unconfirmed.`,
      );
  }

  const reading =
    finding.kind === 'thickness' || finding.kind === 'quantity'
      ? nameReading(finding.kind, read.name)
      : read.outcome.status === 'refused'
        ? read.outcome.reason
        : measuredReading(finding, read.outcome.measurement, read.name);
  if (typeof reading === 'string') return unverified(reading);

  const said = finding.drawing?.value ?? null,
    claimed = finding.dxf.value;
  const limit = reading.unit === 'mm' ? tolerance : 0;
  const origin =
    finding.drawing && byRef.get(finding.drawing.ref)?.kind === 'request' ? 'request' : 'drawing';
  if (said === null)
    return unverified(`${reading.lead}; the finding gives no ${origin} value to compare.`, reading);
  if (claimed === null)
    return unverified(
      `${reading.lead}; the ${origin} gives ${amount(said, reading.unit)}, and the finding gives no DXF value.`,
      reading,
    );
  if (Math.abs(reading.value - said) <= limit)
    return verdict(
      'refuted',
      `${reading.lead}, as the ${origin} gives: there is no mismatch.`,
      reading,
    );
  if (Math.abs(reading.value - claimed) > limit)
    return verdict(
      'refuted',
      `${reading.lead}, not the ${amount(claimed, reading.unit)} the finding gives.`,
      reading,
    );
  return verdict(
    'confirmed',
    `${reading.lead}; the ${origin} gives ${amount(said, reading.unit)}.`,
    reading,
  );
}

/** The holes a finding's entities name, each once, or why they name none. */
function holesNamed(
  entities: readonly string[],
  measurement: Measurement,
  name: string,
): Hole[] | string {
  const holes: Hole[] = [];
  for (const entity of entities) {
    const hole = holeOf(measurement, entity);
    if (!hole) return `Entity ${entity} is not a hole in ${name}.`;
    if (!holes.includes(hole)) holes.push(hole);
  }
  return holes;
}

function measuredReading(
  finding: Finding,
  measurement: Measurement,
  name: string,
): Reading | string {
  const dxf = finding.dxf!;
  if (finding.kind === 'pitch' || finding.kind === 'diameter') {
    const holes = holesNamed(dxf.entities, measurement, name);
    if (typeof holes === 'string') return holes;
    const wanted = finding.kind === 'pitch' ? 2 : 1;
    if (holes.length !== wanted)
      return `A ${finding.kind} needs ${wanted === 2 ? 'two holes' : 'one hole'}; the finding names ${holes.length}.`;
    const entities = holes.flatMap((hole) => hole.entities);
    if (finding.kind === 'diameter') {
      const [hole] = holes;
      return {
        value: hole!.diameter,
        unit: 'mm',
        lead: `Viewer measured ${millimetreText(hole!.diameter)} across hole ${hole!.number}`,
        entities,
      };
    }
    const [a, b] = holes as [Hole, Hole];
    const axis = dxf.axis ?? alignedAxis(a, b);
    const value = pitchBetween(a, b, axis);
    return {
      value,
      unit: 'mm',
      lead: `Viewer measured ${millimetreText(value)} between holes ${a.number} and ${b.number} ${axisText[axis]}`,
      entities,
    };
  }
  const named = new Set(dxf.entities);
  const outlines = named.size
    ? measurement.outlines.filter((outline) => outline.entities.some((id) => named.has(id)))
    : measurement.outlines;
  if (!outlines.length) return `Entities ${dxf.entities.join(', ')} are not an outline in ${name}.`;
  const one = outlines.length === 1 ? outlines[0]! : undefined;
  const entities = outlines.flatMap((outline) => outline.entities);
  if (finding.kind === 'holes') {
    const count = measurement.holes.filter((hole) =>
      outlines.some((outline) => outline.number === hole.outline),
    ).length;
    return {
      value: count,
      unit: 'holes',
      lead: `Viewer counted ${amount(count, 'holes')} ${one ? `in outline ${one.number}` : 'in the drawing'}`,
      entities,
    };
  }
  if (dxf.axis !== 'x' && dxf.axis !== 'y')
    return 'A size finding needs its axis: x for the width, y for the height.';
  const bounds = one?.bounds ?? measurement.bounds;
  const value = dxf.axis === 'x' ? bounds.max.x - bounds.min.x : bounds.max.y - bounds.min.y;
  return {
    value,
    unit: 'mm',
    lead: `Viewer measured ${millimetreText(value)} for the ${dxf.axis === 'x' ? 'width' : 'height'} of ${one ? `outline ${one.number}` : 'the drawing'}`,
    entities,
  };
}

/** A thickness or quantity is checked against what the DXF's file name says. */
function nameReading(kind: 'thickness' | 'quantity', name: string): Reading | string {
  const job = readJobName(name);
  const value = job[kind];
  if (!value) return job.notes[0] ?? `${name} does not give its ${kind}.`;
  const unit = kind === 'thickness' ? 'mm' : 'pieces';
  return {
    value: value.value,
    unit,
    lead: `The name ${name} gives ${amount(value.value, unit)} (“${value.text}”)`,
    entities: [],
  };
}

/** Every finding graded, in order. */
export const gradeFindings = (findings: readonly Finding[], job: GradeJob): Grade[] =>
  findings.map((finding) => gradeFinding(finding, job));
