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
    /** The thinnest material left around a moved hole, in millimetres. */
    web: z.number().finite(),
    notes: z.array(z.string().max(500)).max(20),
  })
  .strict();
export type CorrectionReport = z.infer<typeof correctionReportSchema>;

/** `g6-MB20-A1-4buc.dxf` → `g6-MB20-A1-4buc (corrected).dxf`. */
export const correctedName = (name: string) => `${name.replace(/\.dxf$/i, '')} (corrected).dxf`;

/** The plan in words, for its review. */
export function correctionDescription(plan: DXFCorrection): string[] {
  const holes = 1 + plan.move.length;
  return [
    'DXF correction',
    `pitch ${plan.axis === 'centre' ? 'centre to centre' : `along ${plan.axis}`} from ${millimetreText(plan.measured)} to ${millimetreText(plan.target)}`,
    `moves ${holes === 1 ? '1 hole' : `${holes} holes`}`,
    'a new DXF beside the original, which is kept',
  ];
}
