import { z } from 'zod';
import { sourceVersionSchema, type SourceVersion } from './inspection';
const file = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => value.startsWith('/') && !value.includes('\0'));
export const relationNodeSchema = z
  .object({ path: file, version: sourceVersionSchema.optional() })
  .strict();
export const fileRelationSchema = z
  .object({
    id: z.string().min(1).max(300),
    from: relationNodeSchema,
    to: relationNodeSchema,
    kind: z.string().min(1).max(100),
    basis: z.enum(['observed', 'declared', 'reported', 'inferred']),
    receipt: z
      .object({
        service: z.enum(['operation', 'recipe', 'workflow', 'reference-reader', 'note']),
        id: z.string().max(300),
        revision: z.number().int().nonnegative().optional(),
      })
      .strict(),
    note: z.string().max(4000).optional(),
  })
  .strict();
export type FileRelation = z.infer<typeof fileRelationSchema>;
export interface ObservedOperationLink {
  id: string;
  revision: number;
  kind: string;
  source: string;
  destination: string;
  sourceVersion?: SourceVersion;
  targetVersion?: SourceVersion;
}
export interface RelatedFile {
  path: string;
  status: 'available' | 'changed' | 'unavailable' | 'unverified';
  version?: SourceVersion;
  reason?: string;
}
export interface RelationshipsResult {
  file: string;
  relations: FileRelation[];
  files: RelatedFile[];
  coverage: 'complete' | 'partial';
  reasons: string[];
}
export type RelationshipsRequest =
  | { kind: 'read'; file: string; content: boolean }
  | { kind: 'note'; from: string; to: string; note: string }
  | { kind: 'remove-note'; id: string };
export type RelationshipsReply = RelationshipsResult | FileRelation | null;

/** Parse declared local paths only. Never resolve remote URLs, execute code or follow targets. */
export function declaredReferences(
  extension: string,
  text: string,
): { paths: string[]; supported: boolean; limited: boolean } {
  const paths: string[] = [];
  const add = (raw: string) => {
    if (paths.length >= 200) return;
    let target = raw.trim().replace(/^<|>$/g, '');
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return;
    // Drop a fragment or query: everything from the first `#` or `?`.
    target = target.replace(/[#?][\s\S]*$/, '');
    try {
      target = decodeURIComponent(target);
    } catch {
      return;
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return;
    if (target && !target.includes('\0') && !target.includes('\\') && !target.startsWith('/'))
      paths.push(target);
  };
  if (['md', 'markdown', 'mdx'].includes(extension)) {
    text = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, '');
    // Consume each label once. A global [^]]* regexp can retry quadratically
    // on a long malformed label containing many opening brackets.
    let cursor = 0;
    while (paths.length < 200) {
      const start = text.indexOf('[', cursor);
      if (start < 0) break;
      const end = text.indexOf(']', start + 1);
      if (end < 0) break;
      cursor = end + 1;
      if (text[cursor] !== '(') continue;
      const close = text.indexOf(')', cursor + 1);
      if (close < 0) break;
      const href = text.slice(cursor + 1, close).trim();
      cursor = close + 1;
      if (href.startsWith('<')) {
        const end = href.indexOf('>');
        if (end > 0) add(href.slice(1, end));
      } else add(href.split(/\s/, 1)[0] ?? '');
    }
  } else if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(extension)) {
    for (const match of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*|\brequire\s*\()(['"])([^'"\r\n]+)\1/g,
    ))
      if (match[2]?.startsWith('.')) add(match[2]);
  } else if (extension === 'css') {
    for (const match of text.matchAll(/(?:url\(\s*|@import\s*)(['"]?)([^'"\s)]+)\1\s*\)?/g))
      if (match[2]) add(match[2]);
  } else if (extension === 'obj') {
    for (const match of text.matchAll(/^mtllib\s+(.+)$/gm)) if (match[1]) add(match[1]);
  } else return { paths: [], supported: false, limited: false };
  return { paths: [...new Set(paths)], supported: true, limited: paths.length >= 200 };
}
