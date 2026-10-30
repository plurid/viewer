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
const unit = z.number().min(0).max(1);
/** A closed outline on a page or picture: points `[x, y]` from its top-left corner, 0 to 1. */
export const evidenceRegionSchema = z
  .array(z.tuple([unit, unit]))
  .min(3)
  .max(512);
export type EvidenceRegion = z.infer<typeof evidenceRegionSchema>;
/** What a mark outlines: the text a value is read from, or a feature such as a hole. */
export const evidenceMarkKinds = ['text', 'feature'] as const;
export type EvidenceMarkKind = (typeof evidenceMarkKinds)[number];
export const evidenceMarkSchema = z
  .object({ kind: z.enum(evidenceMarkKinds), region: evidenceRegionSchema })
  .strict();
export type EvidenceMark = z.infer<typeof evidenceMarkSchema>;
const coordinate = z.number().finite().min(-1e12).max(1e12);
/** A point in a drawing's own coordinates and units, y up. */
const drawingPoint = z.tuple([coordinate, coordinate]);
const spacePoint = z.tuple([coordinate, coordinate, coordinate]);
export const drawingMeasureTools = ['distance', 'angle', 'area'] as const;
export type DrawingMeasureTool = (typeof drawingMeasureTools)[number];
export const evidenceAnchorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      line: z.number().int().min(1),
      start: z.number().int().min(0),
      end: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pdf'),
      page: z.number().int().min(1).max(100000),
      /** An outline on the page, as the page shows (its rotation applied). */
      region: evidenceRegionSchema.optional(),
      /** Further outlines drawn with the region: the text a value is read from, another feature. */
      marks: z.array(evidenceMarkSchema).min(1).max(16).optional(),
      /** A PDF zoom: fit page, fit width, or a scale from 0.1 to 4. */
      zoom: z.union([z.enum(['page', 'width']), z.number().min(0.1).max(4)]).optional(),
      /** `false` opens the page without searching for the quote. */
      search: z.literal(false).optional(),
    })
    .strict(),
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
      /** An outline inside the box, such as a traced mask; the box stays its bounds. */
      polygon: evidenceRegionSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('media'), seconds: z.number().finite().min(0) }).strict(),
  z
    .object({
      kind: z.literal('dxf'),
      /** Entity IDs, which are their positions in the drawing (`parseDrawing`). */
      entities: z.array(z.string().regex(/^\d{1,7}$/)).max(5000),
      /** The part of the drawing to show, in its own coordinates. */
      view: z.object({ min: drawingPoint, max: drawingPoint }).strict().optional(),
      /** Measurements drawn with the stop, as the Distance, Angle and Area tools draw theirs. */
      measure: z
        .array(
          z
            .object({
              tool: z.enum(drawingMeasureTools),
              points: z.array(drawingPoint).min(2).max(200),
            })
            .strict(),
        )
        .max(20)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal('model'), position: spacePoint, target: spacePoint }).strict(),
]);
export type EvidenceAnchor = z.infer<typeof evidenceAnchorSchema>;
export type EvidenceAnchorKind = EvidenceAnchor['kind'];
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
/** How much of the text before a match a search's quote keeps, in characters. */
export const quoteLead = 90;
export function searchEvidence(
  entry: FileEntry,
  document: DocumentData,
  query: string,
): SearchEvidence | undefined {
  for (const evidence of document.evidence) {
    const match = originalMatch(evidence.text, query);
    if (!match) continue;
    const start = Math.max(0, match.start - quoteLead),
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
/**
 * The line a text anchor marks in `text`, from 1. A search's quote starts up to `quoteLead`
 * characters before its match, so the match is read at that offset in the quote; a quote no longer
 * than the match is the match itself. A recorded line number can drift when the text is shown
 * another way (a message's plain body, for one): then the whole quote places the match, else the
 * match alone, else the recorded line stands.
 */
export function anchoredLine(
  text: string,
  anchor: { line: number; start: number; end: number },
  quote: string,
): number | undefined {
  const lines = text.split('\n');
  const recorded = lines[anchor.line - 1];
  const kept = recorded === undefined ? undefined : anchor.line;
  const length = Math.max(0, anchor.end - anchor.start);
  const lead = Math.min(anchor.start, quoteLead);
  const offset = length && quote.length >= lead + length ? lead : 0;
  const matched = length ? quote.slice(offset, offset + length) : quote;
  const passage = matched.trim().split('\n')[0]?.trim().slice(0, 120) ?? '';
  if (!passage || (recorded !== undefined && originalMatch(recorded, passage))) return kept;
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;
  if (offset) {
    const whole = originalMatch(text, quote);
    const leading = quote.length - quote.trimStart().length;
    const inner = matched.length - matched.trimStart().length;
    if (whole) return lineAt(whole.start + Math.max(0, offset - leading) + inner);
  }
  const found = originalMatch(text, passage);
  return found ? lineAt(found.start) : kept;
}
