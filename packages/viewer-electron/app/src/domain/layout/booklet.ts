/** Saddle-stitched booklets: sheets printed on both sides, folded and stapled through the fold. */
import type { Crop, Rect, Size } from './geometry';

/** One printed side of a sheet: the page on each half, `null` for a blank. */
export interface BookletSide {
  sheet: number;
  side: 'front' | 'back';
  /** The page left of the fold (above it, for pages bound on their short edge), then the other. */
  pages: [number | null, number | null];
}

/**
 * The order to print `pages` pages so that the folded stack reads 1, 2, 3…: padded with blank
 * pages at the end to a multiple of four, each sheet's front then its back, the outer sheet first.
 */
export function bookletSides(pages: number): BookletSide[] {
  const padded = Math.max(4, Math.ceil(pages / 4) * 4);
  const page = (number: number) => (number <= pages ? number : null);
  const sides: BookletSide[] = [];
  for (let sheet = 0; sheet < padded / 4; sheet++) {
    sides.push({
      sheet,
      side: 'front',
      pages: [page(padded - 2 * sheet), page(2 * sheet + 1)],
    });
    sides.push({
      sheet,
      side: 'back',
      pages: [page(2 * sheet + 2), page(padded - 2 * sheet - 1)],
    });
  }
  return sides;
}

/** Where a page goes on its half of a side: scaled to fit, against the fold, shifted toward it on
 * inner sheets by `shift` (creep), the part that would cross the fold cropped. */
export function bookletPlacement(
  page: Size,
  half: Rect,
  /** Which edge of `half` is the fold. */
  fold: 'left' | 'right' | 'top' | 'bottom',
  shift: number,
): { frame: Rect; crop: Crop } {
  const scale = Math.min(half.width / page.width, half.height / page.height);
  const width = page.width * scale;
  const height = page.height * scale;
  const horizontal = fold === 'left' || fold === 'right';
  const frame: Rect = {
    x:
      fold === 'left'
        ? half.x
        : fold === 'right'
          ? half.x + half.width - width
          : half.x + (half.width - width) / 2,
    y:
      fold === 'top'
        ? half.y
        : fold === 'bottom'
          ? half.y + half.height - height
          : half.y + (half.height - height) / 2,
    width,
    height,
  };
  const along = horizontal ? width : height;
  const cut = Math.min(Math.max(0, shift), along * 0.2);
  if (!cut) return { frame, crop: { x: 0, y: 0, width: 1, height: 1 } };
  const fraction = cut / along;
  switch (fold) {
    case 'left':
      return {
        frame: { ...frame, width: width - cut },
        crop: { x: fraction, y: 0, width: 1 - fraction, height: 1 },
      };
    case 'right':
      return {
        frame: { ...frame, x: frame.x + cut, width: width - cut },
        crop: { x: 0, y: 0, width: 1 - fraction, height: 1 },
      };
    case 'top':
      return {
        frame: { ...frame, height: height - cut },
        crop: { x: 0, y: fraction, width: 1, height: 1 - fraction },
      };
    case 'bottom':
      return {
        frame: { ...frame, y: frame.y + cut, height: height - cut },
        crop: { x: 0, y: 0, width: 1, height: 1 - fraction },
      };
  }
}
