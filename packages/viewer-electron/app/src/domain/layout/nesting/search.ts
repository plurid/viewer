/**
 * The search over bottom-left fills: each allowed format alone and, with several, a mix; several
 * part orders and both placement rules; then random reorderings of the best, at a finer grid when
 * time allows. Better layouts are yielded as they are found, so a view can show them at once. In
 * the compact direction, each new best has its last sheet packed again as a block in its corner.
 */
import {
  Orientations,
  holeRings,
  nestOnce,
  sheetLength,
  sheetWidth,
  type NestCriterion,
  type NestLayout,
  type NestPart,
  type NestProblem,
} from './nest';
import type { Offcut } from './offcut';
import { offcutArea, offcutOf } from './offcut';
import type { NestedSheet } from './nest';
import { verifyNest, type Verification } from './verify';

export interface NestSummary {
  layout: NestLayout;
  /** Placed copies. */
  placed: number;
  sheets: number;
  /** Sheet area bought, in square millimetres. */
  material: number;
  cost: number;
  /** Parts area over sheet area. */
  utilisation: number;
  /** What the last sheet leaves to keep. */
  offcut?: Offcut;
  /** How far the last sheet's parts spread, the less the better: along the width, how far they
   * reach along its length; along the length, how far across; compact, their box's area. */
  spread: number;
}
export interface NestUpdate {
  best?: NestSummary;
  /** The best layout using only that format, by format. */
  formats: (NestSummary | undefined)[];
  /** The best layout with one more step of rotation freedom for parts that allow less. */
  looser?: NestSummary;
  /** Set once the search ends: the exact check of `best`. */
  verification?: Verification;
  passes: number;
  elapsed: number;
  cell: number;
  done: boolean;
}
export interface NestSearchOptions {
  /** Milliseconds to search. */
  budget: number;
  now: () => number;
  seed?: number;
  /** The same problem with looser rotations, tried once for advice. */
  looser?: NestProblem;
  /** Asked between placements; the search then ends without a final update. */
  stopped?: () => boolean;
}

export function summarize(problem: NestProblem, layout: NestLayout): NestSummary {
  let material = 0,
    cost = 0,
    area = 0;
  for (const sheet of layout.sheets) {
    const format = problem.formats[sheet.format]!;
    material += format.width * format.height;
    cost += format.price;
    area += sheet.area;
  }
  const requested = problem.parts.reduce((sum, part) => sum + part.quantity, 0);
  const last = layout.sheets.at(-1);
  const size = last && problem.formats[last.format]!;
  return {
    layout,
    placed: requested - layout.unplaced.reduce((sum, count) => sum + count, 0),
    sheets: layout.sheets.length,
    material,
    cost,
    utilisation: material ? area / material : 0,
    offcut: last && offcutOf(last.bounds, size!, problem.spacing),
    spread: last ? spreadOf(problem, last) : 0,
  };
}
function spreadOf(problem: NestProblem, sheet: NestedSheet): number {
  const { bounds } = sheet;
  switch (problem.direction ?? 'compact') {
    case 'width':
      return bounds.x1;
    case 'length':
      return sheetWidth(problem.formats[sheet.format]!) - bounds.y0;
    case 'compact':
      return bounds.x1 * bounds.y1;
  }
}
/** More copies placed, then less spent (or, without prices, less sheet area), then fewer sheets,
 * then a last sheet whose parts spread less, then a larger offcut left on it. */
export function better(a: NestSummary, b: NestSummary | undefined, priced: boolean): boolean {
  if (!b) return true;
  if (a.placed !== b.placed) return a.placed > b.placed;
  const spend = (s: NestSummary) => (priced ? s.cost : s.material);
  if (Math.abs(spend(a) - spend(b)) > 1e-6) return spend(a) < spend(b);
  if (a.sheets !== b.sheets) return a.sheets < b.sheets;
  const tolerance = 1e-9 * Math.max(1, a.spread, b.spread);
  if (Math.abs(a.spread - b.spread) > tolerance) return a.spread < b.spread;
  return offcutArea(a.offcut) > offcutArea(b.offcut) + 1e-6;
}

