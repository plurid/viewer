import type { FileEntry } from '../contracts';
import type { SourceVersion } from '../files/inspection';
import type { PDFPagesTransform } from './transforms';

export interface PDFInput {
  file: FileEntry;
  pages: number;
  version: SourceVersion;
}
export interface PDFDraftPage {
  id: string;
  source: number;
  page: number;
  rotate: 0 | 90 | 180 | 270;
  included: boolean;
}
/** User-facing page ranges are inclusive, ordered and bounded. No qpdf syntax escapes. */
export function pdfPageRange(text: string, total: number): number[] {
  if (!text.trim() || text.length > 10000)
    throw new Error('Enter page numbers, such as 1-3, 8, 5.');
  const result: number[] = [],
    used = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*$/.exec(part);
    if (!match) throw new Error('Use page numbers and ranges, such as 1-3, 8, 5.');
    const start = Number(match[1]),
      end = Number(match[2] || match[1]);
    if (start < 1 || end < 1 || start > total || end > total)
      throw new Error(`Choose pages between 1 and ${total}.`);
    for (let page = start; ; page += start <= end ? 1 : -1) {
      if (!used.has(page)) {
        used.add(page);
        result.push(page);
      }
      if (result.length > 1000) throw new Error('Include at most 1,000 pages per output.');
      if (page === end) break;
    }
  }
  return result;
}
export function pdfOutput(
  pages: PDFDraftPage[],
  inputs: PDFInput[],
): { sources: PDFInput[]; plan: PDFPagesTransform } {
  const included = pages.filter((page) => page.included),
    used = [...new Set(included.map((page) => page.source))];
  return {
    sources: used.map((index) => inputs[index]!),
    plan: {
      kind: 'pdf-pages',
      format: 'pdf',
      pages: included.map((page) => ({
        source: used.indexOf(page.source),
        page: page.page,
        rotate: page.rotate,
      })),
    },
  };
}
