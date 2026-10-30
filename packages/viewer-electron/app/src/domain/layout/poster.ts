/** Poster tiling: one large picture printed in parts on ordinary sheets that overlap for gluing. */
import { ceilClose } from './geometry';
import type { Rect, Size } from './geometry';

export interface PosterTile {
  row: number;
  column: number;
  /** "A1": the row's letter, then the column's number. */
  label: string;
  /** The part of the poster this sheet prints, in poster points. */
  window: Rect;
}
export interface PosterTiling {
  sheet: Size;
  columns: number;
  rows: number;
  /** The printable part of a sheet, inside its margins. */
  printable: Size;
  tiles: PosterTile[];
}

/** Sheets needed along one side: each after the first adds its printable length less the overlap. */
export function tilesAlong(length: number, printable: number, overlap: number): number {
  if (length <= printable + 1e-6) return 1;
  const step = printable - overlap;
  return step <= 0 ? Infinity : ceilClose((length - overlap) / step);
}
export const rowLabel = (row: number): string =>
  (row >= 26 ? rowLabel(Math.floor(row / 26) - 1) : '') + String.fromCharCode(65 + (row % 26));

/** The sheet orientation that needs the fewest sheets; a tie goes to the first offered. */
export function posterTiling(
  poster: Size,
  sheets: readonly Size[],
  margin: number,
  overlap: number,
): PosterTiling | undefined {
  let chosen: PosterTiling | undefined;
  for (const sheet of sheets) {
    const printable = { width: sheet.width - 2 * margin, height: sheet.height - 2 * margin };
    if (printable.width <= overlap || printable.height <= overlap) continue;
    const columns = tilesAlong(poster.width, printable.width, overlap);
    const rows = tilesAlong(poster.height, printable.height, overlap);
    if (!Number.isFinite(columns * rows)) continue;
    if (chosen && columns * rows >= chosen.columns * chosen.rows) continue;
    const tiles: PosterTile[] = [];
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = column * (printable.width - overlap);
        const y = row * (printable.height - overlap);
        tiles.push({
          row,
          column,
          label: rowLabel(row) + (column + 1),
          window: {
            x,
            y,
            width: Math.min(printable.width, poster.width - x),
            height: Math.min(printable.height, poster.height - y),
          },
        });
      }
    chosen = { sheet, columns, rows, printable, tiles };
  }
  return chosen;
}