/** Column heights tried for a compact block, as multiples of the side of a square holding its
 * parts' boxes; the full sheet width is tried too. */
const blockSides = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3, 4];
/**
 * The layout with its last sheet packed again as a compact block in its corner: the sheet's own
 * parts nested alone, the columns capped at heights around the side of a square that holds them,
 * keeping the smallest box from the corner, then the larger offcut. The same caps and orders
 * every time, so a layout always compacts the same way. The sheet as it was stays when nothing
 * is tighter.
 */
export function compactLast(
  problem: NestProblem,
  orientations: Orientations,
  layout: NestLayout,
  order: readonly number[],
  stopped: () => boolean = () => false,
): NestLayout {
  const last = layout.sheets.at(-1);
  if (!last || last.placements.length < 2) return layout;
  const counts = problem.parts.map(() => 0);
  for (const placement of last.placements) counts[placement.part]!++;
  const format = problem.formats[last.format]!;
  const single: NestProblem = {
    ...problem,
    direction: 'width',
    parts: problem.parts.map((part, index) => ({ ...part, quantity: counts[index]! })),
    formats: [{ ...format, stock: 1 }],
  };
  const parts = order.filter((index) => counts[index]! > 0);
  const area = parts.reduce((sum, index) => {
    const part = problem.parts[index]!;
    return sum + counts[index]! * (part.width + problem.spacing) * (part.height + problem.spacing);
  }, 0);
  const side = Math.sqrt(area);
  const across = sheetWidth(format) - problem.margin;
  const caps = [
    ...new Set(
      blockSides
        .map((factor) => Math.round(problem.margin + side * factor))
        .filter((cap) => cap < across),
    ),
    Infinity,
  ];
  const score = (sheet: NestedSheet) => sheet.bounds.x1 * sheet.bounds.y1;
  const leaves = (sheet: NestedSheet) =>
    offcutArea(offcutOf(sheet.bounds, format, problem.spacing));
  let best = last;
  for (const cap of caps)
    for (const criterion of ['length', 'left'] as const) {
      if (stopped()) return layout;
      const nested = nestOnce(single, orientations, { order: parts, criterion, formats: [0], cap });
      if (!nested || nested.sheets.length !== 1 || nested.unplaced.some((count) => count > 0))
        continue;
      const candidate = { ...nested.sheets[0]!, format: last.format };
      const tolerance = 1e-9 * score(best);
      if (
        score(candidate) < score(best) - tolerance ||
        (score(candidate) <= score(best) + tolerance && leaves(candidate) > leaves(best) + 1e-6)
      )
        best = candidate;
    }
  return best === last ? layout : { ...layout, sheets: [...layout.sheets.slice(0, -1), best] };
}

/** A grid fine enough for the parts and coarse enough for the sheets, in millimetres. */
export function baseCell(problem: NestProblem): number {
  const longest = Math.max(...problem.formats.map(sheetLength));
  const sides = problem.parts
    .filter((part) => part.quantity > 0)
    .map((part) => Math.min(part.width, part.height))
    .sort((a, b) => a - b);
  const typical = sides[Math.floor(sides.length / 2)] ?? longest / 10;
  const smallest = sides[0] ?? typical;
  const cell = Math.min(typical / 100, Math.max(smallest / 12, typical / 400));
  const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const bounded = Math.max(longest / 5000, Math.min(longest / 600, cell));
  return steps.find((step) => step >= bounded) ?? steps.at(-1)!;
}

/** The order formats open in a mixed layout: cheapest material first, or the largest sheet. */
export function mixedOrder(problem: NestProblem): number[] {
  const priced = problem.formats.some((format) => format.price > 0);
  const usable = (index: number) => {
    const format = problem.formats[index]!;
    return (
      Math.max(0, sheetLength(format) - 2 * problem.margin) *
      Math.max(0, sheetWidth(format) - 2 * problem.margin)
    );
  };
  return problem.formats
    .map((_, index) => index)
    .sort((a, b) =>
      priced
        ? problem.formats[a]!.price / usable(a) - problem.formats[b]!.price / usable(b)
        : usable(b) - usable(a),
    );
}

