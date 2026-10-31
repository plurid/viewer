import DxfParser from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import { readCutDrawing } from '../src/domain/layout/nesting/drawing';
import { sheetDXF } from '../src/domain/layout/nesting/dxf-writer';
import { cuttingEstimate } from '../src/domain/layout/nesting/estimate';
import {
  areaText,
  durationText,
  fromUnit,
  gapText,
  lengthText,
  moneyText,
  sizeText,
  speedText,
  weightText,
} from '../src/domain/layout/nesting/format';
import { insideRings, placementMatrix } from '../src/domain/layout/nesting/geometry';
import { nestOnce, Orientations, type NestProblem } from '../src/domain/layout/nesting/nest';
import { offcutOf } from '../src/domain/layout/nesting/offcut';
import { extractParts, suggestedMarks, type Part } from '../src/domain/layout/nesting/parts';
import {
  cuttingPresets,
  inchSheetPresets,
  presetFor,
  sheetAllowance,
  sheetName,
} from '../src/domain/layout/nesting/plan';
import type { NestDirection } from '../src/domain/layout/nesting/plan';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';
import { nestPart, nestProblem, type PartChoice } from '../src/domain/layout/nesting/problem';
import { areaBound, packBoxes } from '../src/domain/layout/nesting/rectangles';
import {
  baseCell,
  hostsFirst,
  hostsOf,
  nestSearch,
  type NestUpdate,
} from '../src/domain/layout/nesting/search';
import { verifyNest } from '../src/domain/layout/nesting/verify';
import { nestingAdvice } from '../src/domain/layout/nesting/advice';
import { cad, drawing, nestingParts } from '../tools/playground/samples/nesting';

const read = (text: string, options: { together?: boolean; scale?: number } = {}) => {
  const cut = readCutDrawing(text);
  return extractParts(
    cut,
    {
      scale: options.scale ?? 1,
      marks: new Set(suggestedMarks(cut.layers)),
      together: !!options.together,
    },
    'Part',
  );
};
const only = (text: string) => {
  const file = read(text);
  expect(file.problem).toBeUndefined();
  expect(file.parts).toHaveLength(1);
  return file.parts[0]!;
};
const choice = (quantity: number, patch: Partial<PartChoice> = {}): PartChoice => ({
  quantity,
  rotation: 'quarter',
  mirror: false,
  grain: false,
  ...patch,
});
const square = (x: number, y: number, size: number) =>
  cad.outline('CUT', [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ]);
/** Runs a search to the end and returns its last update. */
function finish(problem: NestProblem, budget = 400): NestUpdate {
  let last: NestUpdate | undefined;
  for (const update of nestSearch(problem, { budget, now: () => performance.now(), seed: 7 }))
    last = update;
  return last!;
}
function placedPoints(
  part: Part,
  placement: { x: number; y: number; rotation: number; mirror: boolean },
) {
  const m = placementMatrix(placement.rotation, placement.mirror, placement.x, placement.y);
  return part.rings.map((ring) => {
    const out: number[] = [];
    for (let i = 0; i < ring.length; i += 2)
      out.push(
        m[0] * ring[i]! + m[2] * ring[i + 1]! + m[4],
        m[1] * ring[i]! + m[3] * ring[i + 1]! + m[5],
      );
    return out;
  });
}

