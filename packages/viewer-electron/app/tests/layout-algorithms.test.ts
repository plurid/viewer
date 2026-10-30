/**
 * The Layout plane's algorithms: pure geometry, checked against answers worked out by hand and
 * against the properties a printed result needs: photos keep their proportions, pages appear once,
 * nothing overlaps and every crop stays inside its picture.
 */
import { describe, expect, it } from 'vitest';
import { millimetres as mm } from '../src/domain/layout/plan';
import {
  aspect,
  fillCrop,
  fitInside,
  overlaps,
  pageBox,
  inset,
} from '../src/domain/layout/geometry';
import type { Rect, Size } from '../src/domain/layout/geometry';
import {
  balancedRows,
  collage,
  collageStyleAvailable,
  featuredPhoto,
} from '../src/domain/layout/collage';
import type { CollageOptions, CollagePhoto } from '../src/domain/layout/collage';
import { contactSheetGrid, smallestPicture } from '../src/domain/layout/contact-sheet';
import { nUpArrangement, nUpCells, pageRotation } from '../src/domain/layout/n-up';
import { bookletPlacement, bookletSides } from '../src/domain/layout/booklet';
import type { BookletSide } from '../src/domain/layout/booklet';
import { labelCells, repeatCells, repeatCopies } from '../src/domain/layout/step-repeat';
import { posterTiling, rowLabel, tilesAlong } from '../src/domain/layout/poster';
import { cropMarks, cutTicks } from '../src/domain/layout/marks';
import {
  fitHelvetica,
  helveticaWidth,
  inWinAnsi,
  plainText,
  winAnsiExtras,
} from '../src/domain/layout/helvetica';
import {
  fitWinAnsi,
  plainText as writerPlainText,
  winAnsi,
  winAnsiWidth,
} from '../src/desktop/transforms/layout-text';
import {
  itemPreset,
  oriented,
  pageChoices,
  pagePreset,
  sizeName,
} from '../src/domain/layout/pages';

const a4 = oriented(pagePreset('a4'), 'portrait');
const a4Landscape = oriented(pagePreset('a4'), 'landscape');
const a5 = oriented(pagePreset('a5'), 'portrait');
const close = (value: number, expected: number, digits = 6) =>
  expect(value).toBeCloseTo(expected, digits);
const inside = (rect: Rect, box: Rect) =>
  rect.x >= box.x - 1e-6 &&
  rect.y >= box.y - 1e-6 &&
  rect.x + rect.width <= box.x + box.width + 1e-6 &&
  rect.y + rect.height <= box.y + box.height + 1e-6;
const noOverlaps = (rects: readonly Rect[]) =>
  rects.every((rect, index) => rects.slice(index + 1).every((other) => !overlaps(rect, other)));

describe('fit and fill', () => {
  it('fits a picture whole, centred, at its own proportions', () => {
    const frame = fitInside({ width: 400, height: 300 }, { x: 10, y: 20, width: 200, height: 200 });
    expect(frame).toEqual({ x: 10, y: 45, width: 200, height: 150 });
  });

  it('crops a picture to fill a frame, keeping the part the anchor names', () => {
    expect(fillCrop({ width: 400, height: 300 }, { width: 300, height: 300 })).toEqual({
      x: 0.125,
      y: 0,
      width: 0.75,
      height: 1,
    });
    expect(fillCrop({ width: 300, height: 400 }, { width: 300, height: 300 }, 'top')).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.75,
    });
    expect(fillCrop({ width: 300, height: 400 }, { width: 300, height: 300 }, 'bottom').y).toBe(
      0.25,
    );
    // the crop has the frame's proportions, so nothing is stretched
    const crop = fillCrop({ width: 4032, height: 3024 }, { width: 100, height: 160 }, 'right');
    close((crop.width * 4032) / (crop.height * 3024), 100 / 160);
    close(crop.x + crop.width, 1);
  });
});

