/**
 * True-shape nesting by bottom-left fill on a raster. Sheets lie with their length along x and
 * fill from x = 0, so what is left over is a strip at the far end. Each part goes where its turned
 * outline first fits, found by sliding it up each column of the sheet past what is already there.
 * Holes stay empty, and the holes of parts already placed are tried first, so small parts land
 * inside larger ones.
 */
import { insideRing, placementMatrix } from './geometry';
import type { Placement, SheetSize } from './plan';
import { orient, type Orientation, type Shape } from './raster';

export interface NestPart extends Shape {
  width: number;
  height: number;
  area: number;
  quantity: number;
  /** Allowed turns in degrees. */
  angles: readonly number[];
  /** Mirrored copies are allowed too. */
  mirror: boolean;
}
export interface NestFormat {
  width: number;
  height: number;
  /** Sheets in stock; unlimited when absent. */
  stock?: number;
  price: number;
}
export interface NestProblem {
  parts: readonly NestPart[];
  formats: readonly NestFormat[];
  margin: number;
  spacing: number;
  /** How far a flattened curve may stray from the drawing, in millimetres. */
  tolerance: number;
}
export interface NestedSheet {
  format: number;
  placements: Placement[];
  /** Material area of the parts on it. */
  area: number;
  /** How far along the sheet's length the parts reach. */
  used: number;
}
export interface NestLayout {
  sheets: NestedSheet[];
  /** Copies of each part left off: too large, or out of stock. */
  unplaced: number[];
  cell: number;
}
/** Bottom-left fill picks, for each copy, the turn that reaches least far along the sheet
 * (`length`) or the one that starts leftmost (`left`). */
export type NestCriterion = 'length' | 'left';
export interface NestPass {
  /** Part order; copies of a part are placed together. */
  order: readonly number[];
  criterion: NestCriterion;
  /** Formats to open, in order of preference. */
  formats: readonly number[];
}

/** A sheet lies with its longer side along x. */
export const sheetLength = (size: SheetSize) => Math.max(size.width, size.height);
export const sheetWidth = (size: SheetSize) => Math.min(size.width, size.height);
/** Each part's raster reaches this far beyond its outline: half the spacing, plus the distance a
 * flattened curve may stray from the drawing. */
export const reachOf = (problem: NestProblem) => problem.spacing / 2 + problem.tolerance;

/** A shape's holes: rings inside an odd number of its other rings. */
export function holeRings(shape: Shape): (readonly number[])[] {
  return shape.rings.filter((ring) => {
    let depth = 0;
    for (const other of shape.rings)
      if (other !== ring && insideRing(ring[0]!, ring[1]!, other)) depth++;
    return depth % 2 === 1;
  });
}

/** A part's distinct orientations at one resolution, rasterised once and shared by passes. */
export class Orientations {
  private cache = new Map<number, Orientation[]>();
  constructor(
    private problem: NestProblem,
    readonly cell: number,
  ) {}
  of(part: number): Orientation[] {
    let value = this.cache.get(part);
    if (!value) {
      const shape = this.problem.parts[part]!,
        reach = reachOf(this.problem);
      const seen = new Set<string>();
      value = [];
      for (const mirror of shape.mirror ? [false, true] : [false])
        for (const angle of shape.angles) {
          const orientation = orient(shape, angle, mirror, this.cell, reach);
          // A symmetric part looks the same in several turns; search one of them.
          if (seen.has(orientation.key)) continue;
          seen.add(orientation.key);
          value.push(orientation);
        }
      this.cache.set(part, value);
    }
    return value;
  }
}

interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** The cells an orientation's box corner may take on a sheet, inside the margin. */
function rangeOf(
  orientation: Orientation,
  format: NestFormat,
  problem: NestProblem,
  cell: number,
): Range | undefined {
  const inset = problem.margin + problem.tolerance;
  const range = {
    x0: Math.ceil(inset / cell - 1e-9),
    x1: Math.floor((sheetLength(format) - inset - orientation.width) / cell + 1e-9),
    y0: Math.ceil(inset / cell - 1e-9),
    y1: Math.floor((sheetWidth(format) - inset - orientation.height) / cell + 1e-9),
  };
  return range.x1 >= range.x0 && range.y1 >= range.y0 ? range : undefined;
}

