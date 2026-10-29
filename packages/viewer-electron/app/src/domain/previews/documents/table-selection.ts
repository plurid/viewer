import type { WorkbookCell, WorkbookMerge, WorkbookRow } from './office';
import { columnName } from './office';
import type { TableAddress } from './table-navigation';

export interface TableRange {
  anchor: TableAddress;
  focus: TableAddress;
}
export interface TableBounds {
  fromRow: number;
  toRow: number;
  fromColumn: number;
  toColumn: number;
}
export const TABLE_COPY_CELLS = 10000;
export const TABLE_COPY_BYTES = 1024 * 1024;

export function tableBounds(range: TableRange, merges: readonly WorkbookMerge[] = []): TableBounds {
  const bounds = {
    fromRow: Math.min(range.anchor.row, range.focus.row),
    toRow: Math.max(range.anchor.row, range.focus.row),
    fromColumn: Math.min(range.anchor.column, range.focus.column),
    toColumn: Math.max(range.anchor.column, range.focus.column),
  };
  // Selecting any part of a merged cell selects the whole cell, including adjacent merges.
  let changed = true;
  while (changed) {
    changed = false;
    for (const merge of merges) {
      if (!rangesIntersect(bounds, merge)) continue;
      const next = {
        fromRow: Math.min(bounds.fromRow, merge.fromRow),
        toRow: Math.max(bounds.toRow, merge.toRow),
        fromColumn: Math.min(bounds.fromColumn, merge.fromColumn),
        toColumn: Math.max(bounds.toColumn, merge.toColumn),
      };
      if (
        next.fromRow !== bounds.fromRow ||
        next.toRow !== bounds.toRow ||
        next.fromColumn !== bounds.fromColumn ||
        next.toColumn !== bounds.toColumn
      ) {
        Object.assign(bounds, next);
        changed = true;
      }
    }
  }
  return bounds;
}

export function rangesIntersect(a: TableBounds, b: TableBounds): boolean {
  return (
    a.fromRow <= b.toRow &&
    a.toRow >= b.fromRow &&
    a.fromColumn <= b.toColumn &&
    a.toColumn >= b.fromColumn
  );
}
export function rangeLabel(range: TableBounds): string {
  const first = columnName(range.fromColumn) + range.fromRow;
  const last = columnName(range.toColumn) + range.toRow;
  return first === last ? first : first + ':' + last;
}
export function checkCopyRange(range: TableBounds): number {
  if (
    !Object.values(range).every((value) => Number.isSafeInteger(value) && value >= 1) ||
    range.toRow < range.fromRow ||
    range.toColumn < range.fromColumn ||
    range.toRow > 1048576 ||
    range.toColumn > 16384
  )
    throw new Error('Choose a valid worksheet range.');
  const count = (range.toRow - range.fromRow + 1) * (range.toColumn - range.fromColumn + 1);
  if (count > TABLE_COPY_CELLS) throw new Error('Select at most 10,000 cells to copy.');
  return count;
}
const quote = (text: string) =>
  /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
const savedValue = (cell: WorkbookCell, formatted: boolean) =>
  cell.formula !== undefined && !cell.cached
    ? ''
    : formatted
      ? (cell.formatted ?? cell.value)
      : cell.value;

/** Preserve source gaps and stored values; formulas are never evaluated or substituted for values. */
export function tableTSV(
  range: TableBounds,
  rows: readonly WorkbookRow[],
  merges: readonly WorkbookMerge[],
  formatted: boolean,
): string {
  checkCopyRange(range);
  const values = new Map<number, Map<number, string>>();
  for (const row of rows) {
    if (row.row < range.fromRow || row.row > range.toRow) continue;
    values.set(
      row.row,
      new Map(row.cells.map((cell) => [cell.column, savedValue(cell, formatted)])),
    );
  }
  for (const merge of merges) {
    if (!rangesIntersect(range, merge)) continue;
    for (
      let row = Math.max(range.fromRow, merge.fromRow);
      row <= Math.min(range.toRow, merge.toRow);
      row++
    ) {
      const cells = values.get(row) ?? new Map<number, string>();
      values.set(row, cells);
      for (
        let column = Math.max(range.fromColumn, merge.fromColumn);
        column <= Math.min(range.toColumn, merge.toColumn);
        column++
      ) {
        const anchor = merge.anchor;
        cells.set(
          column,
          row === merge.fromRow && column === merge.fromColumn
            ? anchor
              ? savedValue(anchor, formatted)
              : (cells.get(column) ?? '')
            : '',
        );
      }
    }
  }
  const result: string[] = [];
  let bytes = 0;
  const encoder = new TextEncoder();
  for (let row = range.fromRow; row <= range.toRow; row++) {
    const cells: string[] = [];
    for (let column = range.fromColumn; column <= range.toColumn; column++)
      cells.push(quote(values.get(row)?.get(column) ?? ''));
    const line = cells.join('\t');
    bytes += encoder.encode(line).byteLength + (result.length ? 1 : 0);
    if (bytes > TABLE_COPY_BYTES)
      throw new Error('This selection exceeds the 1 MiB copy limit. Select fewer cells.');
    result.push(line);
  }
  return result.join('\n');
}
