import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutlineEntry {
  title: string;
  /** One-based; absent when the entry points nowhere this viewer can follow. */
  page?: number;
  children: OutlineEntry[];
}
interface OutlineSource {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineSource[];
}
type Pages = Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex'>;

/** Resolves a document outline to pages, bounded in entries and depth. Entries that only
 * link to web addresses keep their title but never open anything. */
export async function resolveOutline(
  pdf: Pages,
  items: readonly OutlineSource[],
  budget = { remaining: 2000 },
  depth = 0,
): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = [];
  for (const item of items) {
    if (budget.remaining-- <= 0 || depth > 12) break;
    let page: number | undefined;
    try {
      const destination =
        typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      const target = Array.isArray(destination) ? destination[0] : undefined;
      if (typeof target === 'number' && Number.isInteger(target)) page = target + 1;
      else if (target && typeof target === 'object')
        page = (await pdf.getPageIndex(target as Parameters<Pages['getPageIndex']>[0])) + 1;
    } catch {
      // A broken destination stays as a title.
    }
    entries.push({
      title: String(item.title ?? '').slice(0, 300) || 'Untitled',
      page,
      children: await resolveOutline(pdf, item.items ?? [], budget, depth + 1),
    });
  }
  return entries;
}
