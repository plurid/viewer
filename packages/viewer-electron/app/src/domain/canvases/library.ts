import { z } from 'zod';
import type { CanvasDocument } from './document';

export const canvasLibraryRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z
    .object({
      kind: z.literal('configure'),
      id: z.uuid(),
      revision: z.number().int().nonnegative(),
      title: z.string().trim().min(1).max(200),
      enabled: z.boolean(),
    })
    .strict(),
]);
export type CanvasLibraryRequest = z.infer<typeof canvasLibraryRequestSchema>;
export interface CanvasLibraryEntry {
  id: string;
  title: string;
  path: string;
  revision: number;
  updated: number;
  enabled: boolean;
  sources: number;
  assets: number;
  available: boolean;
  problem?: string;
}
export interface CanvasLibraryReply {
  entries: CanvasLibraryEntry[];
  truncated: boolean;
  document?: CanvasDocument;
}
