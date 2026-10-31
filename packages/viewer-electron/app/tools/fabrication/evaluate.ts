/**
 * The fabrication evaluation over the generated evaluation set (tools/playground/samples/
 * fabrication.ts): names read, drawings measured, findings graded and corrections made, then a
 * nesting per thickness with the quantities the names give. It prints the accuracy and writes
 * nothing.
 *
 *   node --import tsx tools/fabrication/evaluate.ts [--budget <milliseconds per thickness>]
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Finding, InventoryItem, InventorySource } from '../../src/domain/fabrication/answer';
import type { FindingGrade } from '../../src/domain/tours/tour';
import type { Hole, MeasureOutcome, Measurement } from '../../src/domain/fabrication/measure';
import type { EvaluationPart } from '../playground/samples/fabrication';
import { correctDrawing, correctionFor } from '../../src/domain/fabrication/correction';
import { gradeFinding } from '../../src/domain/fabrication/grade';
import { measureDrawing, measureTolerances } from '../../src/domain/fabrication/measure';
import { groupByThickness, readJobName } from '../../src/domain/fabrication/names';
import { readCutDrawing } from '../../src/domain/layout/nesting/drawing';
import { countText } from '../../src/domain/layout/nesting/format';
import { extractParts } from '../../src/domain/layout/nesting/parts';
import { nestingDefaults } from '../../src/domain/layout/nesting/plan';
import { nestProblem } from '../../src/domain/layout/nesting/problem';
import { nestSearch } from '../../src/domain/layout/nesting/search';
import type { NestUpdate } from '../../src/domain/layout/nesting/search';
import { parseDrawing } from '../../src/domain/previews/drawings/dxf/geometry';
import { evaluationParts } from '../playground/samples/fabrication';

export interface Tally {
  correct: number;
  total: number;
}
export interface ThicknessNesting {
  label: string;
  parts: number;
  pieces: number;
  placed: number;
  sheets: number;
}
export interface EvaluationReport {
  parts: number;
  mismatches: number;
  parsed: number;
  outlined: number;
  holes: Tally;
  thickness: Tally & { unread: number };
  quantity: Tally & { unread: number };
  pitch: Tally;
  grades: Tally & Record<FindingGrade, number>;
  corrections: Tally;
  nesting: ThicknessNesting[];
  lines: string[];
}

const inventory: InventoryItem[] = [
  { ref: 'S1', kind: 'request', name: 'Generated requirement.txt', pages: 1 },
  { ref: 'S2', kind: 'dxf', name: '' },
  { ref: 'S3', kind: 'photo', name: 'Photo.jpg' },
];
const at = (measurement: Measurement, [x, y]: [number, number]): Hole | undefined =>
  measurement.holes.find(
    (hole) => Math.hypot(hole.centre.x - x, hole.centre.y - y) <= measureTolerances.same,
  );
const percent = (tally: Tally) =>
  tally.total ? `${Math.round((tally.correct / tally.total) * 1000) / 10}%` : 'none';
const finding = (overrides: Partial<Finding>): Finding => ({
  id: 'F1',
  kind: 'pitch',
  summary: 'The hole pitch differs from the drawing.',
  drawing: null,
  dxf: null,
  photo: null,
  proposal: null,
  ...overrides,
});

export function evaluateFabrication(
  options: { budget?: number; parts?: EvaluationPart[] } = {},
): EvaluationReport {
  const parts = options.parts ?? evaluationParts();
  const report: EvaluationReport = {
    parts: parts.length,
    mismatches: parts.filter((part) => part.truth.mismatch).length,
    parsed: 0,
    outlined: 0,
    holes: { correct: 0, total: 0 },
    thickness: { correct: 0, total: 0, unread: 0 },
    quantity: { correct: 0, total: 0, unread: 0 },
    pitch: { correct: 0, total: 0 },
    grades: { correct: 0, total: 0, confirmed: 0, refuted: 0, unverified: 0 },
    corrections: { correct: 0, total: 0 },
    nesting: [],
    lines: [],
  };
  for (const { truth, dxf, requirement } of parts) {
    const name = readJobName(truth.name);
    for (const kind of ['thickness', 'quantity'] as const) {
      const tally = report[kind];
      tally.total++;
      if (name[kind]?.value === truth[kind]) tally.correct++;
      if (truth[kind] === undefined) tally.unread++;
    }
    report.holes.total += truth.holes;
    report.pitch.total++;
    let outcome: MeasureOutcome;
    try {
      outcome = measureDrawing(parseDrawing(dxf));
      report.parsed++;
    } catch {
      continue;
    }
    if (outcome.status === 'refused') continue;
    const measurement = outcome.measurement;
    if (measurement.outlines.length === truth.outlines) report.outlined++;
    if (measurement.holes.length === truth.holes) report.holes.correct += truth.holes;
    const from = at(measurement, truth.pitch.from),
      to = at(measurement, truth.pitch.to);
    if (!from || !to) continue;
    const measured = Math.abs(
      truth.pitch.axis === 'x' ? to.centre.x - from.centre.x : to.centre.y - from.centre.y,
    );
    if (Math.abs(measured - truth.pitch.drawn) <= 1e-6) report.pitch.correct++;

    // What a model might answer: the true finding, an invented DXF value, a photo, a wrong entity.
    // These are deterministic in-memory fixtures, not evidence captured from a live file.
    // The source text is independent of the model claim and can be changed or absent in a trial.
    const source: InventorySource = {
      ...inventory[0]!,
      path: `fixture:${truth.part}/requirements.txt`,
      version: {
        identity: 'generated:' + createHash('sha256').update(requirement.text).digest('hex'),
        size: Buffer.byteLength(requirement.text),
        modified: 0,
      },
    };
    const job = {
      inventory,
      sources: [source],
      text: (ref: string, page: number) =>
        ref === source.ref && page === 1 ? requirement.text : undefined,
      dxf: () => ({ name: truth.name, outcome }),
    };
    const entities = [...from.entities, ...to.entities];
    const drawing = {
      ref: 'S1',
      page: 1,
      value: truth.pitch.specified,
      quote: requirement.quote,
      box: null,
      feature: null,
    };
    const along = truth.pitch.axis;
    const moving = measurement.holes.filter(
      (hole) => Math.abs(hole.centre[along] - to.centre[along]) <= measureTolerances.aligned,
    );
    const honest = finding({
      drawing,
      dxf: { ref: 'S2', value: truth.pitch.drawn, axis: along, entities },
      proposal: {
        target: truth.pitch.specified,
        move: moving.map((hole) => hole.entities[0]!),
      },
    });
    const trials: [Finding, FindingGrade][] = [
      [honest, truth.mismatch ? 'confirmed' : 'refuted'],
      [
        finding({
          drawing,
          dxf: { ref: 'S2', value: truth.pitch.drawn + 0.5, axis: along, entities },
        }),
        'refuted',
      ],
      [finding({ drawing, photo: { ref: 'S3', box: null, feature: null } }), 'unverified'],
      [
        finding({
          drawing,
          dxf: {
            ref: 'S2',
            value: truth.pitch.drawn,
            axis: along,
            entities: [from.entities[0]!, measurement.outlines[0]!.entities[0]!],
          },
        }),
        'unverified',
      ],
    ];
    for (const [trial, expected] of trials) {
      const grade = gradeFinding(trial, job);
      report.grades.total++;
      report.grades[grade.status]++;
      if (grade.status === expected) report.grades.correct++;
      if (trial !== honest || grade.status !== 'confirmed') continue;
      report.corrections.total++;
      const plan = correctionFor(trial, grade, measurement);
      try {
        const corrected = plan && correctDrawing(dxf, plan, truth.name);
        if (corrected && Math.abs(corrected.report.after - truth.pitch.specified) <= 1e-5)
          report.corrections.correct++;
      } catch {
        // A refused correction counts as incorrect.
      }
    }
  }

  const budget = options.budget ?? 150;
  for (const group of groupByThickness(parts, (part) => part.truth.name)) {
    const demands = group.items.flatMap(({ truth, dxf }) => {
      const file = extractParts(
        readCutDrawing(dxf),
        { scale: 1, marks: new Set(), together: false },
        truth.part,
      );
      const quantity = readJobName(truth.name).quantity?.value ?? 1;
      return file.parts.map((part) => ({
        part,
        choice: {
          quantity: quantity * part.copies,
          rotation: 'quarter' as const,
          mirror: false,
          grain: false,
        },
      }));
    });
    const problem = nestProblem(demands, [{ ...nestingDefaults.sheet, price: 0 }], {
      margin: nestingDefaults.margin,
      spacing: nestingDefaults.spacing,
    });
    let last: NestUpdate | undefined;
    for (const update of nestSearch(problem, { budget, now: () => performance.now() }))
      last = update;
    report.nesting.push({
      label: group.label,
      parts: group.items.length,
      pieces: demands.reduce((sum, demand) => sum + demand.choice.quantity, 0),
      placed: last?.best?.placed ?? 0,
      sheets: last?.best?.sheets ?? 0,
    });
  }

  const names: Tally = {
    correct: report.thickness.correct + report.quantity.correct,
    total: report.thickness.total + report.quantity.total,
  };
  const measurement: Tally = {
    correct: report.holes.correct + report.pitch.correct,
    total: report.holes.total + report.pitch.total,
  };
  report.lines = [
    `${countText(report.parts, 'generated part')} in the naming convention, ${report.mismatches} with a pitch drawn off.`,
    `Read: ${report.parsed} of ${report.parts} DXFs parsed, ${report.outlined} with their closed outline, ${report.holes.correct} of ${report.holes.total} holes measured.`,
    ...(['thickness', 'quantity'] as const).map(
      (kind) =>
        `${kind === 'thickness' ? 'Thickness' : 'Quantity'} from names: ${report[kind].correct} of ${report[kind].total} as expected; ${report[kind].unread} names give none or two, and were left unread.`,
    ),
    `Pitch: ${report.pitch.correct} of ${report.pitch.total} measured exactly.`,
    `Grades: ${report.grades.correct} of ${report.grades.total} as expected: ${report.grades.confirmed} confirmed, ${report.grades.refuted} refuted, ${report.grades.unverified} unverified.`,
    `Corrections: ${report.corrections.correct} of ${report.corrections.total} measured again at the drawing's pitch.`,
    `Nesting by thickness: ${report.nesting
      .map(
        (group) =>
          `${group.label}, ${countText(group.parts, 'part')}, ${group.placed} of ${countText(group.pieces, 'piece')} on ${countText(group.sheets, 'sheet')}`,
      )
      .join('; ')}.`,
    `Accuracy: names ${percent(names)}, measurement ${percent(measurement)}, grading ${percent(report.grades)}, corrections ${percent(report.corrections)}.`,
  ];
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--budget');
  const budget = index > 0 ? Number(process.argv[index + 1]) : undefined;
  if (budget !== undefined && !(budget > 0)) throw new Error('--budget takes milliseconds.');
  for (const line of evaluateFabrication({ budget }).lines) console.log(line);
}
