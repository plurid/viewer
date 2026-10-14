/** Bounded, read-only Office content. Source formatting and executable parts stay out. */
export interface WordParagraph {
  kind: 'paragraph';
  text: string;
  heading?: number;
}
export interface WordTable {
  kind: 'table';
  rows: string[][];
}
export interface WorkbookCell {
  column: number;
  value: string;
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
}
export type OfficeContent =
  | { kind: 'word'; blocks: (WordParagraph | WordTable)[] }
  | { kind: 'workbook'; sheets: WorkbookSheet[]; formulas: number; missingCached: number };

export function columnName(column: number): string {
  let name = '';
  while (column > 0) {
    column--;
    name = String.fromCharCode(65 + (column % 26)) + name;
    column = Math.floor(column / 26);
  }
  return name;
}
