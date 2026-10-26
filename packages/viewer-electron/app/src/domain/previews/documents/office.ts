/** Bounded, read-only Office content. Source formatting and executable parts stay out. */
import { z } from 'zod';

export const worksheetPageSchema = z
  .object({
    sheet: z.string().min(1).max(200).optional(),
    fromRow: z.number().int().min(1).max(1048576).default(1),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict();
export const worksheetDocumentRequestSchema = worksheetPageSchema.extend({
  requestID: z.string().min(1).max(200),
});
export type WorksheetWindow = z.output<typeof worksheetPageSchema>;
export type WorksheetDocumentRequest = z.input<typeof worksheetDocumentRequestSchema>;
export interface WorksheetPage {
  sheet: string;
  fromRow: number;
  lastRow: number;
  nextRow?: number;
  /** Unsupported columns or shortened values, distinct from ordinary pagination. */
  limited: boolean;
}
export interface WordParagraph {
  kind: 'paragraph';
  text: string;
  heading?: number;
  inlines?: WordInline[];
}
export type WordInline =
  | { kind: 'text'; text: string }
  | {
      kind: 'image';
      part?: string;
      alt: string;
      width?: number;
      height?: number;
      warning?: string;
    };
export interface WordTable {
  kind: 'table';
  rows: string[][];
  media?: { row: number; column: number; inlines: WordInline[] }[];
}
export interface WorkbookCell {
  column: number;
  value: string;
  formatted?: string;
  numberFormat?: string;
  formatWarning?: string;
  /** Saved formula text, never evaluated by Viewer. Shared formulas may have no text. */
  formula?: string;
  cached?: boolean;
}
export interface WorkbookRow {
  row: number;
  cells: WorkbookCell[];
}
export interface WorkbookSheet {
  name: string;
  hidden: boolean;
  rows: WorkbookRow[];
  columns: number;
  truncated: boolean;
  /** False only for metadata entries outside an explicitly requested worksheet page. */
  loaded?: boolean;
  merges?: WorkbookMerge[];
  mergeLimited?: boolean;
}
export interface WorkbookMerge {
  fromRow: number;
  toRow: number;
  fromColumn: number;
  toColumn: number;
  /** Original upper-left cell, including when outside the requested page. */
  anchor?: WorkbookCell;
}
export type OfficeContent =
  | { kind: 'word'; blocks: (WordParagraph | WordTable)[] }
  | {
      kind: 'workbook';
      sheets: WorkbookSheet[];
      formulas: number;
      missingCached: number;
      page?: WorksheetPage;
    };

export function columnName(column: number): string {
  let name = '';
  while (column > 0) {
    column--;
    name = String.fromCharCode(65 + (column % 26)) + name;
    column = Math.floor(column / 26);
  }
  return name;
}
export function officeImageParts(office: OfficeContent | undefined): string[] {
  if (office?.kind !== 'word') return [];
  return office.blocks
    .flatMap((block) =>
      block.kind === 'paragraph'
        ? (block.inlines ?? [])
        : (block.media?.flatMap((cell) => cell.inlines) ?? []),
    )
    .flatMap((item) => (item.kind === 'image' && item.part ? [item.part] : []));
}
