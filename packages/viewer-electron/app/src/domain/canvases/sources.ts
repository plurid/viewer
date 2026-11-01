import { z } from 'zod';
import { inspectionResultSchema, sourceVersionSchema } from '../files/inspection';

export const canvasSourceLimits = { count: 12, bytes: 64_000, totalBytes: 128_000 } as const;
export const canvasSourceDataSchema = inspectionResultSchema
  .pick({ facts: true, evidence: true, coverage: true })
  .extend({
    table: z
      .object({ rows: z.array(z.array(z.string())), malformed: z.boolean() })
      .strict()
      .optional(),
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= canvasSourceLimits.bytes,
    'This source exceeds the canvas snapshot limit.',
  );
export const canvasSourceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(255),
    path: z.string().min(1).max(32768).optional(),
    version: sourceVersionSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: canvasSourceDataSchema,
  })
  .strict();
export type CanvasSource = z.infer<typeof canvasSourceSchema>;
export const canvasSourcesSchema = z
  .array(canvasSourceSchema)
  .max(canvasSourceLimits.count)
  .refine(
    (sources) =>
      new Set(sources.map((source) => source.id)).size === sources.length &&
      new TextEncoder().encode(JSON.stringify(sources)).length <= canvasSourceLimits.totalBytes,
    'Canvas sources must have unique IDs and stay within the total snapshot limit.',
  );

/** Frames and portable copies receive evidence, never local source-file authority. */
export const portableCanvasSources = (sources: readonly CanvasSource[]) =>
  sources.map(({ path: _path, ...source }) => source);
