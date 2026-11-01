import { z } from 'zod';
export const reconstructionCredentialID = 'viewer-fal-reconstruction';
export const reconstructionModel = 'fal-ai/sam-3/3d-objects';
export const reconstructionJobSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    canvasID: z.uuid(),
    sourceAssetID: z.uuid(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerID: z.string().max(200),
    model: z.literal(reconstructionModel),
    prompt: z.string().min(1).max(300),
    state: z.enum([
      'prepared',
      'submitting',
      'submission-unknown',
      'queued',
      'running',
      'cancel-requested',
      'cancelled',
      'succeeded',
      'failed',
    ]),
    image: z.string().max(6_000_000),
    mask: z.string().max(6_000_000),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    created: z.number().finite(),
    updated: z.number().finite(),
    seed: z.number().int().nonnegative(),
    remoteID: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,200}$/)
      .optional(),
    assetID: z.uuid().optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export type ReconstructionJob = z.infer<typeof reconstructionJobSchema>;
export type ReconstructionSummary = Pick<ReconstructionJob, 'id' | 'prompt' | 'state' | 'created'>;
export const reconstructionRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status') }).strict(),
  z.object({ kind: z.literal('list'), canvasID: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('prepare'),
      canvasID: z.uuid(),
      assetID: z.uuid(),
      providerID: z.string().min(1).max(200),
      prompt: z.string().trim().min(1).max(300),
    })
    .strict(),
  z.object({ kind: z.literal('start'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('get'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
]);
export type ReconstructionRequest = z.infer<typeof reconstructionRequestSchema>;
export type ReconstructionReply = {
  configured: boolean;
  job?: ReconstructionJob;
  jobs?: ReconstructionSummary[];
};