/** The box of a placed part's hole, in sheet millimetres. */
interface Hole {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
class Sheet {
  /** Each column's occupied cells as sorted, merged [start, end) pairs. */
  readonly columns: number[][];
  readonly placements: Placement[] = [];
  /** Holes large enough for some part, smallest first. */
  readonly holes: Hole[] = [];
  area = 0;
  used = 0;
  /** Per part, per orientation: where its last search stopped. Every cell before that point,
   * column by column, was already taken, and a sheet only fills up. */
  private cursors: (Int32Array | undefined)[] = [];
  constructor(
    readonly format: number,
    length: number,
    cell: number,
    reach: number,
  ) {
    // Rasters reach `reach + cell` past a part's box; columns cover the sheet and that border.
    const count = Math.ceil((length + 2 * (reach + cell)) / cell) + 2;
    this.columns = Array.from({ length: count }, () => []);
  }
  cursor(part: number, orientations: number): Int32Array {
    let value = this.cursors[part];
    if (!value) {
      value = new Int32Array(2 * orientations).fill(-1);
      this.cursors[part] = value;
    }
    return value;
  }
  occupy(orientation: Orientation, x: number, y: number): void {
    const { offsets, spans } = orientation;
    for (let j = 0; j < orientation.columns; j++)
      for (let k = offsets[j]!; k < offsets[j + 1]!; k += 2)
        insert(this.columns[x + j]!, y + spans[k]!, y + spans[k + 1]!);
  }
}
function insert(column: number[], start: number, end: number): void {
  let i = 0;
  while (i < column.length && column[i + 1]! < start) i += 2;
  let j = i;
  while (j < column.length && column[j]! <= end) {
    start = Math.min(start, column[j]!);
    end = Math.max(end, column[j + 1]!);
    j += 2;
  }
  column.splice(i, j - i, start, end);
}
/** The lowest row at or above `from` where the orientation fits at column `x`, or -1. Each clash
 * lifts the part past the cells it met; the search ends once every column is clear. */
function lowest(
  columns: readonly number[][],
  orientation: Orientation,
  x: number,
  from: number,
  to: number,
): number {
  const { offsets, spans } = orientation,
    width = orientation.columns;
  let y = from,
    j = 0,
    clear = 0;
  if (y > to) return -1;
  while (clear < width) {
    const column = columns[x + j]!;
    let moved = false;
    if (column.length)
      for (let k = offsets[j]!; k < offsets[j + 1]!; k += 2) {
        const a = spans[k]!,
          b = spans[k + 1]!;
        const v = y + a;
        let lo = 0,
          hi = column.length >> 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (column[2 * mid + 1]! > v) hi = mid;
          else lo = mid + 1;
        }
        if (2 * lo < column.length && column[2 * lo]! < y + b) {
          y = column[2 * lo + 1]! - a;
          moved = true;
          break;
        }
      }
    if (moved) {
      if (y > to) return -1;
      clear = 0;
    } else {
      clear++;
      j = j + 1 === width ? 0 : j + 1;
    }
  }
  return y;
}

interface Candidate {
  orientation: number;
  x: number;
  y: number;
  /** Where the part's far end lands along the sheet, in millimetres. */
  reach: number;
}
const betterCandidate = (a: Candidate, b: Candidate | undefined, criterion: NestCriterion) =>
  !b ||
  (criterion === 'length'
    ? a.reach < b.reach - 1e-9 ||
      (Math.abs(a.reach - b.reach) <= 1e-9 && (a.y < b.y || (a.y === b.y && a.x < b.x)))
    : a.x < b.x || (a.x === b.x && a.y < b.y));

