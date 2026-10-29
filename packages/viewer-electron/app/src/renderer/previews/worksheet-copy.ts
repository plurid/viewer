import type { PreviewContext } from './contracts';
import type { TableBounds } from '../../domain/previews/documents/table-selection';
import type { WorkbookRow, WorkbookMerge } from '../../domain/previews/documents/office';
import {
  checkCopyRange,
  rangesIntersect,
  tableTSV,
} from '../../domain/previews/documents/table-selection';

/** Fetch bounded pages through the existing resource capability, without changing the visible page. */
export async function worksheetTSV(
  context: PreviewContext,
  sheet: string,
  range: TableBounds,
  formatted: boolean,
  signal: AbortSignal,
): Promise<string> {
  checkCopyRange(range);
  signal = AbortSignal.any([signal, context.signal]);
  const rows: WorkbookRow[] = [],
    merges = new Map<string, WorkbookMerge>();
  for (let fromRow = range.fromRow; fromRow <= range.toRow;) {
    signal.throwIfAborted();
    const requestID = crypto.randomUUID();
    let interrupted!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      interrupted = reject;
    });
    const abort = () => {
      void context.services.cancelDocument(context.resource.id, requestID).catch(() => {});
      interrupted(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const data = await Promise.race([
        context.services.document(context.resource.id, {
          sheet,
          fromRow,
          limit: Math.min(100, range.toRow - fromRow + 1),
          requestID,
        }),
        cancelled,
      ]);
      signal.throwIfAborted();
      const office = data.office;
      if (office?.kind !== 'workbook' || office.page?.sheet !== sheet)
        throw new Error('The requested worksheet is unavailable. Reopen it and try again.');
      const page = office.page;
      const loaded = office.sheets.find((item) => item.name === sheet && item.loaded !== false);
      if (!loaded || page.limited || loaded.mergeLimited)
        throw new Error(
          'This worksheet preview is incomplete. Open the original to copy this range.',
        );
      rows.push(
        ...loaded.rows
          .filter((row) => row.row >= range.fromRow && row.row <= range.toRow)
          .map((row) => ({
            row: row.row,
            cells: row.cells.filter(
              (cell) => cell.column >= range.fromColumn && cell.column <= range.toColumn,
            ),
          })),
      );
      for (const merge of loaded.merges ?? []) {
        if (!rangesIntersect(range, merge)) continue;
        if (
          merge.fromRow < range.fromRow ||
          merge.toRow > range.toRow ||
          merge.fromColumn < range.fromColumn ||
          merge.toColumn > range.toColumn
        )
          throw new Error('Select the entire merged cell before copying this range.');
        merges.set([merge.fromRow, merge.toRow, merge.fromColumn, merge.toColumn].join(':'), merge);
      }
      if (page.nextRow === undefined || page.nextRow > range.toRow) break;
      if (page.nextRow <= fromRow)
        throw new Error('The worksheet reader did not advance. Try again.');
      fromRow = page.nextRow;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  signal.throwIfAborted();
  return tableTSV(range, rows, [...merges.values()], formatted);
}