describe('parts from DXF', () => {
  it('converts declared units to millimetres and reports drawings that do not say', () => {
    const inches = readCutDrawing(drawing([square(0, 0, 2)], 1));
    expect(inches.units).toBe(1);
    const part = extractParts(inches, { scale: 25.4, marks: new Set(), together: false }, 'Plate')
      .parts[0]!;
    expect(part.width).toBeCloseTo(50.8, 9);
    expect(part.area).toBeCloseTo(50.8 * 50.8, 6);
    expect(readCutDrawing(drawing([square(0, 0, 2)], null)).units).toBe(0);
  });

  it('joins lines drawn in any order and direction into one outline with an exact cut length', () => {
    const lines = [
      cad.line('CUT', 100, 0, 0, 0),
      cad.line('CUT', 100, 100, 100, 200),
      cad.line('CUT', 0, 200, 0, 0),
      cad.line('CUT', 200, 100, 100, 100),
      cad.line('CUT', 100, 200, 0, 200),
      cad.line('CUT', 200, 100, 200, 0.02),
      cad.line('CUT', 100, 0, 200, 0),
    ];
    const part = only(drawing(lines));
    expect(part.rings).toHaveLength(1);
    expect(part.pierces).toBe(1);
    // The 0.02 mm joint moves one corner: a sliver of 1 mm² against 30,000.
    expect(part.area).toBeCloseTo(30000, -1);
    expect(part.cutLength).toBeCloseTo(800, 1);
  });

  it('keeps arcs exact and finds outlines and holes', () => {
    const segment = only(nestingParts['Arc segment']());
    expect(segment.cutLength).toBeCloseTo((Math.PI / 2) * 500 + 200, 9);
    expect(segment.entities.filter((e) => e.primitive.kind === 'arc')).toHaveLength(2);
    const bracket = only(nestingParts['Bracket with holes']());
    expect(bracket.holes).toBe(4);
    expect(bracket.pierces).toBe(5);
    const corners = 4 * 20 * 20 - Math.PI * 20 * 20;
    expect(bracket.area).toBeCloseTo(300 * 200 - corners - 4 * Math.PI * 100, 9);
    expect(bracket.cutLength).toBeCloseTo(
      2 * (260 + 160) + 2 * Math.PI * 20 + 4 * 2 * Math.PI * 10,
      6,
    );
    expect(bracket.entities.map((e) => e.role).sort()).toEqual([
      'inner',
      'inner',
      'inner',
      'inner',
      'mark',
      'outer',
    ]);
    expect(bracket.width).toBe(300);
    expect(bracket.height).toBe(200);
  });

  it('counts open paths toward cut length and pierces, not area', () => {
    const plain = only(drawing([square(0, 0, 100)]));
    const slit = only(drawing([square(0, 0, 100), cad.line('CUT', 20, 50, 80, 50)]));
    expect(slit.area).toBeCloseTo(plain.area, 9);
    expect(slit.cutLength).toBeCloseTo(plain.cutLength + 60, 9);
    expect(slit.pierces).toBe(2);
    expect(slit.paths).toHaveLength(1);
    expect(read(drawing([square(0, 0, 100), cad.line('CUT', 20, 50, 80, 50)])).notes).toContain(
      '1 open path is cut as drawn.',
    );
  });

  it('draws marked layers without cutting them and suggests common marking names', () => {
    expect(
      suggestedMarks(
        ['CUT', 'ENGRAVE', 'Mark-1', 'etching', 'TEXT', 'Outline'].map((name) => ({
          name,
          count: 1,
          hidden: false,
        })),
      ),
    ).toEqual(['ENGRAVE', 'Mark-1', 'etching', 'TEXT']);
    const tab = only(nestingParts.Tab());
    expect(tab.cutLength).toBeCloseTo(200, 9);
    expect(tab.markLength).toBeCloseTo(40, 9);
    expect(tab.pierces).toBe(1);
    expect(tab.marks).toHaveLength(1);
    // With the layer cut instead, the line becomes an open path.
    const cut = readCutDrawing(nestingParts.Tab());
    const asCut = extractParts(cut, { scale: 1, marks: new Set(), together: false }, 'Tab')
      .parts[0]!;
    expect(asCut.cutLength).toBeCloseTo(240, 9);
    expect(asCut.pierces).toBe(2);
  });

  it('names a drawing without a closed outline and bridges only small gaps', () => {
    const open = read(
      drawing([
        cad.line('CUT', 0, 0, 100, 0),
        cad.line('CUT', 100, 0, 100, 100),
        cad.line('CUT', 100, 100, 0, 100),
        cad.line('CUT', 0, 100, 0, 2),
      ]),
    );
    expect(open.parts).toEqual([]);
    expect(open.problem).toBe(
      'Part has no closed outline. Its nearest open ends are 2.00 mm apart.',
    );
    const bridged = read(
      drawing([
        cad.line('CUT', 0, 0, 100, 0),
        cad.line('CUT', 100, 0, 100, 100),
        cad.line('CUT', 100, 100, 0, 100),
        cad.line('CUT', 0, 100, 0, 0.3),
      ]),
    );
    expect(bridged.parts).toHaveLength(1);
    expect(bridged.notes).toContain('Closed a 0.30 mm gap in an outline. Check the drawing.');
    expect(read(drawing([cad.line('ENGRAVE', 0, 0, 10, 0)])).problem).toBe(
      'Part has nothing to cut.',
    );
  });

  it('offers separate outlines as copies of separate parts, or as one part', () => {
    const text = drawing([
      square(0, 0, 50),
      square(100, 0, 50),
      square(200, 0, 50),
      cad.circle('CUT', 400, 25, 25),
      cad.line('CUT', 0, 0, 50, 0),
    ]);
    const apart = read(text);
    expect(apart.outlines).toBe(4);
    expect(apart.notes).toContain('1 duplicate entity left out: each line is cut once.');
    expect(apart.parts.map((part) => [part.name, part.copies])).toEqual([
      ['Part 1', 3],
      ['Part 2', 1],
    ]);
    const together = read(text, { together: true });
    expect(together.parts).toHaveLength(1);
    expect(together.parts[0]!.pierces).toBe(4);
    expect(together.parts[0]!.width).toBe(425);
  });

  it('never groups a mirrored copy with the part it mirrors', () => {
    const l = (x: number, flip: number) =>
      cad.polyline('CUT', [
        [x, 0],
        [x + 100 * flip, 0],
        [x + 100 * flip, 30],
        [x + 30 * flip, 30],
        [x + 30 * flip, 80],
        [x, 80],
      ]);
    const file = read(drawing([l(0, 1), l(300, -1), l(500, 1)]));
    expect(file.parts.map((part) => part.copies).sort()).toEqual([1, 2]);
  });

  it('keeps a disc drawn inside a ring as a part of its own', () => {
    const file = read(
      drawing([cad.circle('0', 0, 0, 150), cad.circle('0', 0, 0, 100), cad.circle('0', 0, 0, 60)]),
    );
    expect(file.parts).toHaveLength(2);
    expect(file.parts.map((part) => part.holes)).toEqual([1, 0]);
  });
});