/** One bottom-left fill of every copy, or undefined when `stopped` asks it to end early. */
export function nestOnce(
  problem: NestProblem,
  orientations: Orientations,
  pass: NestPass,
  stopped: () => boolean = () => false,
): NestLayout | undefined {
  const cell = orientations.cell,
    reach = reachOf(problem);
  const sheets: Sheet[] = [];
  const opened = problem.formats.map(() => 0);
  const unplaced = problem.parts.map(() => 0);
  const ranges = new Map<string, Range | undefined>();
  const range = (part: number, index: number, format: number) => {
    const key = `${part}:${index}:${format}`;
    if (!ranges.has(key))
      ranges.set(
        key,
        rangeOf(orientations.of(part)[index]!, problem.formats[format]!, problem, cell),
      );
    return ranges.get(key);
  };
  const fits = (part: number, format: number) =>
    orientations.of(part).some((_, index) => range(part, index, format));
  // The smallest box any part turns into: a hole narrower or shorter takes nothing.
  let short = Infinity,
    long = Infinity;
  for (const part of pass.order)
    for (const orientation of orientations.of(part)) {
      short = Math.min(short, Math.min(orientation.width, orientation.height));
      long = Math.min(long, Math.max(orientation.width, orientation.height));
    }
  const holes = new Map<number, (readonly number[])[]>();
  const holesOf = (part: number) => {
    let value = holes.get(part);
    if (!value) {
      value = holeRings(problem.parts[part]!);
      holes.set(part, value);
    }
    return value;
  };
  /** A place inside the hole of a part already on the sheet: the smallest hole that takes the
   * part, at its lowest-leftmost free spot. Material inside a hole is otherwise scrap. */
  const inHole = (sheet: Sheet, part: number): Candidate | undefined => {
    const list = orientations.of(part);
    for (const hole of sheet.holes)
      for (const [index, orientation] of list.entries()) {
        if (orientation.width > hole.x1 - hole.x0 || orientation.height > hole.y1 - hole.y0)
          continue;
        const bounds = range(part, index, sheet.format);
        if (!bounds) continue;
        const x0 = Math.max(bounds.x0, Math.ceil(hole.x0 / cell - 1e-9)),
          x1 = Math.min(bounds.x1, Math.floor((hole.x1 - orientation.width) / cell + 1e-9)),
          y0 = Math.max(bounds.y0, Math.ceil(hole.y0 / cell - 1e-9)),
          y1 = Math.min(bounds.y1, Math.floor((hole.y1 - orientation.height) / cell + 1e-9));
        for (let x = x0; x <= x1; x++) {
          const y = lowest(sheet.columns, orientation, x, y0, y1);
          if (y >= 0) return { orientation: index, x, y, reach: x * cell + orientation.width };
        }
      }
    return undefined;
  };
  const search = (sheet: Sheet, part: number): Candidate | undefined => {
    const list = orientations.of(part),
      cursor = sheet.cursor(part, list.length);
    let best: Candidate | undefined;
    list.forEach((orientation, index) => {
      const bounds = range(part, index, sheet.format);
      if (!bounds) return;
      let x = Math.max(cursor[2 * index]!, bounds.x0),
        from = x === cursor[2 * index] ? Math.max(cursor[2 * index + 1]!, bounds.y0) : bounds.y0;
      for (; x <= bounds.x1; x++, from = bounds.y0) {
        if (best) {
          const ahead =
            pass.criterion === 'length'
              ? x * cell + orientation.width > best.reach + 1e-9
              : x > best.x;
          if (ahead) break;
        }
        const y = lowest(sheet.columns, orientation, x, from, bounds.y1);
        if (y >= 0) {
          const candidate = { orientation: index, x, y, reach: x * cell + orientation.width };
          if (betterCandidate(candidate, best, pass.criterion)) best = candidate;
          from = y;
          break;
        }
      }
      cursor[2 * index] = x;
      cursor[2 * index + 1] = from;
    });
    return best;
  };
  const place = (sheet: Sheet, part: number, candidate: Candidate) => {
    const orientation = orientations.of(part)[candidate.orientation]!;
    sheet.occupy(orientation, candidate.x, candidate.y);
    const placement = {
      part,
      x: candidate.x * cell - orientation.left,
      y: candidate.y * cell - orientation.bottom,
      rotation: orientation.rotation,
      mirror: orientation.mirror,
    };
    sheet.placements.push(placement);
    sheet.area += problem.parts[part]!.area;
    sheet.used = Math.max(sheet.used, candidate.reach);
    const m = placementMatrix(placement.rotation, placement.mirror, placement.x, placement.y);
    for (const ring of holesOf(part)) {
      const hole = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let i = 0; i < ring.length; i += 2) {
        const x = m[0] * ring[i]! + m[2] * ring[i + 1]! + m[4],
          y = m[1] * ring[i]! + m[3] * ring[i + 1]! + m[5];
        hole.x0 = Math.min(hole.x0, x);
        hole.x1 = Math.max(hole.x1, x);
        hole.y0 = Math.min(hole.y0, y);
        hole.y1 = Math.max(hole.y1, y);
      }
      const w = hole.x1 - hole.x0,
        h = hole.y1 - hole.y0;
      if (Math.min(w, h) < short || Math.max(w, h) < long) continue;
      const area = w * h;
      const at = sheet.holes.findIndex(
        (other) => (other.x1 - other.x0) * (other.y1 - other.y0) > area,
      );
      sheet.holes.splice(at < 0 ? sheet.holes.length : at, 0, hole);
    }
  };
  for (const part of pass.order) {
    const shape = problem.parts[part]!;
    for (let copy = 0; copy < shape.quantity; copy++) {
      if (stopped()) return undefined;
      // A hole on any open sheet first, then the first sheet with room.
      let done = false;
      for (const find of [inHole, search]) {
        for (const sheet of sheets) {
          const candidate = find(sheet, part);
          if (candidate) {
            place(sheet, part, candidate);
            done = true;
            break;
          }
        }
        if (done) break;
      }
      if (done) continue;
      const format = pass.formats.find(
        (index) =>
          opened[index]! < (problem.formats[index]!.stock ?? Infinity) && fits(part, index),
      );
      if (format === undefined) {
        unplaced[part]!++;
        continue;
      }
      const size = problem.formats[format]!;
      const sheet = new Sheet(format, sheetLength(size), cell, reach);
      opened[format]!++;
      sheets.push(sheet);
      const candidate = search(sheet, part);
      if (candidate) place(sheet, part, candidate);
      else unplaced[part]!++;
    }
  }
  return {
    sheets: sheets
      .filter((sheet) => sheet.placements.length)
      .map((sheet) => ({
        format: sheet.format,
        placements: sheet.placements,
        area: sheet.area,
        used: sheet.used,
      })),
    unplaced,
    cell,
  };
}
