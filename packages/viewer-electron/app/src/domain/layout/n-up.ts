/** N-up: several pages scaled onto each sheet, in reading order. */
import { turned } from './geometry';
import type { Rect, Rotation, Size } from './geometry';

export const nUpCounts = [2, 4, 6, 8, 9, 16] as const;
export type NUpCount = (typeof nUpCounts)[number];
export type ReadingOrder = 'rows' | 'columns';
/** Columns by rows, the wider way round. */
const grids: Record<NUpCount, [number, number]> = {
  2: [2, 1],
  4: [2, 2],
  6: [3, 2],
  8: [4, 2],
  9: [3, 3],
  16: [4, 4],
};

export interface NUpArrangement {
  sheet: Size;
  columns: number;
  rows: number;
  /** Every page turns this way, so the sheet is read turned. */
  rotate: Rotation;
  /** How much a typical page is scaled. */
  scale: number;
}

/**
 * The sheet, grid and rotation that print a typical page largest. Ties keep pages upright, then
 * the first sheet offered.
 */
export function nUpArrangement(
  count: NUpCount,
  page: Size,
  sheets: readonly Size[],
  margin: number,
  gap: number,
): NUpArrangement {
  const [wide, narrow] = grids[count];
  let chosen: NUpArrangement | undefined;
  for (const rotate of [0, 90] as const)
    for (const sheet of sheets)
      for (const [columns, rows] of [
        [wide, narrow],
        [narrow, wide],
      ] as const) {
        const cell = cellSize(sheet, columns, rows, margin, gap);
        const size = turned(page, rotate);
        const scale = Math.min(cell.width / size.width, cell.height / size.height);
        if (!chosen || scale > chosen.scale * (1 + 1e-6))
          chosen = { sheet, columns, rows, rotate, scale };
      }
  return chosen!;
}
export const cellSize = (
  sheet: Size,
  columns: number,
  rows: number,
  margin: number,
  gap: number,
) => ({
  width: (sheet.width - 2 * margin - gap * (columns - 1)) / columns,
  height: (sheet.height - 2 * margin - gap * (rows - 1)) / rows,
});

/**
 * The cells of a sheet in reading order. A sheet of turned pages is read turned a quarter the
 * other way, so its order follows the pages, not the paper.
 */
export function nUpCells(
  arrangement: NUpArrangement,
  margin: number,
  gap: number,
  order: ReadingOrder,
): Rect[] {
  const { sheet, columns, rows, rotate } = arrangement;
  const cell = cellSize(sheet, columns, rows, margin, gap);
  const cells: Rect[] = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++)
      cells.push({
        x: margin + column * (cell.width + gap),
        y: margin + row * (cell.height + gap),
        ...cell,
      });
  // where a cell's centre is when the sheet is turned so its pages stand upright
  const reader = (rect: Rect) => {
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return rotate === 90 ? { x: y, y: sheet.width - x } : { x, y };
  };
  return cells.sort((a, b) => {
    const first = reader(a);
    const second = reader(b);
    const [major, minor] = order === 'rows' ? (['y', 'x'] as const) : (['x', 'y'] as const);
    return Math.abs(first[major] - second[major]) > 1e-6
      ? first[major] - second[major]
      : first[minor] - second[minor];
  });
}

/** A page's rotation in its cell: the sheet's, or a quarter more when that prints it larger, as a
 * landscape page among portrait ones. */
export function pageRotation(page: Size, cell: Size, base: Rotation): Rotation {
  const scale = (rotate: Rotation) => {
    const size = turned(page, rotate);
    return Math.min(cell.width / size.width, cell.height / size.height);
  };
  const other = ((base + 90) % 360) as Rotation;
  return scale(other) > scale(base) * 1.02 ? other : base;
}
