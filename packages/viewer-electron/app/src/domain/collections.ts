import { z } from 'zod';
import { sourceVersionSchema, evidenceNavigationSchema } from './inspection';
import type { FileEntry } from './contracts';
import type { IndexedQuery } from './services';
const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (value) => (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) && !value.includes('\0'),
  );
export const basketItemSchema = z
  .object({
    path: localPath,
    version: sourceVersionSchema,
    evidence: evidenceNavigationSchema.optional(),
  })
  .strict();
export type BasketItem = z.infer<typeof basketItemSchema>;
export const collectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['explicit', 'query']),
    sources: z.array(localPath).min(1).max(10000),
    query: z.string().max(300).optional(),
    recursive: z.boolean().optional(),
    content: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.kind !== 'query' || !!value.query?.trim(),
    'A query collection needs search text.',
  );
export type Collection = z.infer<typeof collectionSchema>;
export interface QuerySnapshot {
  id: string;
  query: IndexedQuery;
  entries: FileEntry[];
  created: number;
  coverage: 'indexed-matches';
}
