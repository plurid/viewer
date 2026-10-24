import { z } from 'zod';
import { gitSourceSchema } from './git';
export const diffSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(32768) }).strict(),
  gitSourceSchema,
  z.object({ kind: z.literal('empty'), name: z.string().max(255) }).strict(),
]);
export type DiffSource = z.infer<typeof diffSourceSchema>;
export const diffModes = ['split', 'unified', 'slider', 'onion', 'side', 'difference'] as const;
