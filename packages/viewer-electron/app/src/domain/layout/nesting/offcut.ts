/**
 * The offcut a nesting leaves on a sheet: the largest piece one straight cut across the whole
 * sheet takes off, the cut at the spacing from the parts. A shop keeps it for a later job when
 * both its sides reach `reusableSide`.
 */
import type { Box } from './nest';
import type { SheetSize } from './plan';
import { sheetLength, sheetWidth } from './nest';

/** Short side first, like a sheet format, in millimetres. */
export interface Offcut extends SheetSize {
  reusable: boolean;
}
/** The shortest side worth keeping: 300 mm, about a foot. */
export const reusableSide = 300;

export function offcutOf(bounds: Box, size: SheetSize, spacing: number): Offcut | undefined {
  const length = sheetLength(size),
    width = sheetWidth(size);
  // The side the cut makes is whole millimetres, rounded down; the other is the sheet's own.
  const cut = (value: number) => Math.floor(value + 1e-6);
  const pieces: [across: number, along: number][] = [
    // across the sheet, past the parts' far end and before their start
    [width, cut(length - bounds.x1 - spacing)],
    [width, cut(bounds.x0 - spacing)],
    // along the sheet, above the parts and below them
    [cut(width - bounds.y1 - spacing), length],
    [cut(bounds.y0 - spacing), length],
  ];
  let best: [number, number] | undefined;
  for (const piece of pieces)
    if (piece[0] > 0 && piece[1] > 0 && (!best || piece[0] * piece[1] > best[0] * best[1] + 1e-6))
      best = piece;
  if (!best) return undefined;
  const short = Math.min(...best),
    long = Math.max(...best);
  return { width: short, height: long, reusable: short >= reusableSide };
}
export const offcutArea = (offcut: Offcut | undefined) =>
  offcut ? offcut.width * offcut.height : 0;
