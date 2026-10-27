import { z } from 'zod';
import type { FileEntry, Resource } from '../contracts';
import { sourceVersionSchema } from '../files/inspection';
import { optimizationOptionsSchema } from './optimization';
import type { OptimizationStatistics } from './optimization-target';

const id = z.string().uuid();
const file = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => !value.includes('\0'));
export const optimizationRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('prepare'),
      requestID: id,
      source: file,
      version: sourceVersionSchema,
      options: optimizationOptionsSchema,
    })
    .strict(),
  z.object({ kind: z.literal('review'), id }).strict(),
  z
    .object({
      kind: z.literal('export'),
      ids: z.array(id).min(1).max(1000),
      destination: file,
      sourceRoot: file.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('cancel'), requestID: id }).strict(),
  z.object({ kind: z.literal('release'), ids: z.array(id).max(1000) }).strict(),
]);
export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
export interface OptimizationCandidate extends OptimizationStatistics {
  kind: 'prepared';
  id: string;
  source: FileEntry;
  format: 'image' | 'pdf';
}
export interface OptimizationComparison {
  kind: 'review';
  id: string;
  original: Resource;
  candidate: Resource;
  pages?: number;
}
export type OptimizationReply =
  | OptimizationCandidate
  | OptimizationComparison
  | { kind: 'exported'; jobs: string[]; failures: { path: string; message: string }[] }
  | void;