describe('box estimate', () => {
  it('packs 100 mm squares 100 to a 1000 mm sheet without spacing or margin', () => {
    const estimate = packBoxes(
      [{ width: 100, height: 100, area: 10000, quantity: 250, turn: true }],
      { width: 1000, height: 1000, price: 0 },
      0,
      0,
    );
    expect(estimate.sheets.map((sheet) => sheet.placements.length)).toEqual([100, 100, 50]);
    expect(estimate.unplaced).toEqual([0]);
    expect(
      areaBound(
        [{ width: 100, height: 100, area: 10000, quantity: 250, turn: true }],
        { width: 1000, height: 1000, price: 0 },
        0,
      ),
    ).toBe(3);
  });

  it('takes spacing between boxes and the margin at the edges, and respects stock', () => {
    const spaced = packBoxes(
      [{ width: 100, height: 100, area: 10000, quantity: 100, turn: false }],
      { width: 1020, height: 1020, price: 0, stock: 1 },
      10,
      10,
    );
    // (1000 + 10) / 110 = 9 per row.
    expect(spaced.sheets).toHaveLength(1);
    expect(spaced.sheets[0]!.placements).toHaveLength(81);
    expect(spaced.unplaced).toEqual([19]);
    expect(spaced.sheets[0]!.placements[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('turns a long part only when allowed', () => {
    // The sheet lies with its 2000 mm length along x; a part's x runs along it.
    const format = { width: 500, height: 2000, price: 0 };
    const upright = (turn: boolean) => [
      { width: 300, height: 1500, area: 450000, quantity: 1, turn },
    ];
    expect(packBoxes(upright(true), format, 0, 0).unplaced).toEqual([0]);
    expect(packBoxes(upright(false), format, 0, 0).unplaced).toEqual([1]);
    expect(
      packBoxes([{ ...upright(false)[0]!, width: 1500, height: 300 }], format, 0, 0).unplaced,
    ).toEqual([0]);
  });
});

describe('true-shape nesting', () => {
  it('nests a disc inside a ring', () => {
    const ring = only(nestingParts.Ring()),
      disc = only(nestingParts.Disc());
    const problem = nestProblem(
      [
        { part: ring, choice: choice(1) },
        { part: disc, choice: choice(1) },
      ],
      [{ width: 330, height: 330, price: 0 }],
      { margin: 10, spacing: 5 },
    );
    const result = finish(problem);
    expect(result.best!.sheets).toBe(1);
    expect(result.verification!.ok).toBe(true);
    const sheet = result.best!.layout.sheets[0]!;
    const ringAt = sheet.placements.find((p) => p.part === 0)!,
      discAt = sheet.placements.find((p) => p.part === 1)!;
    const centre = placementMatrix(discAt.rotation, discAt.mirror, discAt.x, discAt.y);
    const middle = {
      x: centre[0] * 75 + centre[2] * 75 + centre[4],
      y: centre[1] * 75 + centre[3] * 75 + centre[5],
    };
    const ringCentre = placementMatrix(ringAt.rotation, ringAt.mirror, ringAt.x, ringAt.y);
    expect(
      Math.hypot(
        middle.x - (ringCentre[0] * 150 + ringCentre[2] * 150 + ringCentre[4]),
        middle.y - (ringCentre[1] * 150 + ringCentre[3] * 150 + ringCentre[5]),
      ),
    ).toBeLessThanOrEqual(100 - 75 - 5 + 1e-6);
  });

  it('puts the playground disc in the ring, whatever order the parts come in', () => {
    // The playground set as nested in the app: six brackets and one of each other part.
    const names = ['Bracket with holes', 'Ring', 'Disc', 'L-shape'] as const;
    const parts = names.map((name, index) => ({
      part: only(nestingParts[name]()),
      choice: choice(index ? 1 : 6),
    }));
    const problem = nestProblem(parts, [{ width: 1250, height: 2500, price: 0 }], {
      margin: 10,
      spacing: 5,
    });
    const disc = (layout: {
      placements: readonly {
        part: number;
        x: number;
        y: number;
        rotation: number;
        mirror: boolean;
      }[];
    }) => {
      const centre = (part: number, local: number) => {
        const p = layout.placements.find((placement) => placement.part === part)!;
        const m = placementMatrix(p.rotation, p.mirror, p.x, p.y);
        return { x: m[0] * local + m[2] * local + m[4], y: m[1] * local + m[3] * local + m[5] };
      };
      const ring = centre(1, 150),
        inner = centre(2, 75);
      // Hole radius 100, disc radius 75, 5 mm spacing.
      return Math.hypot(ring.x - inner.x, ring.y - inner.y) <= 100 - 75 - 5 + 1e-6;
    };
    const result = finish(problem, 15_000);
    expect(result.best!.sheets).toBe(1);
    expect(result.verification!.ok).toBe(true);
    expect(disc(result.best!.layout.sheets[0]!)).toBe(true);
    // Every order the search can try puts the ring first, so its hole is there for the disc.
    const hosts = hostsOf(problem);
    expect(hosts).toEqual([[], [], [1], []]);
    const permutations = (rest: number[]): number[][] =>
      rest.length
        ? rest.flatMap((first) =>
            permutations(rest.filter((other) => other !== first)).map((tail) => [first, ...tail]),
          )
        : [[]];
    for (const cell of [baseCell(problem), 2 * baseCell(problem)]) {
      const orientations = new Orientations(problem, cell);
      for (const order of permutations([0, 1, 2, 3]))
        for (const criterion of ['length', 'left'] as const) {
          const layout = nestOnce(problem, orientations, {
            order: hostsFirst(order, hosts),
            criterion,
            formats: [0],
          })!;
          expect(layout.sheets).toHaveLength(1);
          expect(disc(layout.sheets[0]!)).toBe(true);
        }
    }
  });

  it('interlocks L-shapes onto fewer sheets than their boxes need', () => {
    const l = only(nestingParts['L-shape']());
    const format = { width: 1250, height: 2500, price: 0 };
    const boxes = packBoxes(
      [{ width: l.width, height: l.height, area: l.area, quantity: 30, turn: true }],
      format,
      10,
      5,
    );
    const result = finish(
      nestProblem([{ part: l, choice: choice(30) }], [format], { margin: 10, spacing: 5 }),
    );
    expect(boxes.sheets.length).toBe(2);
    expect(result.best!.sheets).toBe(1);
    expect(result.best!.placed).toBe(30);
    expect(result.verification).toMatchObject({ ok: true });
    expect(result.verification!.closest).toBeGreaterThanOrEqual(5);
  });

  it('places twenty parts without overlaps and inside the margin', () => {
    const quantities = [6, 3, 8, 4, 5, 4, 4, 5, 2, 3, 3, 2, 3, 10, 8, 2, 2, 3, 3, 2];
    const parts = Object.values(nestingParts).map((make, index) => ({
      part: only(make()),
      choice: choice(quantities[index]!),
    }));
    const problem = nestProblem(parts, [{ width: 1250, height: 2500, price: 0 }], {
      margin: 10,
      spacing: 5,
    });
    const result = finish(problem, 600);
    expect(result.best!.placed).toBe(82);
    expect(result.verification).toMatchObject({ ok: true, problems: [] });
    // An independent check: no placed outline's first point lies on another part's material.
    for (const sheet of result.best!.layout.sheets) {
      const rings = sheet.placements.map((p) => placedPoints(parts[p.part]!.part, p));
      rings.forEach((own, i) =>
        rings.forEach((other, j) => {
          if (i !== j) expect(insideRings(own[0]![0]!, own[0]![1]!, other)).toBe(false);
        }),
      );
    }
  });

  it('finds overlaps and margin crossings in a layout it did not make', () => {
    const square100 = only(drawing([square(0, 0, 100)]));
    const problem = nestProblem(
      [{ part: square100, choice: choice(2) }],
      [{ width: 1000, height: 1000, price: 0 }],
      {
        margin: 10,
        spacing: 5,
      },
    );
    const check = (placements: { x: number; y: number }[]) =>
      verifyNest(problem, [
        {
          format: 0,
          placements: placements.map((p) => ({ part: 0, rotation: 0, mirror: false, ...p })),
        },
      ]);
    expect(
      check([
        { x: 20, y: 20 },
        { x: 130, y: 20 },
      ]).ok,
    ).toBe(true);
    expect(
      check([
        { x: 20, y: 20 },
        { x: 122, y: 20 },
      ]).problems,
    ).toEqual(['Sheet 1: two parts are 2.00 mm apart.']);
    expect(
      check([
        { x: 20, y: 20 },
        { x: 50, y: 50 },
      ]).problems,
    ).toEqual(['Sheet 1: two parts are 0.00 mm apart.']);
    expect(check([{ x: 5, y: 20 }]).problems).toEqual(['Sheet 1: part 1 crosses the margin.']);
    const inside = nestProblem(
      [
        { part: only(drawing([square(0, 0, 300)])), choice: choice(1) },
        { part: square100, choice: choice(1) },
      ],
      [{ width: 1000, height: 1000, price: 0 }],
      { margin: 10, spacing: 5 },
    );
    expect(
      verifyNest(inside, [
        {
          format: 0,
          placements: [
            { part: 0, x: 20, y: 20, rotation: 0, mirror: false },
            { part: 1, x: 120, y: 120, rotation: 0, mirror: false },
          ],
        },
      ]).ok,
    ).toBe(false);
  });

  it('honours turn, mirror and grain choices', () => {
    const l = only(nestingParts['L-shape']());
    const t = only(nestingParts['T-shape']());
    const format = { width: 1250, height: 2500, price: 0 };
    const fixed = finish(
      nestProblem([{ part: l, choice: choice(12, { rotation: 'none' }) }], [format], {
        margin: 10,
        spacing: 5,
      }),
    );
    for (const sheet of fixed.best!.layout.sheets)
      for (const p of sheet.placements) expect([p.rotation, p.mirror]).toEqual([0, false]);
    const grain = finish(
      nestProblem(
        [
          { part: l, choice: choice(12, { rotation: 'free', grain: true, mirror: true }) },
          { part: t, choice: choice(6, { rotation: 'eighth' }) },
        ],
        [format],
        { margin: 10, spacing: 5 },
      ),
    );
    const turns = grain.best!.layout.sheets.flatMap((sheet) => sheet.placements);
    for (const p of turns.filter((p) => p.part === 0)) expect([0, 180]).toContain(p.rotation);
    for (const p of turns.filter((p) => p.part === 1)) {
      expect(p.rotation % 45).toBe(0);
      expect(p.mirror).toBe(false);
    }
    expect(grain.verification!.ok).toBe(true);
  });

  it('leaves a part that fits no sheet unplaced and says why', () => {
    const strip = only(nestingParts.Strip());
    const problem = nestProblem(
      [{ part: strip, choice: choice(2, { rotation: 'none' }) }],
      [{ width: 700, height: 700, price: 0 }],
      { margin: 10, spacing: 5 },
    );
    const result = finish(problem, 100);
    expect(result.best!.layout.unplaced).toEqual([2]);
    expect(
      nestingAdvice({
        names: ['Strip'],
        parts: problem.parts,
        formats: problem.formats,
        margin: 10,
        best: result.best,
        single: result.formats,
        boxes: [],
        currency: '€',
      }).map((advice) => advice.text),
    ).toEqual(['Strip fits a sheet only when turned. Allow it to turn further.']);
  });

  it('compares formats and prices', () => {
    const plate = only(drawing([square(0, 0, 400)]));
    const problem = nestProblem(
      [{ part: plate, choice: choice(18) }],
      [
        { width: 1250, height: 2500, price: 150 },
        { width: 1500, height: 3000, price: 200 },
      ],
      { margin: 10, spacing: 5 },
    );
    const result = finish(problem, 800);
    // 1250 × 2500 holds 3 × 6 = 18 plates: one sheet; 1500 × 3000 holds 3 × 7.
    const texts = nestingAdvice({
      names: ['Plate'],
      parts: problem.parts,
      formats: problem.formats,
      margin: 10,
      best: result.best,
      single: result.formats,
      boxes: [],
      currency: '€',
    }).map((advice) => advice.text);
    expect(texts).toContain('1250 × 2500: 1 sheet, 92% used, €150');
    expect(texts).toContain('1500 × 3000: 1 sheet, 64% used, €200');
    expect(result.best!.layout.sheets.map((sheet) => sheet.format)).toEqual([0]);
  });

  it('stops when asked, inside a pass and between passes', () => {
    const l = only(nestingParts['L-shape']());
    const problem = nestProblem(
      [{ part: l, choice: choice(400) }],
      [{ width: 1250, height: 2500, price: 0 }],
      {
        margin: 10,
        spacing: 5,
      },
    );
    let calls = 0;
    expect(
      nestOnce(
        problem,
        new Orientations(problem, 2),
        { order: [0], criterion: 'length', formats: [0] },
        () => ++calls > 3,
      ),
    ).toBeUndefined();
    let asked = false;
    const updates: NestUpdate[] = [];
    const started = performance.now();
    for (const update of nestSearch(problem, {
      budget: 60_000,
      now: () => performance.now(),
      stopped: () => asked,
    })) {
      updates.push(update);
      asked = true;
    }
    expect(updates).toHaveLength(1);
    expect(updates[0]!.done).toBe(false);
    const generator = nestSearch(problem, { budget: 60_000, now: () => performance.now() });
    expect(generator.next().value!.best!.placed).toBe(400);
    generator.return();
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe('estimates', () => {
  it('adds cutting time, pierce time, sheet prices and machine time', () => {
    const estimate = cuttingEstimate(
      [{ cutLength: 1000, pierces: 2, markLength: 50, area: 100_000, quantity: 10 }],
      [
        { width: 1000, height: 2000, price: 100 },
        { width: 1000, height: 2000, price: 100 },
      ],
      {
        material: 'Mild steel',
        process: 'fiber',
        thickness: 3,
        speed: 2000,
        pierce: 0.6,
        density: 7.85,
        rate: 60,
        currency: '€',
      },
    );
    expect(estimate.cutLength).toBe(10_000);
    expect(estimate.pierces).toBe(20);
    expect(estimate.markLength).toBe(500);
    // 10 m at 2 m/min is 5 min; 20 pierces × 0.6 s is 0.2 min.
    expect(estimate.minutes).toBeCloseTo(5.2, 12);
    expect(estimate.machine).toBeCloseTo(5.2, 12);
    expect(estimate.material).toBe(200);
    expect(estimate.total).toBeCloseTo(205.2, 12);
    expect(estimate.sheetWeight).toBeCloseTo((2 * 2_000_000 * 3 * 7.85) / 1e6, 9);
    expect(estimate.partWeight).toBeCloseTo((1_000_000 * 3 * 7.85) / 1e6, 9);
    expect(durationText(5.2)).toBe('5 min');
    expect(durationText(119.7)).toBe('2 h');
    expect(durationText(0.2)).toBe('12 s');
    expect(moneyText(205.2, '€')).toBe('€205');
    expect(moneyText(12.5, 'lei')).toBe('12.5 lei');
    expect(lengthText(152_400)).toBe('152 m');
    expect(lengthText(850)).toBe('850 mm');
  });
});

describe('nesting direction and offcut', () => {
  const small = () =>
    only(
      drawing([
        cad.outline('CUT', [
          [0, 0],
          [90, 0],
          [90, 72],
          [0, 72],
        ]),
      ]),
    );
  const nest = (direction: NestDirection, patch: Partial<PartChoice> = {}) => {
    const problem = nestProblem(
      [{ part: small(), choice: choice(16, patch) }],
      [{ width: 1250, height: 2500, price: 0 }],
      { margin: 10, spacing: 5, direction },
    );
    const update = finish(problem, 2000);
    expect(update.best!.placed).toBe(16);
    expect(update.verification!.ok).toBe(true);
    return update.best!;
  };

  it('packs small parts into a block in one corner, keeping the largest offcut whole', () => {
    // 16 small parts on 1250 × 2500 used to come out as a column down the sheet's whole width
    const best = nest('compact');
    const { bounds } = best.layout.sheets[0]!;
    expect(bounds.x0).toBeLessThan(15);
    expect(bounds.y0).toBeLessThan(15);
    expect(bounds.x1).toBeLessThan(450);
    expect(bounds.y1).toBeLessThan(450);
    expect(best.offcut).toMatchObject({ width: 1250, reusable: true });
    expect(best.offcut!.height).toBeGreaterThan(2050);
    // the same layout every time
    expect(nest('compact').layout.sheets).toEqual(best.layout.sheets);
  });

  it('lays rows down the length, or fills across the width first', () => {
    const along = nest('length');
    const row = along.layout.sheets[0]!.bounds;
    expect(row.x1 - row.x0).toBeGreaterThan(1000);
    expect(row.y1 - row.y0).toBeLessThan(200);
    expect(along.offcut).toMatchObject({ height: 2500, reusable: true });
    const across = nest('width');
    const column = across.layout.sheets[0]!.bounds;
    expect(column.y1 - column.y0).toBeGreaterThan(1000);
    expect(column.x1).toBeLessThan(200);
    expect(across.offcut).toMatchObject({ width: 1250, reusable: true });
  });

  it('keeps a grain-locked part along the length when the rows run down it', () => {
    const best = nest('length', { grain: true });
    const turns = new Set(
      best.layout.sheets.flatMap((sheet) => sheet.placements.map((p) => p.rotation)),
    );
    expect([...turns].every((turn) => turn === 0 || turn === 180)).toBe(true);
    expect(best.layout.sheets.flatMap((sheet) => sheet.placements).some((p) => p.mirror)).toBe(
      false,
    );
  });

  it('takes the offcut as the largest piece one cut across the sheet leaves', () => {
    const size = { width: 1250, height: 2500 };
    expect(offcutOf({ x0: 10, y0: 10, x1: 315, y1: 300 }, size, 5)).toEqual({
      width: 1250,
      height: 2180,
      reusable: true,
    });
    // a strip down the length is larger than one across
    expect(offcutOf({ x0: 10, y0: 10, x1: 2490, y1: 300 }, size, 5)).toEqual({
      width: 945,
      height: 2500,
      reusable: true,
    });
    expect(offcutOf({ x0: 10, y0: 10, x1: 2300, y1: 1240 }, size, 5)).toEqual({
      width: 195,
      height: 1250,
      reusable: false,
    });
    expect(offcutOf({ x0: 0, y0: 0, x1: 2500, y1: 1250 }, size, 5)).toBeUndefined();
  });
});

describe('cutting presets', () => {
  it('cuts with an abrasive water jet: about a millimetre of kerf, slower than a laser', () => {
    const jet = cuttingPresets[presetFor('waterjet', 'Mild steel', 6)]!;
    expect(jet).toMatchObject({ material: 'Mild steel', process: 'waterjet', thickness: 6 });
    const laser = cuttingPresets[presetFor('fiber', 'Mild steel', 6)]!;
    expect(jet.speed).toBeLessThan(laser.speed / 4);
    for (const preset of cuttingPresets.filter((item) => item.process === 'waterjet')) {
      expect(preset.kerf).toBeGreaterThanOrEqual(0.8);
      expect(preset.kerf).toBeLessThanOrEqual(1.2);
    }
    // thicker plate: slower, longer pierces, more room between parts
    expect(sheetAllowance('waterjet', 20)).toEqual({ spacing: 8, margin: 15 });
    expect(sheetAllowance('waterjet', 3)).toEqual({ spacing: 3, margin: 10 });
    expect(sheetAllowance('fiber', 3)).toEqual({ spacing: 5, margin: 10 });
    // a material the process has no preset for takes the process's nearest thickness
    expect(cuttingPresets[presetFor('waterjet', 'Plywood', 9)]).toMatchObject({
      process: 'waterjet',
      thickness: 10,
    });
    expect(cuttingPresets.every((preset) => preset.kerf > 0)).toBe(true);
  });

  it('warns when the spacing is narrower than the kerf', () => {
    const part = nestPart(only(nestingParts.Disc()), choice(1));
    const format = { width: 1250, height: 2500, price: 0 };
    const advice = nestingAdvice({
      names: ['Disc'],
      parts: [part],
      formats: [format],
      margin: 10,
      single: [],
      boxes: [packBoxes([{ ...part, turn: true }], format, 10, 0.5)],
      currency: '€',
      spacing: 0.5,
      kerf: 1,
    });
    expect(advice[0]).toEqual({
      tone: 'warning',
      text: 'Spacing 0.5 mm is narrower than the 1 mm kerf: neighbouring cuts would run together. Set it to 2 mm or more.',
    });
  });
});

describe('units', () => {
  it('reads lengths in millimetres or inches, kept in millimetres', () => {
    expect(lengthText(850, 'in')).toBe('33.5 in');
    expect(lengthText(9000, 'in')).toBe('29.5 ft');
    expect(sizeText(300, 200, 'in')).toBe('11.81 × 7.87 in');
    expect(gapText(5, 'in')).toBe('0.197 in');
    expect(speedText(4000, 'in')).toBe('157.5 in/min');
    expect(speedText(4000)).toBe('4,000 mm/min');
    expect(areaText(58_400, 'in')).toBe('90.5 in²');
    expect(areaText(3_125_000, 'in')).toBe('33.64 ft²');
    expect(weightText(10, 'in')).toBe('22 lb');
    expect(fromUnit(48, 'in')).toBe(1219.2);
    expect(inchSheetPresets.map((size) => sheetName(size, 'in'))).toEqual([
      '48 × 96',
      '48 × 120',
      '60 × 120',
      '60 × 144',
    ]);
    expect(sheetName({ width: 1250, height: 2500 }, 'in')).toBe('49.21 × 98.43');
  });

  it('keeps the choice as a Layout preference, millimetres unless it says inches', () => {
    expect(normalizePreferences({ layout: { units: 'in' } }).layout).toEqual({ units: 'in' });
    expect(normalizePreferences({ layout: { units: 'cm' } }).layout).toEqual({ units: 'mm' });
    const { layout: _layout, ...older } = normalizePreferences();
    expect(preferencesSchema.parse(older).layout).toEqual({ units: 'mm' });
  });
});

describe('sheet DXF', () => {
  it('writes R12 that dxf-parser reads back, with arcs exact under turns and mirroring', () => {
    const segment = only(nestingParts['Arc segment']());
    const bracket = only(nestingParts['Bracket with holes']());
    const text = sheetDXF({
      length: 2500,
      width: 1250,
      labels: true,
      pieces: [
        {
          part: segment,
          placement: { part: 0, x: 700, y: 100, rotation: 90, mirror: true },
          number: 1,
        },
        {
          part: bracket,
          placement: { part: 1, x: 1200, y: 400, rotation: 30, mirror: false },
          number: 2,
        },
      ],
    });
    expect(text).toContain('$ACADVER\n1\nAC1009');
    const parsed = new DxfParser().parseSync(text)!;
    expect(Object.keys(parsed.tables.layer.layers).sort()).toEqual([
      'CUT-INNER',
      'CUT-OPEN',
      'CUT-OUTER',
      'LABELS',
      'MARK',
      'SHEET',
    ]);
    const arcs = parsed.entities.filter((entity) => entity.type === 'ARC') as unknown as {
      center: { x: number; y: number };
      radius: number;
      startAngle: number;
      endAngle: number;
    }[];
    // The quarter arcs from 0° to 90° at the origin, mirrored (x → −x) then turned 90°, run from
    // 180° to 270° around the placed origin.
    expect(arcs.map((arc) => Math.round(arc.radius)).sort()).toEqual([200, 300]);
    for (const arc of arcs) {
      expect(arc.center.x).toBeCloseTo(700, 9);
      expect(arc.center.y).toBeCloseTo(100, 9);
      expect((arc.startAngle * 180) / Math.PI).toBeCloseTo(180, 9);
      expect((arc.endAngle * 180) / Math.PI).toBeCloseTo(270, 9);
    }
    const back = readCutDrawing(text);
    const cut = extractParts(
      back,
      { scale: 1, marks: new Set(['MARK', 'LABELS', 'SHEET']), together: false },
      'Sheet',
    );
    expect(cut.parts).toHaveLength(2);
    const areas = cut.parts.map((part) => part.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(segment.area, 9);
    // Coordinates are written to a millionth of a millimetre; the bracket lies at 30°.
    expect(areas[1]).toBeCloseTo(bracket.area, 2);
    const lengths = cut.parts.map((part) => part.cutLength).sort((a, b) => a - b);
    expect(lengths[0]).toBeCloseTo(segment.cutLength, 9);
    expect(lengths[1]).toBeCloseTo(bracket.cutLength, 4);
    expect(
      back.primitives
        .filter((p) => p.kind === 'text')
        .map((p) => p.kind === 'text' && p.value)
        .sort(),
    ).toEqual(['1', '2', 'BRK-1']);
  });
});