describe('collage', () => {
  const landscape: CollagePhoto = { width: 4032, height: 3024, measured: true };
  const portrait: CollagePhoto = { width: 3024, height: 4032, measured: true };
  const box = inset(pageBox(a4Landscape), mm(10));
  const options = (change: Partial<CollageOptions> = {}): CollageOptions => ({
    style: 'justified',
    fit: 'fit',
    anchor: 'center',
    direction: 'auto',
    gap: mm(3),
    ...change,
  });

  it('balances rows: equal photos split evenly, in order', () => {
    expect(balancedRows([1.5, 1.5, 1.5, 1.5], 2, 1000, 0, 333)).toEqual([0, 2, 4]);
    // a wide panorama takes a row of its own
    expect(balancedRows([1.5, 1.5, 4.5, 1.5, 1.5], 3, 900, 0, 200)).toEqual([0, 2, 3, 5]);
    expect(balancedRows([1, 1, 1], 1, 900, 0, 300)).toEqual([0, 3]);
  });

  it('keeps every photo whole and at its own proportions in justified rows', () => {
    const photos = [landscape, portrait, landscape, landscape, portrait];
    const layout = collage(photos, box, options())!;
    expect(layout.cells).toHaveLength(5);
    for (const cell of layout.cells) {
      close(aspect(cell.frame), aspect(photos[cell.photo]!), 4);
      expect(cell.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      expect(inside(cell.frame, box)).toBe(true);
    }
    expect(noOverlaps(layout.cells.map((cell) => cell.frame))).toBe(true);
    expect(layout.metrics.coverage).toBeGreaterThan(0.85);
  });

  it('fills justified rows exactly, cropping nothing where the photos tile the page', () => {
    const photos = [landscape, landscape, landscape, landscape];
    const exact = { x: 0, y: 0, width: 800, height: 600 };
    const tiled = collage(photos, exact, options({ fit: 'fill', gap: 0 }))!;
    expect(tiled.metrics.coverage).toBeCloseTo(1, 6);
    expect(tiled.metrics.cropped).toBeLessThan(1e-6);
    expect(tiled.cells.map((cell) => cell.frame.width)).toEqual([400, 400, 400, 400]);
    const layout = collage(photos, box, options({ fit: 'fill' }))!;
    expect(layout.metrics.coverage).toBeCloseTo(1, 6);
    expect(layout.metrics.cropped).toBeLessThan(0.15);
    for (const cell of layout.cells) {
      // a crop of the photo's pixels has the frame's proportions: nothing is stretched
      const shown = (cell.crop.width * 4032) / (cell.crop.height * 3024);
      close(shown, aspect(cell.frame), 4);
    }
  });

  it('places every style inside the page without overlaps', () => {
    const photos = [landscape, portrait, landscape];
    for (const style of ['justified', 'featured', 'grid', 'strip', 'split'] as const)
      for (const fit of ['fit', 'fill'] as const) {
        const layout = collage(photos, box, options({ style, fit }))!;
        expect(layout.cells.map((cell) => cell.photo).sort()).toEqual([0, 1, 2]);
        for (const cell of layout.cells) expect(inside(cell.frame, box)).toBe(true);
        expect(noOverlaps(layout.cells.map((cell) => cell.frame))).toBe(true);
        expect(layout.metrics.score).toBeGreaterThan(0);
      }
  });

  it('splits two photos into halves and three into thirds or a half and two quarters', () => {
    const halves = collage([landscape, landscape], box, options({ style: 'split', fit: 'fill' }))!;
    close(
      halves.cells[0]!.frame.width * halves.cells[0]!.frame.height,
      halves.cells[1]!.frame.width * halves.cells[1]!.frame.height,
      3,
    );
    const three = collage(
      [portrait, landscape, landscape],
      box,
      options({ style: 'split', fit: 'fill' }),
    )!;
    const areas = three.cells.map((cell) => cell.frame.width * cell.frame.height);
    // equal thirds, or one cell twice the others
    const ratio = Math.max(...areas) / Math.min(...areas);
    expect(ratio === 1 || Math.abs(ratio - 2) < 0.1 || ratio < 1.0001).toBe(true);
    expect(collageStyleAvailable('split', 4)).toBe(false);
    expect(collageStyleAvailable('featured', 2)).toBe(false);
  });

  it('features the photo with the most pixels, and the first on a tie', () => {
    expect(featuredPhoto([landscape, { width: 8000, height: 6000 }, landscape])).toBe(1);
    expect(featuredPhoto([landscape, portrait, landscape])).toBe(0);
    const layout = collage(
      [landscape, { width: 8000, height: 6000 }, landscape, portrait],
      box,
      options({ style: 'featured', fit: 'fill' }),
    )!;
    const largest = layout.cells.reduce((best, cell) =>
      cell.frame.width * cell.frame.height > best.frame.width * best.frame.height ? cell : best,
    );
    expect(largest.photo).toBe(1);
  });

  it('scores coverage, cropping, evenness and enlargement', () => {
    const photos = [landscape, landscape, landscape, landscape];
    const fitted = collage(photos, box, options({ style: 'grid', fit: 'fit' }))!;
    const filled = collage(photos, box, options({ style: 'grid', fit: 'fill' }))!;
    expect(filled.metrics.coverage).toBeGreaterThan(fitted.metrics.coverage);
    expect(fitted.metrics.cropped).toBe(0);
    expect(fitted.metrics.evenness).toBeCloseTo(1, 6);
    // a small photo printed large at a pixel size is enlarged
    const small = [{ width: 400, height: 300, measured: true }];
    const sharp = collage(small, box, options({ pixelsPerPoint: 300 / 72 }))!;
    expect(sharp.metrics.sharpness).toBeLessThan(0.2);
    expect(collage(small, box, options())!.metrics.sharpness).toBe(1);
  });

  it('keeps forty photos quick', () => {
    const photos = Array.from({ length: 40 }, (_, index) => (index % 3 ? landscape : portrait));
    const started = performance.now();
    for (const style of ['justified', 'featured', 'grid'] as const)
      expect(collage(photos, box, options({ style }))!.cells).toHaveLength(40);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('contact sheet', () => {
  const content = { width: a4.width - mm(24), height: a4.height - mm(24) - 38 };

  it('puts ten photos on one page with large pictures', () => {
    const grid = contactSheetGrid(10, content, mm(4), 2, 4 / 3, 'auto')!;
    expect(grid.pages).toBe(1);
    expect(grid.perPage).toBeGreaterThanOrEqual(10);
    expect(grid.columns).toBe(3);
  });

  it('spreads two hundred photos over as few pages as pictures of a readable size allow', () => {
    const grid = contactSheetGrid(200, content, mm(4), 2, 4 / 3, 'auto')!;
    expect(grid.picture.width).toBeGreaterThanOrEqual(smallestPicture);
    expect(grid.pages).toBe(Math.ceil(200 / grid.perPage));
    const more = contactSheetGrid(200, content, mm(4), 2, 4 / 3, grid.columns + 1)!;
    expect(more.picture.width).toBeLessThan(smallestPicture);
  });

  it('honours a chosen number of columns', () => {
    const grid = contactSheetGrid(30, content, mm(4), 1, 1, 6)!;
    expect(grid.columns).toBe(6);
    expect(grid.pages).toBe(Math.ceil(30 / grid.perPage));
  });
});

describe('n-up', () => {
  it('prints two A5 pages side by side on a landscape A4, upright', () => {
    const arrangement = nUpArrangement(2, a5, pageChoices('a4', 'auto'), 0, 0);
    expect(arrangement).toMatchObject({ columns: 2, rows: 1, rotate: 0 });
    expect(arrangement.sheet.width).toBeGreaterThan(arrangement.sheet.height);
    close(arrangement.scale, 1, 2);
  });

  it('turns the pages a quarter when the sheet must stay portrait', () => {
    const arrangement = nUpArrangement(2, a5, [a4], 0, 0);
    expect(arrangement).toMatchObject({ columns: 1, rows: 2, rotate: 90 });
    close(arrangement.scale, 1, 2);
    // four A4 pages on an A4 sheet stay upright in a 2 by 2 grid
    expect(nUpArrangement(4, a4, [a4], mm(5), mm(5))).toMatchObject({
      columns: 2,
      rows: 2,
      rotate: 0,
    });
  });

  it('turns a landscape page among portrait ones to print it larger', () => {
    const cell = { width: 400, height: 560 };
    expect(pageRotation(a4Landscape, cell, 0)).toBe(90);
    expect(pageRotation(a4, cell, 0)).toBe(0);
  });

  it('orders cells in rows or columns, as the turned sheet is read', () => {
    const upright = nUpArrangement(4, a4, [a4], 0, 0);
    const rows = nUpCells(upright, 0, 0, 'rows').map((cell) => [cell.x, cell.y]);
    const columns = nUpCells(upright, 0, 0, 'columns').map((cell) => [cell.x, cell.y]);
    const [half, mid] = [a4.width / 2, a4.height / 2];
    expect(rows).toEqual([
      [0, 0],
      [half, 0],
      [0, mid],
      [half, mid],
    ]);
    expect(columns).toEqual([
      [0, 0],
      [0, mid],
      [half, 0],
      [half, mid],
    ]);
    // pages turned clockwise are read with the sheet turned back: the top cell comes first
    const turned = nUpArrangement(2, a5, [a4], 0, 0);
    const [first, second] = nUpCells(turned, 0, 0, 'rows');
    expect(first!.y).toBeLessThan(second!.y);
  });
});

describe('booklet', () => {
  /** The pages in reading order once the sheets are nested, folded and stapled. */
  const folded = (sides: BookletSide[]) => {
    const sheets = sides.length / 2;
    const side = (sheet: number, name: 'front' | 'back') =>
      sides.find((item) => item.sheet === sheet && item.side === name)!.pages;
    const order: (number | null)[] = [];
    for (let sheet = 0; sheet < sheets; sheet++)
      order.push(side(sheet, 'front')[1], side(sheet, 'back')[0]);
    for (let sheet = sheets - 1; sheet >= 0; sheet--)
      order.push(side(sheet, 'back')[1], side(sheet, 'front')[0]);
    return order;
  };

  it.each(Array.from({ length: 16 }, (_, index) => index + 1))(
    'reads %i pages in order after folding, padded with blanks to a multiple of four',
    (pages) => {
      const sides = bookletSides(pages);
      const padded = Math.max(4, Math.ceil(pages / 4) * 4);
      expect(sides).toHaveLength(padded / 2);
      expect(folded(sides)).toEqual(
        Array.from({ length: padded }, (_, index) => (index < pages ? index + 1 : null)),
      );
    },
  );

  it('prints eight pages on two sheets in the known order', () => {
    expect(bookletSides(8).map((side) => side.pages)).toEqual([
      [8, 1],
      [2, 7],
      [6, 3],
      [4, 5],
    ]);
    expect(bookletSides(5).map((side) => side.pages)).toEqual([
      [null, 1],
      [2, null],
      [null, 3],
      [4, 5],
    ]);
    expect(bookletSides(1).map((side) => side.pages)).toEqual([
      [null, 1],
      [null, null],
    ]);
  });

  it('sets pages against the fold and moves inner sheets toward it for creep', () => {
    const half = { x: 0, y: 0, width: 421, height: 595 };
    const left = bookletPlacement(a5, half, 'right', 0);
    close(left.frame.x + left.frame.width, 421, 1);
    const shifted = bookletPlacement(a5, half, 'right', 3);
    // the frame ends at the fold still; its content moved 3 points toward it
    close(shifted.frame.x + shifted.frame.width, 421, 1);
    close(shifted.frame.x - left.frame.x, 3, 6);
    close(shifted.crop.width, 1 - 3 / left.frame.width, 6);
    const right = bookletPlacement(a5, { ...half, x: 421 }, 'left', 3);
    close(right.frame.x, 421, 6);
    close(right.crop.x, 3 / left.frame.width, 6);
  });
});

describe('step and repeat', () => {
  it('fits ten business cards on A4 with 10 mm margins and no gap', () => {
    const card = itemPreset('business-card');
    const content = inset(pageBox(a4), mm(10));
    const cells = repeatCells(content, card, 0, true);
    expect(cells).toHaveLength(10);
    expect(cells.every((cell) => !cell.turned)).toBe(true);
    expect(noOverlaps(cells)).toBe(true);
    for (const cell of cells) expect(inside(cell, content)).toBe(true);
    // the block is centred on the sheet
    const left = Math.min(...cells.map((cell) => cell.x));
    const right = Math.max(...cells.map((cell) => cell.x + cell.width));
    close(left, a4.width - right, 6);
  });

  it('turns items, and fills the strip they leave, when that fits more', () => {
    const item = { width: mm(60), height: mm(90) };
    const content = { x: 0, y: 0, width: mm(190), height: mm(150) };
    const upright = repeatCells(content, item, 0, false);
    const either = repeatCells(content, item, 0, true);
    expect(upright).toHaveLength(3);
    expect(either.length).toBeGreaterThan(upright.length);
    expect(either.some((cell) => cell.turned)).toBe(true);
    expect(noOverlaps(either)).toBe(true);
  });

  it('places labels where the label sheet has them', () => {
    const preset = itemPreset('label-21');
    const cells = labelCells(preset.sheet!, preset);
    expect(cells).toHaveLength(21);
    close(cells[0]!.x, mm(7.25), 6);
    close(cells[20]!.y + cells[20]!.height, a4.height - mm(15.15), 1);
    expect(noOverlaps(cells)).toBe(true);
  });

  it('shares a full sheet between items, or makes the copies asked for', () => {
    expect(repeatCopies(3, 10, 'fill')).toEqual([4, 3, 3]);
    expect(repeatCopies(2, 10, [25, 5])).toEqual([25, 5]);
    expect(repeatCopies(2, 10, [])).toEqual([1, 1]);
  });
});

describe('poster tiling', () => {
  const a1 = oriented(pagePreset('a1'), 'portrait');

  it('counts sheets along a side, each after the first adding its length less the overlap', () => {
    expect(tilesAlong(100, 100, 10)).toBe(1);
    expect(tilesAlong(190, 100, 10)).toBe(2);
    expect(tilesAlong(191, 100, 10)).toBe(3);
    // millimetres converted to points must not round up a whole count
    expect(tilesAlong(mm(841), mm(287), mm(10))).toBe(3);
  });

  it('tiles A1 onto nine A4 sheets without overlap, twelve with a 10 mm overlap', () => {
    const plain = posterTiling(a1, pageChoices('a4', 'auto'), 0, 0)!;
    expect([plain.columns, plain.rows, plain.tiles.length]).toEqual([3, 3, 9]);
    const glued = posterTiling(a1, pageChoices('a4', 'auto'), mm(5), mm(10))!;
    expect([glued.columns, glued.rows, glued.tiles.length]).toEqual([4, 3, 12]);
    expect(glued.sheet).toEqual(a4);
  });

  it('labels sheets by row letter and column number, and covers the whole poster', () => {
    const tiling = posterTiling(a1, [a4], mm(5), mm(10))!;
    expect(tiling.tiles.slice(0, 5).map((tile) => tile.label)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
    ]);
    const last = tiling.tiles.at(-1)!;
    close(last.window.x + last.window.width, a1.width, 6);
    close(last.window.y + last.window.height, a1.height, 6);
    // neighbours overlap by exactly the overlap
    const [first, second] = tiling.tiles;
    close(first!.window.x + first!.window.width - second!.window.x, mm(10), 6);
    expect(rowLabel(25)).toBe('Z');
    expect(rowLabel(26)).toBe('AA');
  });
});

describe('marks and captions', () => {
  it('keeps only the crop marks that stay clear of the pieces', () => {
    const page = pageBox(a4);
    const grid = [0, 1].flatMap((row) =>
      [0, 1].map((column) => ({
        x: 100 + column * 100,
        y: 100 + row * 60,
        width: 100,
        height: 60,
      })),
    );
    const marks = cropMarks(grid, page);
    // 2 by 2 pieces edge to edge: only the 16 marks pointing outward remain, none inside
    expect(marks).toHaveLength(16);
    const block = { x: 100, y: 100, width: 200, height: 120 };
    for (const [x1, y1, x2, y2] of marks) {
      const box = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1) || 0.01,
        height: Math.abs(y2 - y1) || 0.01,
      };
      expect(overlaps(box, block)).toBe(false);
    }
    const apart = cropMarks([{ x: 100, y: 100, width: 100, height: 60 }], page);
    expect(apart).toHaveLength(8);
  });

  it('marks every shared cut in the margins', () => {
    const grid = [0, 1].map((column) => ({
      x: 100 + column * 100,
      y: 100,
      width: 100,
      height: 60,
    }));
    const ticks = cutTicks(grid, pageBox(a4));
    // three vertical cuts above and below, two horizontal ones on each side
    expect(ticks).toHaveLength(3 * 2 + 2 * 2);
  });

  it('shortens a caption as the writer does: Helvetica widths, then an ellipsis', () => {
    expect(helveticaWidth('iiii', 10, 'regular')).toBeLessThan(
      helveticaWidth('MMMM', 10, 'regular'),
    );
    const text = 'A very long photo name from a holiday by the sea.jpg';
    const short = fitHelvetica(text, 7, 'regular', 60)!;
    expect(short.endsWith('…')).toBe(true);
    expect(helveticaWidth(short, 7, 'regular')).toBeLessThanOrEqual(60);
    expect(fitHelvetica('IMG_1.jpg', 7, 'regular', 60)).toBe('IMG_1.jpg');
    // trailing spaces go before the ellipsis; nothing is drawn when not even it fits
    expect(fitHelvetica('ab   cdefghijklmnop', 10, 'regular', 22)).toBe('ab…');
    expect(fitHelvetica('anything', 10, 'regular', 5)).toBeUndefined();
    expect(inWinAnsi('Café – €5')).toBe(true);
    expect(inWinAnsi('東京')).toBe(false);
  });

  it('measures and shortens text exactly as the layout writer', () => {
    const characters = new Map([...winAnsiExtras].map(([point, code]) => [code, point]));
    const decode = (codes: Uint8Array) =>
      String.fromCodePoint(...[...codes].map((code) => characters.get(code) ?? code));
    const lines = [
      'IMG_2026-10-21 at the beach.jpg',
      'Plan, revision C (final).pdf',
      'Café – €5 “quoted” • Œuvre',
      'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
      'ends in spaces      x',
    ];
    for (const line of lines)
      for (const weight of ['regular', 'bold'] as const)
        for (const width of [4, 12, 30, 60, 90, 400]) {
          const codes = winAnsi(writerPlainText(line))!;
          expect(helveticaWidth(line, 7, weight)).toBeCloseTo(winAnsiWidth(codes, 7, weight), 9);
          const writer = fitWinAnsi(codes, 7, weight, width);
          const ours = fitHelvetica(plainText(line), 7, weight, width);
          expect(ours === undefined ? undefined : ours).toBe(writer && decode(writer));
        }
    expect(plainText('a\tb\u0007c')).toBe(writerPlainText('a\tb\u0007c'));
  });

  it('names sheet sizes', () => {
    expect(sizeName(a4)).toBe('A4 portrait');
    expect(sizeName(a4Landscape)).toBe('A4 landscape');
    expect(sizeName({ width: 1080, height: 1080 })).toBe('1080 × 1080 px');
    expect(sizeName({ width: mm(100), height: mm(100) } as Size)).toBe('100 × 100 mm');
  });
});
