import { parseDelimited } from '../../domain/previews/data/delimited';
import type { WorkbookCell, WorkbookRow } from '../../domain/previews/documents/office';

export interface DelimitedPreview {
  malformed: boolean;
  truncated: boolean;
  headers: string[];
  rows: string[][];
}
export function delimitedPreview(text: string, delimiter: string): DelimitedPreview {
  if (text.length > 4 * 1024 * 1024)
    throw new Error('This table exceeds the 4 MB text preview limit.');
  if (delimiter !== ',' && delimiter !== '\t') throw new Error('Choose CSV or tab-separated data.');
  const parsed = parseDelimited(text, delimiter);
  const columns = Math.min(
    100,
    Math.max(parsed.rows[0]?.length || 0, ...parsed.rows.slice(0, 100).map((row) => row.length), 1),
  );
  return {
    malformed: parsed.malformed,
    truncated: parsed.truncated || parsed.rows.some((row) => row.length > columns),
    headers: Array.from(
      { length: columns },
      (_, index) => parsed.rows[0]?.[index] || `Column ${index + 1}`,
    ),
    rows: parsed.rows.slice(1).map((cells) => cells.slice(0, columns)),
  };
}
/** Materialize cells only for displayed/cited rows. The cache stays bounded
 * while virtual scrolling retains the original CSV row and column addresses. */
export function delimitedRows(parsed: DelimitedPreview): WorkbookRow[] {
  const cached = new Map<number, WorkbookCell[]>();
  return parsed.rows.map((source, index) => ({
    row: index + 2,
    get cells() {
      let cells = cached.get(index);
      if (cells) cached.delete(index);
      else cells = source.map((value, column) => ({ column: column + 1, value }));
      cached.set(index, cells);
      if (cached.size > 512) cached.delete(cached.keys().next().value!);
      return cells;
    },
  }));
}
export function tableSearchIndex(rows: readonly string[][]): string[][] {
  return rows.map((row) => row.map((value) => (value + ' ').toLocaleLowerCase()));
}
export function tableMatches(index: readonly string[][], query: string): Uint32Array {
  if (query.length > 4096) throw new Error('Use a table filter shorter than 4096 characters.');
  const term = query.toLocaleLowerCase();
  const matches: number[] = [];
  for (let row = 0; row < index.length; row++)
    if (!term || index[row]!.some((cell) => cell.includes(term))) matches.push(row);
  return Uint32Array.from(matches);
}
