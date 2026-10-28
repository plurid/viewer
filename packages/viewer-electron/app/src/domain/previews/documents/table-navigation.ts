export interface TableAddress {
  row: number;
  column: number;
}

export function parseCellAddress(value: string, columns: number): TableAddress | undefined {
  const match = /^\$?([a-z]{1,3})\$?([1-9]\d{0,6})$/i.exec(value.trim());
  if (!match) return;
  const column = Array.from(match[1]!.toUpperCase()).reduce(
    (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
    0,
  );
  const row = Number(match[2]);
  if (column <= columns && row <= 1048576) return { row, column };
}

/** Move through the rendered source rows; page boundaries request another bounded worksheet page. */
export function moveTableCell(
  current: TableAddress,
  key: string,
  rows: readonly number[],
  columns: number,
  pageRows: number,
  lastRow: number,
  whole = false,
): TableAddress | undefined {
  if (!rows.length || !columns) return;
  const index = Math.max(0, rows.indexOf(current.row));
  const column = Math.max(1, Math.min(columns, current.column));
  switch (key) {
    case 'ArrowLeft':
      return { row: current.row, column: Math.max(1, column - 1) };
    case 'ArrowRight':
      return { row: current.row, column: Math.min(columns, column + 1) };
    case 'ArrowUp':
      return {
        row: rows.findLast((row) => row < current.row) ?? Math.max(1, current.row - 1),
        column,
      };
    case 'ArrowDown':
      return {
        row: rows.find((row) => row > current.row) ?? Math.min(lastRow, current.row + 1),
        column,
      };
    case 'PageUp':
      return {
        row: index < pageRows ? Math.max(1, rows[0]! - pageRows) : rows[index - pageRows]!,
        column,
      };
    case 'PageDown':
      return { row: rows[index + pageRows] ?? Math.min(lastRow, rows.at(-1)! + 1), column };
    case 'Home':
      return { row: whole ? 1 : current.row, column: 1 };
    case 'End':
      return { row: whole ? lastRow : current.row, column: columns };
  }
}
