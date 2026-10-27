import { z } from 'zod';

export const optimizationAttemptLimit = 8;
export const optimizationTargetSchema = z
  .object({
    bytes: z
      .number()
      .int()
      .min(1024)
      .max(256 * 1024 * 1024),
    minimumQuality: z.number().int().min(20).max(95).default(60),
  })
  .strict();
export type OptimizationTarget = z.infer<typeof optimizationTargetSchema>;

export const optimizationOutcomeSchema = z
  .object({
    bytes: z
      .number()
      .int()
      .min(1024)
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
