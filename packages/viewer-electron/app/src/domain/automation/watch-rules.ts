import { z } from 'zod';
import { sourceVersionSchema } from '../files/inspection';
import { portablePath as localPath } from '../schemas';
/** Approval lives in private state, separately from editable workflow definitions. */
export const watchRuleScopeSchema = z
  .object({
    file: localPath,
    fileRevision: z.string().length(64),
    root: localPath,
    bindings: z
      .record(z.string().min(1).max(100), localPath)
      .refine((value) => Object.keys(value).length <= 100),
    extensions: z
      .array(
        z
          .string()
          .min(1)
          .max(20)
          .regex(/^[a-z0-9]+$/),
      )
      .max(50),
    recursive: z.boolean(),
    allowContent: z.boolean(),
    cooldownSeconds: z.number().int().min(30).max(86400),
  })
  .strict();
export type WatchRuleScope = z.infer<typeof watchRuleScopeSchema>;
export const watchRuleSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    name: z.string().min(1).max(100),
    scope: watchRuleScopeSchema,
    approval: z.string().length(64),
    enabled: z.boolean(),
    reason: z.string().max(2000).optional(),
    created: z.number().finite(),
    lastStarted: z.number().finite().optional(),
    runID: z.uuid().optional(),
    starting: z.boolean().optional(),
    runStatus: z
      .enum(['running', 'paused', 'waiting-review', 'completed', 'failed', 'cancelled'])
      .optional(),
    baseline: z
      .array(z.object({ path: localPath, version: sourceVersionSchema }).strict())
      .max(2000),
  })
  .strict();
export type StoredWatchRule = z.infer<typeof watchRuleSchema>;
export type WatchRule = Omit<StoredWatchRule, 'baseline' | 'approval'>;
export const watchRuleRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z
    .object({
      kind: z.literal('approve'),
      id: z.uuid().optional(),
      revision: z.number().int().positive().optional(),
      scope: watchRuleScopeSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('pause'), id: z.uuid(), revision: z.number().int().positive() })
    .strict(),
  z
    .object({ kind: z.literal('remove'), id: z.uuid(), revision: z.number().int().positive() })
    .strict(),
]);
export type WatchRuleRequest = z.infer<typeof watchRuleRequestSchema>;
export type WatchRuleReply = WatchRule[] | WatchRule | null;