type Key = (part: NestPart) => number;
const orders: Key[] = [
  (part) => part.area,
  (part) => Math.max(part.width, part.height),
  (part) => part.width * part.height,
  (part) => Math.min(part.width, part.height),
];
function sortedOrder(problem: NestProblem, key: Key): number[] {
  return problem.parts
    .map((_, index) => index)
    .filter((index) => problem.parts[index]!.quantity > 0)
    .sort((a, b) => key(problem.parts[b]!) - key(problem.parts[a]!) || a - b);
}
/** For each part, the parts with a hole it might fit in, by their boxes at its allowed turns. */
export function hostsOf(problem: NestProblem): number[][] {
  const sides = (values: readonly (readonly number[])[], angle: number): [number, number] => {
    const radians = (angle * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const ring of values)
      for (let i = 0; i < ring.length; i += 2) {
        const x = cos * ring[i]! - sin * ring[i + 1]!,
          y = sin * ring[i]! + cos * ring[i + 1]!;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    const w = x1 - x0,
      h = y1 - y0;
    return [Math.min(w, h), Math.max(w, h)];
  };
  const holes = problem.parts.map((part) => holeRings(part).map((ring) => sides([ring], 0)));
  return problem.parts.map((guest, index) => {
    if (!guest.quantity) return [];
    const boxes = guest.angles.map((angle) => sides([...guest.rings, ...guest.paths], angle));
    return problem.parts.flatMap((host, at) =>
      at !== index &&
      host.quantity > 0 &&
      holes[at]!.some(([short, long]) => boxes.some(([s, l]) => s <= short && l <= long))
        ? [at]
        : [],
    );
  });
}
/** The order with every part after the parts whose holes it might fill: a hole can only take a
 * part once its own part is on the sheet. */
export function hostsFirst(order: readonly number[], hosts: readonly number[][]): number[] {
  const result = [...order];
  for (let round = 0; round < result.length; round++) {
    let moved = false;
    for (const part of order) {
      const at = result.indexOf(part);
      const last = Math.max(-1, ...hosts[part]!.map((host) => result.indexOf(host)));
      if (last > at) {
        result.splice(at, 1);
        result.splice(last, 0, part);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return result;
}
/** A small, seeded pseudo-random generator, so a search can be repeated. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function* nestSearch(
  problem: NestProblem,
  options: NestSearchOptions,
): Generator<NestUpdate, void, undefined> {
  const start = options.now();
  const elapsed = () => options.now() - start;
  const stopped = options.stopped ?? (() => false);
  const out = () => stopped() || elapsed() >= options.budget;
  const priced = problem.formats.some((format) => format.price > 0);
  const compact = (problem.direction ?? 'compact') === 'compact';
  const base = baseCell(problem);
  const levels = new Map<number, Orientations>();
  const at = (cell: number, source = problem) => {
    if (source !== problem) return new Orientations(source, cell);
    let value = levels.get(cell);
    if (!value) {
      value = new Orientations(problem, cell);
      levels.set(cell, value);
    }
    return value;
  };
  const strategies: { formats: number[]; single?: number }[] = problem.formats.map((_, index) => ({
    formats: [index],
    single: index,
  }));
  if (problem.formats.length > 1) strategies.push({ formats: mixedOrder(problem) });
  const bests: { summary?: NestSummary; order?: number[] }[] = strategies.map(() => ({}));
  let best: NestSummary | undefined,
    bestStrategy = 0,
    passes = 0,
    cell = base * 2,
    looser: NestSummary | undefined;
  const update = (done = false, verification?: Verification): NestUpdate => ({
    best,
    formats: problem.formats.map(
      (_, index) => bests.find((_, s) => strategies[s]!.single === index)?.summary,
    ),
    looser,
    verification,
    passes,
    elapsed: elapsed(),
    cell,
    done,
  });
  /** One pass; whether it improved anything. */
  const run = (
    strategy: number,
    order: number[],
    criterion: NestCriterion,
    level: number,
  ): boolean => {
    const layout = nestOnce(
      problem,
      at(level),
      { order, criterion, formats: strategies[strategy]!.formats },
      // The first pass always finishes, so there is an answer however short the budget.
      passes ? out : stopped,
    );
    passes++;
    if (!layout) return false;
    cell = level;
    let summary = summarize(problem, layout);
    if (compact && better(summary, best, priced))
      summary = summarize(problem, compactLast(problem, at(level), layout, order, stopped));
    let improved = false;
    if (better(summary, bests[strategy]!.summary, priced)) {
      bests[strategy] = { summary, order };
      improved = true;
    }
    if (better(summary, best, priced)) {
      best = summary;
      bestStrategy = strategy;
      improved = true;
    }
    return improved;
  };
  const hosts = hostsOf(problem);
  const initial = hostsFirst(sortedOrder(problem, orders[0]!), hosts);
  if (!initial.length) {
    yield update(true, { ok: true, closest: Infinity, problems: [] });
    return;
  }
  // A quick coarse answer for every strategy, then the base grid with each order and rule.
  for (const [s] of strategies.entries()) {
    if (run(s, initial, 'length', base * 2)) yield update();
    if (out()) break;
  }
  outer: for (const key of orders)
    for (const criterion of ['length', 'left'] as const)
      for (const [s] of strategies.entries()) {
        if (out()) break outer;
        if (run(s, hostsFirst(sortedOrder(problem, key), hosts), criterion, base)) yield update();
      }
  // Then reorder the best: swap neighbours and nudge parts forward or back.
  const next = random(options.seed ?? 1);
  let fine = false,
    quiet = 0;
  while (!out()) {
    const strategy = next() < 0.75 ? bestStrategy : Math.floor(next() * strategies.length);
    const order = [...(bests[strategy]!.order ?? initial)];
    const moves = 1 + Math.floor(next() * Math.min(4, order.length));
    for (let m = 0; m < moves && order.length > 1; m++) {
      const i = Math.floor(next() * order.length),
        j = Math.min(order.length - 1, Math.max(0, i + Math.floor(next() * 5) - 2));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    // Past half the budget, a finer grid when the base grid is coarse for the spacing.
    fine ||= elapsed() > options.budget / 2 && base > 0.5;
    const level = fine && next() < 0.5 ? base / 2 : base;
    if (run(strategy, hostsFirst(order, hosts), next() < 0.7 ? 'length' : 'left', level)) {
      quiet = 0;
      yield update();
    } else quiet++;
    // With every copy on as few sheets as the area allows, only the remnant can still grow; the
    // search ends once that stops improving.
    if (
      quiet >= stagnation &&
      best &&
      best.placed === total(problem) &&
      best.sheets <= lowerBound(problem)
    )
      break;
  }
  if (stopped()) return;
  if (options.looser && best) {
    const layout = nestOnce(options.looser, at(base, options.looser), {
      order: bests[bestStrategy]!.order ?? initial,
      criterion: 'length',
      formats: strategies[bestStrategy]!.formats,
    });
    if (layout) looser = summarize(options.looser, layout);
  }
  const verification = best
    ? verifyNest(problem, best.layout.sheets)
    : { ok: true, closest: Infinity, problems: [] };
  yield update(true, verification);
}
/** Passes without a better layout after which a search at its sheet bound ends. */
const stagnation = 60;
const total = (problem: NestProblem) => problem.parts.reduce((sum, part) => sum + part.quantity, 0);
/** Sheets needed at best by area alone, with the smallest usable format. */
function lowerBound(problem: NestProblem): number {
  const area = problem.parts.reduce((sum, part) => sum + part.area * part.quantity, 0);
  const largest = Math.max(
    ...problem.formats.map(
      (format) =>
        Math.max(0, sheetLength(format) - 2 * problem.margin) *
        Math.max(0, sheetWidth(format) - 2 * problem.margin),
    ),
  );
  return largest > 0 ? Math.ceil(area / largest - 1e-9) : Infinity;
}
