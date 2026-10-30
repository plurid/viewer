/** A contact sheet: every photo whole, in a grid of equal cells with captions, over as many pages
 * as it needs. */
import { millimetres } from './plan';
import { floorClose } from './geometry';
import type { Rect, Size } from './geometry';

export interface ContactSheetGrid {
  columns: number;
  rows: number;
  perPage: number;
  pages: number;
  /** The picture's part of a cell, above its caption. */
  picture: Size;
  /** A cell's height, picture and caption. */
  cellHeight: number;
}
export const captionSize = 7;
export const captionLine = captionSize * 1.3;
export const headerHeight = 22;
export const footerHeight = 16;
/** Pictures smaller than this are hard to make out on paper. */
export const smallestPicture = millimetres(26);

/**
 * The grid for `count` photos. Automatic columns: the fewest that put every photo on one page with
 * pictures no smaller than `smallestPicture`; when they need more than a page, the most that keep
 * that size, so the sheet has as few pages as it can.
 */
export function contactSheetGrid(
  count: number,
  content: Size,
  gap: number,
  lines: number,
  /** The picture box's width over its height. */
  boxAspect: number,
  columns: number | 'auto',
): ContactSheetGrid | undefined {
  const grid = (columns: number): ContactSheetGrid | undefined => {
    const width = (content.width - gap * (columns - 1)) / columns;
    if (width <= 0) return undefined;
    const picture = { width, height: width / boxAspect };
    const cellHeight = picture.height + 3 + lines * captionLine;
    const rows = floorClose((content.height + gap) / (cellHeight + gap));
    if (rows < 1) return undefined;
    const perPage = rows * columns;
    return {
      columns,
      rows,
      perPage,
      pages: Math.max(1, Math.ceil(count / perPage)),
      picture,
      cellHeight,
    };
  };
  if (columns !== 'auto') return grid(columns);
  let widest: ContactSheetGrid | undefined;
  for (let value = 2; value <= 12; value++) {
    const option = grid(value);
    if (!option) continue;
    if (option.picture.width < smallestPicture && widest) break;
    if (option.pages === 1) return option;
    widest = option;
  }
  return widest;
}

/** The cell of the `index`th photo on its page, within `content`. */
export function contactSheetCell(
  grid: ContactSheetGrid,
  content: Rect,
  gap: number,
  index: number,
): Rect {
  const position = index % grid.perPage;
  const row = Math.floor(position / grid.columns);
  const column = position % grid.columns;
  return {
    x: content.x + column * (grid.picture.width + gap),
    y: content.y + row * (grid.cellHeight + gap),
    width: grid.picture.width,
    height: grid.cellHeight,
  };
}
