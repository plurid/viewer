/**
 * The instant estimate: each part's box packed by MaxRects with the best short-side fit, copies
 * in order of their longer side. It answers in milliseconds while quantities are typed; true-shape
 * nesting then improves on it.
 */
import { sheetLength, sheetWidth, type NestFormat } from './nest';

export interface BoxDemand {
  width: number;
  height: number;
  area: number;
  quantity: number;
  /** A quarter turn is allowed. */
  turn: boolean;
}
export interface BoxPlacement {
  part: number;
  /** The box's corner in sheet millimetres, length along x. */
  x: number;
  y: number;
  turned: boolean;
}
export interface BoxSheet {
  placements: BoxPlacement[];
  area: number;
}
export interface BoxEstimate {
  sheets: BoxSheet[];
  unplaced: number[];
}
interface Free {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Beyond this many copies, boxes are laid in rows instead: still exact for repeated boxes, and
 * quick at any count. */
const maxRectsLimit = 3000;

export function packBoxes(
  boxes: readonly BoxDemand[],
  format: NestFormat,
  margin: number,
  spacing: number,
): BoxEstimate {
  // Each box carries the spacing on two sides; the usable area gains it once at its far edges.
  const length = sheetLength(format) - 2 * margin + spacing,
    width = sheetWidth(format) - 2 * margin + spacing;
  const copies: number[] = [];
  boxes.forEach((box, part) => {
    for (let i = 0; i < box.quantity; i++) copies.push(part);
  });
  const side = (part: number) => Math.max(boxes[part]!.width, boxes[part]!.height);
  copies.sort((a, b) => side(b) - side(a) || boxes[b]!.area - boxes[a]!.area || a - b);
  const unplaced = boxes.map(() => 0);
  const sheets: { free: Free[]; result: BoxSheet; shelf?: Shelf }[] = [];
  const rows = copies.length > maxRectsLimit;
  const stock = format.stock ?? Infinity;
  for (const part of copies) {
    const box = boxes[part]!;
    const w = box.width + spacing,
      h = box.height + spacing;
    const turns = box.turn ? [false, true] : [false];
    if (
      !turns.some((turned) => (turned ? h : w) <= length + 1e-9 && (turned ? w : h) <= width + 1e-9)
    ) {
      unplaced[part]!++;
      continue;
    }
    let placed = false;
    for (const sheet of sheets) {
      placed = rows
        ? shelve(sheet, part, w, h, turns, length, width)
        : fit(sheet, part, w, h, turns);
      if (placed) break;
    }
    if (placed) continue;
    if (sheets.length >= stock) {
      unplaced[part]!++;
      continue;
    }
    const sheet = {
      free: [{ x: 0, y: 0, width: length, height: width }],
      result: { placements: [], area: 0 },
    };
    sheets.push(sheet);
    if (!(rows ? shelve(sheet, part, w, h, turns, length, width) : fit(sheet, part, w, h, turns)))
      unplaced[part]!++;
  }
  for (const sheet of sheets)
    sheet.result.area = sheet.result.placements.reduce((sum, p) => sum + boxes[p.part]!.area, 0);
  return {
    sheets: sheets.map((sheet) => ({
      ...sheet.result,
      placements: sheet.result.placements.map((p) => ({ ...p, x: p.x + margin, y: p.y + margin })),
    })),
    unplaced,
  };
}

function fit(
  sheet: { free: Free[]; result: BoxSheet },
  part: number,
  w: number,
  h: number,
  turns: readonly boolean[],
): boolean {
  let best: { free: Free; turned: boolean; short: number; long: number } | undefined;
  for (const free of sheet.free)
    for (const turned of turns) {
      const bw = turned ? h : w,
        bh = turned ? w : h;
      if (bw > free.width + 1e-9 || bh > free.height + 1e-9) continue;
      const short = Math.min(free.width - bw, free.height - bh),
        long = Math.max(free.width - bw, free.height - bh);
      if (!best || short < best.short || (short === best.short && long < best.long))
        best = { free, turned, short, long };
    }
  if (!best) return false;
  const used = {
    x: best.free.x,
    y: best.free.y,
    width: best.turned ? h : w,
    height: best.turned ? w : h,
  };
  sheet.result.placements.push({ part, x: used.x, y: used.y, turned: best.turned });
  const next: Free[] = [];
  for (const free of sheet.free) {
    if (
      used.x >= free.x + free.width ||
      used.x + used.width <= free.x ||
      used.y >= free.y + free.height ||
      used.y + used.height <= free.y
    ) {
      next.push(free);
      continue;
    }
    if (used.x > free.x) next.push({ ...free, width: used.x - free.x });
    if (used.x + used.width < free.x + free.width)
      next.push({
        ...free,
        x: used.x + used.width,
        width: free.x + free.width - used.x - used.width,
      });
    if (used.y > free.y) next.push({ ...free, height: used.y - free.y });
    if (used.y + used.height < free.y + free.height)
      next.push({
        ...free,
        y: used.y + used.height,
        height: free.y + free.height - used.y - used.height,
      });
  }
  sheet.free = next.filter(
    (a, i) =>
      a.width > 1e-9 &&
      a.height > 1e-9 &&
      !next.some(
        (b, j) =>
          j !== i &&
          b.x <= a.x + 1e-9 &&
          b.y <= a.y + 1e-9 &&
          b.x + b.width >= a.x + a.width - 1e-9 &&
          b.y + b.height >= a.y + a.height - 1e-9 &&
          (j < i || b.width * b.height > a.width * a.height + 1e-9),
      ),
  );
  return true;
}

interface Shelf {
  x: number;
  y: number;
  depth: number;
}
/** Shelves across the sheet's width, each as deep as its first box, laid along its length. */
function shelve(
  sheet: { result: BoxSheet; shelf?: Shelf },
  part: number,
  w: number,
  h: number,
  turns: readonly boolean[],
  length: number,
  width: number,
): boolean {
  for (const turned of turns) {
    const bw = turned ? h : w,
      bh = turned ? w : h;
    const shelf = sheet.shelf ?? { x: 0, y: 0, depth: bw };
    if (bw <= shelf.depth + 1e-9 && shelf.y + bh <= width + 1e-9 && shelf.x + bw <= length + 1e-9) {
      sheet.result.placements.push({ part, x: shelf.x, y: shelf.y, turned });
      sheet.shelf = { ...shelf, y: shelf.y + bh };
      return true;
    }
    const x = shelf.x + shelf.depth;
    if (x + bw <= length + 1e-9 && bh <= width + 1e-9) {
      sheet.result.placements.push({ part, x, y: 0, turned });
      sheet.shelf = { x, y: bh, depth: bw };
      return true;
    }
  }
  return false;
}

/** The fewest sheets any packing could use: total material over usable area. */
export function areaBound(boxes: readonly BoxDemand[], format: NestFormat, margin: number): number {
  const usable =
    Math.max(0, sheetLength(format) - 2 * margin) * Math.max(0, sheetWidth(format) - 2 * margin);
  const total = boxes.reduce((sum, box) => sum + box.area * box.quantity, 0);
  return usable > 0 ? Math.ceil(total / usable - 1e-9) : Infinity;
}
