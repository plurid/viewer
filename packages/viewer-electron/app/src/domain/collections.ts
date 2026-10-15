import { z } from 'zod';
import { sourceVersionSchema, evidenceNavigationSchema } from './inspection';
import type { FileEntry } from './contracts';
import type { IndexedQuery } from './services';
import { portablePath as localPath } from './schemas';
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
    /** Explicit references, an indexed query, or a Finder tag; the last two stay live. */
    kind: z.enum(['explicit', 'query', 'tag']),
    sources: z.array(localPath).min(1).max(10000),
    query: z.string().max(300).optional(),
    tag: z.string().trim().min(1).max(255).optional(),
    recursive: z.boolean().optional(),
    content: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.kind !== 'query' || !!value.query?.trim(),
    'A query collection needs search text.',
  )
  .refine((value) => value.kind !== 'tag' || !!value.tag, 'A tag collection needs a tag name.');
export type Collection = z.infer<typeof collectionSchema>;
export interface QuerySnapshot {
  id: string;
  query: IndexedQuery;
  entries: FileEntry[];
  created: number;
  coverage: 'indexed-matches';
}
