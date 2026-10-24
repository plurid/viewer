import { z } from 'zod';
import type { ChangePlan } from './change-plan';
import { sourceVersionSchema } from '../files/inspection';
import { portablePath as localPath } from '../schemas';
export const operationIntentSchema = z
  .object({
    kind: z.enum(['copy', 'move', 'trash', 'rename', 'mkdir']),
    sources: z.array(localPath).max(10000),
    destination: localPath.optional(),
    name: z.string().min(1).max(255).optional(),
    expectedSources: z
      .array(z.object({ path: localPath, version: sourceVersionSchema }).strict())
      .max(10000)
      .optional(),
  })
  .strict();
export type OperationIntent = z.infer<typeof operationIntentSchema>;
export const operationPlanRowSchema = z
  .object({
    id: z.uuid(),
    kind: operationIntentSchema.shape.kind,
    source: localPath.optional(),
    version: sourceVersionSchema.optional(),
    expectedSources: operationIntentSchema.shape.expectedSources,
    destination: localPath.optional(),
    name: z.string().max(255).optional(),
    approved: z.boolean(),
    issue: z.string().optional(),
    jobID: z.string().optional(),
  })
  .strict();
export type OperationPlanRow = z.infer<typeof operationPlanRowSchema>;
export interface OperationPlan extends ChangePlan<OperationPlanRow> {
  version: 1;
  created: number;
  owner?: string;
}
export type OperationPlanRequest =
  | { kind: 'prepare'; title: string; intents: OperationIntent[] }
  | { kind: 'get'; id: string }
  | { kind: 'list' }
  | { kind: 'cancel'; id: string }
  | {
      kind: 'apply';
      id: string;
      revision: number;
      checkpoint: boolean;
      rows: { id: string; approved: boolean; destination?: string; name?: string }[];
    };
export type OperationPlanReply = OperationPlan | OperationPlan[];
export const operationPlanRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('prepare'),
      title: z.string().min(1).max(200),
      intents: z.array(operationIntentSchema).min(1).max(10000),
    })
    .strict(),
  z.object({ kind: z.literal('get'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('list') }).strict(),
  z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('apply'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      checkpoint: z.boolean(),
      rows: z
        .array(
          z
            .object({
              id: z.uuid(),
              approved: z.boolean(),
              destination: localPath.optional(),
              name: z.string().min(1).max(255).optional(),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict(),
]);
