import { z } from 'zod';

export const optimizationAttemptLimit = 8;
/** A target size in bytes, from 1 kB to 256 MB. */
export const optimizationTargetBytes = { minimum: 1000, maximum: 256_000_000 } as const;
export const optimizationTargetSchema = z
  .object({
    bytes: z
      .number()
      .int()
      .min(optimizationTargetBytes.minimum)
      .max(optimizationTargetBytes.maximum),
    minimumQuality: z.number().int().min(20).max(95).default(60),
  })
  .strict();
export type OptimizationTarget = z.infer<typeof optimizationTargetSchema>;

export const optimizationOutcomeSchema = z
  .object({
    /** Up to the earlier 256 MiB bound, so outcomes journaled under it still read. */
    bytes: z
      .number()
      .int()
      .min(optimizationTargetBytes.minimum)
      .max(256 * 1024 * 1024),
    met: z.boolean(),
    quality: z.number().int().min(1).max(100).optional(),
    attempts: z.number().int().min(0).max(optimizationAttemptLimit),
  })
  .strict();
export type OptimizationOutcome = z.infer<typeof optimizationOutcomeSchema>;
export interface OptimizationStatistics {
  inputBytes: number;
  outputBytes: number;
  targetSize?: OptimizationOutcome;
}
