/**
 * A DXF CORRECTION'S PLAN: which holes move so one pitch becomes the value the drawing gives, named
 * by the entity ids the DXF preview shows, and the report of what the saved copy measures. It is a
 * transform plan (`transformPlanSchema`); correction.ts makes the copy (docs/reference/fabrication.md).
 */
import { z } from 'zod';

export const pitchAxes = ['x', 'y', 'centre'] as const;
/** Along x, along y, or centre to centre. */
export type PitchAxis = (typeof pitchAxes)[number];
/** "48.00 mm". */
export const millimetreText = (value: number) => `${value.toFixed(2)} mm`;

const entity = z.string().regex(/^\d{1,6}$/);
const millimetres = z.number().finite().positive().max(100_000);
/** A further pitch the same move sets: the hole that stays, the hole that moves, and its values. */
const pitchSchema = z
  .object({
    from: entity,
    to: entity,
    axis: z.enum(pitchAxes),
    target: millimetres,
    measured: millimetres,
  })
  .strict();
export type CorrectionPitch = z.infer<typeof pitchSchema>;
export const dxfCorrectionSchema = z
  .object({
    kind: z.literal('dxf-correction'),
    format: z.literal('dxf'),
    /** An entity of the hole that stays. */
    from: entity,
    /** An entity of the hole whose pitch is set; its hole moves. */
    to: entity,
    axis: z.enum(pitchAxes),
    target: millimetres,
    /** The pitch as reviewed; a drawing that measures otherwise now is refused. */
    measured: millimetres,
    /** Entities of further holes that move with `to`. */
    move: z.array(entity).max(500).default([]),
    /** Further pitches the move sets, as when one misplaced hole gives two wrong pitches; each is
     * measured again in the copy. */
    also: z.array(pitchSchema).min(1).max(8).optional(),
  })
  .strict();
export type DXFCorrection = z.infer<typeof dxfCorrectionSchema>;

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
export const correctionReportSchema = z
  .object({
    axis: z.enum(pitchAxes),
    target: z.number().finite(),
    /** The pitch measured in the original and in the corrected copy, in millimetres. */
    before: z.number().finite(),
    after: z.number().finite(),
    /** How far the moving holes went, in millimetres. */
    shift: point,
    moved: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            /** Its entities in the original, and in the corrected copy. */
            entities: z.array(z.string().max(12)).max(64),
            corrected: z.array(z.string().max(12)).max(64),
            from: point,
            to: point,
          })
          .strict(),
      )
      .max(500),
    /** The further pitches the plan sets, before and after, between the holes' centres. */
    also: z
      .array(
        z
          .object({
            axis: z.enum(pitchAxes),
            target: z.number().finite(),
            before: z.number().finite(),
            after: z.number().finite(),
            from: point,
            to: point,
          })
          .strict(),
      )
      .max(8)
      .optional(),
    /** The thinnest material left around a moved hole, in millimetres. */
    web: z.number().finite(),
    notes: z.array(z.string().max(500)).max(20),
  })
  .strict();
export type CorrectionReport = z.infer<typeof correctionReportSchema>;

/** `g6-MB20-A1-4buc.dxf` → `g6-MB20-A1-4buc (corrected).dxf`. */
export const correctedName = (name: string) => `${name.replace(/\.dxf$/i, '')} (corrected).dxf`;

const axisWords = (axis: PitchAxis) => (axis === 'centre' ? 'centre to centre' : `along ${axis}`);
/** "a", "a and b", "a, b and c". */
export const listText = (items: readonly string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');
/** "pitch along x from 48.00 mm to 50.00 mm"; with further pitches, "pitches along x from 58.00 mm
 * to 60.00 mm and from 30.00 mm to 28.00 mm". */
export function pitchesText(
  pitches: readonly Pick<CorrectionPitch, 'axis' | 'measured' | 'target'>[],
) {
  const one = pitches.every((pitch) => pitch.axis === pitches[0]!.axis);
  const change = (pitch: (typeof pitches)[number], index: number) =>
    `${one && index ? '' : `${axisWords(pitch.axis)} `}from ${millimetreText(pitch.measured)} to ${millimetreText(pitch.target)}`;
  return `${pitches.length === 1 ? 'pitch' : 'pitches'} ${listText(pitches.map(change))}`;
}

/** What a saved copy measures: "Pitch 48.00 mm → 50.00 mm", "Pitches 58.00 mm → 60.00 mm and
 * 30.00 mm → 28.00 mm". */
export function savedPitches(report: Pick<CorrectionReport, 'before' | 'after' | 'also'>): string {
  const pitches = [report, ...(report.also ?? [])];
  return `${pitches.length === 1 ? 'Pitch' : 'Pitches'} ${listText(pitches.map((pitch) => `${millimetreText(pitch.before)} → ${millimetreText(pitch.after)}`))}`;
}

/** The plan in words, for its review. */
export function correctionDescription(plan: DXFCorrection): string[] {
  const holes = 1 + plan.move.length;
  return [
    'DXF correction',
    pitchesText([plan, ...(plan.also ?? [])]),
    `moves ${holes === 1 ? '1 hole' : `${holes} holes`}`,
    'a new DXF beside the original, which is kept',
  ];
}
