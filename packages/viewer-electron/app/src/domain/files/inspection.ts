import { z } from 'zod';
import type { FileEntry } from '../contracts';
import type { DocumentData, DocumentEvidence } from '../services';
export const sourceVersionSchema = z
  .object({
    identity: z.string().max(300),
    modified: z.number().finite(),
    size: z.number().finite().min(0),
  })
  .strict();
export type SourceVersion = z.infer<typeof sourceVersionSchema>;
export const evidenceAnchorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      line: z.number().int().min(1),
      start: z.number().int().min(0),
      end: z.number().int().min(0),
    })
    .strict(),
  z.object({ kind: z.literal('pdf'), page: z.number().int().min(1).max(100000) }).strict(),
  z.object({ kind: z.literal('epub'), chapter: z.number().int().min(0).max(10000) }).strict(),
  z.object({ kind: z.literal('document'), block: z.number().int().min(0).max(10000) }).strict(),
  z
    .object({
      kind: z.literal('cells'),
      sheet: z.string().max(200).optional(),
      row: z.number().int().min(1),
      column: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('image'),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .strict(),
  z.object({ kind: z.literal('media'), seconds: z.number().finite().min(0) }).strict(),
]);
export type EvidenceAnchor = z.infer<typeof evidenceAnchorSchema>;
export const evidenceNavigationSchema = z
  .object({
    path: z.string().min(1).max(32768),
    version: sourceVersionSchema,
    anchor: evidenceAnchorSchema,
    quote: z.string().max(10000),
  })
  .strict();
export type EvidenceNavigation = z.infer<typeof evidenceNavigationSchema>;
export interface InspectionFact {
  value: string | number | boolean;
  unit?: string;
  source: string;
}
export interface InspectionResult {
  path: string;
  version: SourceVersion;
  availability: 'available' | 'unavailable';
  facts: Record<string, InspectionFact>;
  evidence: DocumentEvidence[];
  coverage: { content: 'not-requested' | 'complete' | 'partial' | 'unsupported'; reason?: string };
}
export const inspectionResultSchema = z
  .object({
    path: z.string().min(1).max(32768),
    version: sourceVersionSchema,
    availability: z.enum(['available', 'unavailable']),
    facts: z.record(
      z.string().max(200),
      z
        .object({
          value: z.union([z.string().max(100000), z.number().finite(), z.boolean()]),
          unit: z.string().max(100).optional(),
          source: z.string().max(500),
        })
        .strict(),
    ),
    evidence: z
      .array(
        z
          .object({
            source: z.string().max(500),
            text: z.string().max(4000000),
            anchor: evidenceAnchorSchema.optional(),
          })
          .strict(),
      )
      .max(10000),
    coverage: z
      .object({
        content: z.enum(['not-requested', 'complete', 'partial', 'unsupported']),
        reason: z.string().max(10000).optional(),
      })
      .strict(),
  })
  .strict();
export interface SearchEvidence extends EvidenceNavigation {
  coverage: 'complete' | 'partial';
}
export const sourceVersion = (entry: FileEntry): SourceVersion => ({
  identity: entry.identity,
  modified: entry.modified,
  size: entry.size,
});
export const sameSourceVersion = (a: SourceVersion, b: SourceVersion) =>
  a.identity === b.identity && a.modified === b.modified && a.size === b.size;

/** Case/diacritic matching keeps a map back to the original passage and offsets. */
export function originalMatch(
  text: string,
  query: string,
): { start: number; end: number } | undefined {
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const term = fold(query.trim());
  if (!term) return;
  let folded = '',
    offset = 0;
  const positions: number[] = [];
  for (const character of text) {
    const value = fold(character);
    for (let index = 0; index < value.length; index++) positions.push(offset);
    folded += value;
    offset += character.length;
  }
  const match = folded.indexOf(term);
  if (match < 0) return;
  const start = positions[match],
    last = positions[match + term.length - 1];
  if (start === undefined || last === undefined) return;
  const end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
  return { start, end };
}
export function searchEvidence(
  entry: FileEntry,
  document: DocumentData,
  query: string,
): SearchEvidence | undefined {
  for (const evidence of document.evidence) {
    const match = originalMatch(evidence.text, query);
    if (!match) continue;
    const start = Math.max(0, match.start - 90),
      end = Math.min(evidence.text.length, match.end + 130);
    let anchor = evidence.anchor;
    if (!anchor) {
      const page = evidence.source.match(/^(?:OCR )?page (\d+)$/);
      if (page) anchor = { kind: 'pdf', page: Number(page[1]) };
      else if (evidence.source.startsWith('chapter:')) {
        const chapter =
          document.chapters?.findIndex((chapter) => chapter.title === evidence.source.slice(8)) ??
          -1;
        if (chapter >= 0) anchor = { kind: 'epub', chapter };
      } else if (evidence.source === 'text')
        anchor = {
          kind: 'text',
          start: match.start,
          end: match.end,
          line: evidence.text.slice(0, match.start).split('\n').length,
        };
    }
    // Metadata has no document location. Do not fabricate a page/line for it.
    if (!anchor) continue;
    return {
      path: entry.path,
      version: sourceVersion(entry),
      anchor,
      quote: evidence.text.slice(start, end),
      coverage: document.truncated || document.coverageReason ? 'partial' : 'complete',
    };
  }
}
