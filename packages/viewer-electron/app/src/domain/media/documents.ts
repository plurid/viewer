import { z } from 'zod';
import type { Resource } from '../contracts';
import { portablePath } from '../schemas';
import { sourceVersionSchema } from '../files/inspection';
import { mediaTransformSchema } from '../operations/transforms';

export const mediaInfoSchema = z
  .object({
    duration: z.number().finite().positive().max(86400),
    extension: z.string().max(12),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    fps: z.number().finite().positive().max(120),
    video: z.boolean(),
    audio: z.boolean(),
    videoCodec: z.string().max(64).optional(),
    audioCodec: z.string().max(64).optional(),
    sampleRate: z.number().positive().optional(),
    channels: z.number().int().positive().optional(),
  })
  .strict();
export type MediaInfo = z.infer<typeof mediaInfoSchema>;
export const mediaSourceSchema = z
  .object({ path: portablePath, version: sourceVersionSchema, info: mediaInfoSchema })
  .strict();
export const mediaDraftSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    revision: z.number().int().min(1),
    sources: z.array(mediaSourceSchema).min(1).max(16),
    plan: mediaTransformSchema,
  })
  .strict();
export type MediaDraft = z.infer<typeof mediaDraftSchema>;
const id = z.uuid();
export const mediaRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), paths: z.array(portablePath).min(1).max(16) }).strict(),
  z.object({ kind: z.literal('get'), id }).strict(),
  z
    .object({
      kind: z.literal('update'),
      id,
      revision: z.number().int().min(1),
      plan: mediaTransformSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('choose'),
      id,
      revision: z.number().int().min(1),
      media: z.enum(['audio', 'video']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('export'),
      id,
      revision: z.number().int().min(1),
      destination: portablePath,
      name: z.string().min(1).max(255),
      separate: z.boolean().default(false),
      frame: z
        .object({
          source: z.number().int().min(0).max(15),
          seconds: z.number().finite().min(0).max(86400),
          format: z.enum(['png', 'jpeg']),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('frame'),
      id,
      source: z.number().int().min(0).max(15),
      seconds: z.number().finite().min(0).max(86400),
      requestID: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('waveform'),
      id,
      source: z.number().int().min(0).max(15),
      requestID: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal('cancel-preview'), requestID: z.uuid() }).strict(),
]);
export type MediaRequest = z.input<typeof mediaRequestSchema>;
export type MediaReply =
  MediaDraft | { jobs: string[] } | Resource | { peaks: number[]; duration: number } | void;
