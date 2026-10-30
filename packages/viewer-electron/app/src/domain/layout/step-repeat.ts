/** Step and repeat: copies of one or more items, packed on sheets for cutting. */
import { floorClose } from './geometry';
import type { Rect, Size } from './geometry';
import type { LabelSheet } from './pages';

export interface RepeatCell extends Rect {
  /** The item lies on its side to fit more. */
  turned: boolean;
}

/** A block of `columns` by `rows` items of `item`'s size, from x, y. */
function block(
  x: number,
  y: number,
  item: Size,
  columns: number,
  rows: number,
  gap: number,
  turned: boolean,
) {
  const cells: RepeatCell[] = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++)
      cells.push({
        x: x + column * (item.width + gap),
        y: y + row * (item.height + gap),
        width: item.width,
        height: item.height,
        turned,
      });
  return cells;
}
const fits = (length: number, item: number, gap: number) =>
  length < item - 1e-6 ? 0 : floorClose((length + gap) / (item + gap));

/**
 * The most copies of `item` the content box holds: a grid one way round, then the strip it leaves,
 * right or below, filled the other way round when `rotate` allows. The whole block is centred.
 * Ties keep every item upright.
 */
export function repeatCells(content: Rect, item: Size, gap: number, rotate: boolean): RepeatCell[] {
  const side = { width: item.height, height: item.width };
  let chosen: RepeatCell[] = [];
  for (const [main, other, turned] of [
    [item, side, false],
    ...(rotate ? ([[side, item, true]] as const) : []),
  ] as const) {
    const columns = fits(content.width, main.width, gap);
    const rows = fits(content.height, main.height, gap);
    if (!columns || !rows) continue;
    const grid = block(0, 0, main, columns, rows, gap, turned);
    const right = content.width - columns * (main.width + gap);
    const below = content.height - rows * (main.height + gap);
    const strips = rotate
      ? [
          block(
            columns * (main.width + gap),
            0,
            other,
            fits(right, other.width, gap),
            fits(content.height, other.height, gap),
            gap,
            !turned,
          ),
          block(
            0,
            rows * (main.height + gap),
            other,
            fits(content.width, other.width, gap),
            fits(below, other.height, gap),
            gap,
            !turned,
          ),
        ]
      : [];
    const strip = strips.sort((a, b) => b.length - a.length)[0] ?? [];
    const cells = [...grid, ...strip];
    if (cells.length > chosen.length) chosen = cells;
  }
  if (!chosen.length) return [];
  const width = Math.max(...chosen.map((cell) => cell.x + cell.width));
  const height = Math.max(...chosen.map((cell) => cell.y + cell.height));
  const dx = content.x + (content.width - width) / 2;
  const dy = content.y + (content.height - height) / 2;
  return chosen.map((cell) => ({ ...cell, x: cell.x + dx, y: cell.y + dy }));
}

/** The labels of a label sheet, where its maker placed them. */
export function labelCells(sheet: LabelSheet, item: Size): RepeatCell[] {
  const cells: RepeatCell[] = [];
  for (let row = 0; row < sheet.rows; row++)
    for (let column = 0; column < sheet.columns; column++)
      cells.push({
        x: sheet.left + column * sheet.pitchX,
        y: sheet.top + row * sheet.pitchY,
        width: item.width,
        height: item.height,
        turned: false,
      });
  return cells;
}

/** How many copies of each item: as given, or as many as fill one sheet, shared out in order. */
export function repeatCopies(
  items: number,
  perSheet: number,
  copies: readonly number[] | 'fill',
): number[] {
  if (copies !== 'fill')
    return Array.from({ length: items }, (_, index) => Math.max(0, copies[index] ?? 1));
  const each = Math.floor(perSheet / items);
  return Array.from({ length: items }, (_, index) => each + (index < perSheet % items ? 1 : 0));
}
