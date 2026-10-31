import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Finding, InventoryItem } from '../src/domain/fabrication/answer';
import type { GradeJob } from '../src/domain/fabrication/grade';
import type { Measurement } from '../src/domain/fabrication/measure';
import {
  answerIssues,
  buildInventory,
  fabricationAnswerSchema,
  modelInventory,
  namedRefs,
} from '../src/domain/fabrication/answer';
import { correctDrawing, correctionFor } from '../src/domain/fabrication/correction';
import { pageText } from '../src/domain/fabrication/prompt';
import { quoteOn, quotePassages } from '../src/domain/fabrication/quotes';
import { checkTour } from '../src/domain/fabrication/tour';
import { boxRegion } from '../src/domain/files/regions';
import { tourDefinitionSchema } from '../src/domain/tours/tour';
import { gradeFinding } from '../src/domain/fabrication/grade';
import {
  holeOf,
  measureDrawing,
  measurementSummary,
  nearestPitches,
  rowPitches,
} from '../src/domain/fabrication/measure';
import { groupByThickness, readJobName } from '../src/domain/fabrication/names';
import { correctedName, dxfCorrectionSchema } from '../src/domain/fabrication/plan';
import {
  transformDescription,
  transformPlanSchema,
  validateTransform,
} from '../src/domain/operations/transforms';
import { parseDrawing } from '../src/domain/previews/drawings/dxf/geometry';
import {
  autocadDXF,
  hole,
  jobParts,
  outline,
  plate,
} from '../tools/playground/samples/fabrication';
import { cad, drawing } from '../tools/playground/samples/nesting';

const version = { identity: '1:2', modified: 1, size: 1 };
const part = (file: string) => jobParts.find((item) => item.file === file)!;
const dxfOf = (file: string) => autocadDXF(part(file).entities);
function measured(source: string): Measurement {
  const outcome = measureDrawing(parseDrawing(source));
  if (outcome.status !== 'measured') throw new Error(outcome.reason);
  return outcome.measurement;
}
const at = (measurement: Measurement, x: number, y: number) =>
  measurement.holes.find((item) => Math.hypot(item.centre.x - x, item.centre.y - y) < 1e-6)!;

describe('job names', () => {
  it('reads thickness, quantity and the part from the convention and its variants', () => {
    const cases: [string, number | undefined, string | undefined, number | undefined][] = [
      ['g6-TP38-EM2-4buc.dxf', 6, 'TP38-EM2', 4],
      ['g6mm_PL60_B2_x4.dxf', 6, 'PL60_B2', 4],
      ['PL60-6mm-4 buc.dxf', 6, 'PL60', 4],
      ['t3-BR12-10pcs.dxf', 3, 'BR12', 10],
      ['g1,5_CV25_E1_3x.dxf', 1.5, 'CV25_E1', 3],
      ['MB20-g6-A1-4buc.dxf', 6, 'MB20-A1', 4],
      ['PL60_4_buc.DXF', undefined, 'PL60', 4],
      ['g6-T6-2buc.dxf', 6, 'T6', 2],
    ];
    for (const [name, thickness, partName, quantity] of cases) {
      const job = readJobName(name);
      expect([job.thickness?.value, job.part, job.quantity?.value], name).toEqual([
        thickness,
        partName,
        quantity,
      ]);
      expect(job.notes, name).toEqual([]);
    }
  });

  it('says which text of the name it read and where', () => {
    const job = readJobName('PL60-B2-6mm-4 buc.dxf');
    expect(job.thickness).toEqual({ value: 6, text: '6mm', at: 8 });
    expect(job.quantity).toEqual({ value: 4, text: '4 buc', at: 12 });
    expect(readJobName('g6-PL60-B2-2buc (corrected).dxf')).toMatchObject({
      part: 'PL60-B2',
      suffix: 'corrected',
      thickness: { value: 6, text: 'g6', at: 0 },
      quantity: { value: 2, text: '2buc' },
    });
  });

  it('leaves a value unread when the name is unsure, and says why', () => {
    const conflict = readJobName('T3-g6-2buc.dxf');
    expect(conflict.thickness).toBeUndefined();
    expect(conflict.quantity?.value).toBe(2);
    expect(conflict.notes).toEqual(['The name gives two thicknesses: “T3” and “g6”.']);
    const zero = readJobName('g0-PL60-0buc.dxf');
    expect([zero.thickness, zero.quantity]).toEqual([undefined, undefined]);
    expect(zero.notes).toEqual([
      '“g0” gives no usable thickness.',
      '“0buc” gives no usable quantity.',
    ]);
    // Bare forms inside the name are part of it, and decimals are not counts.
    expect(readJobName('Bracket x4 T6 holes.dxf')).toEqual({
      name: 'Bracket x4 T6 holes.dxf',
      part: 'Bracket x4 T6 holes',
      notes: [],
    });
    expect(readJobName('PL60-2.5buc.dxf').quantity).toBeUndefined();
    expect(readJobName('g6-4buc.dxf').part).toBeUndefined();
  });

  it('groups files by thickness, thinnest first and unread names last', () => {
    const groups = groupByThickness(
      ['g6-PL60-2buc.dxf', 'Notes.dxf', 'g3-CV25-10buc.dxf', 'MB20-6mm-4pcs.dxf'],
      (name) => name,
    );
    expect(groups.map((group) => [group.key, group.label, group.items])).toEqual([
      ['3', '3 mm', ['g3-CV25-10buc.dxf']],
      ['6', '6 mm', ['g6-PL60-2buc.dxf', 'MB20-6mm-4pcs.dxf']],
      ['unknown', 'Thickness not in name', ['Notes.dxf']],
    ]);
  });
});

describe('measurement', () => {
  it('finds the outline, holes drawn as circles or half arcs, and slots, in millimetres', () => {
    const plateMeasure = measured(dxfOf('g6-PL60-B2-2buc.dxf'));
    expect(plateMeasure.units).toEqual({ code: 4, label: 'Millimetres', millimetres: 1 });
    expect([plateMeasure.width, plateMeasure.height]).toEqual([160, 100]);
    expect(plateMeasure.outlines).toHaveLength(1);
    expect(plateMeasure.outlines[0]!.entities).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(
      plateMeasure.holes.map((item) => [item.number, item.centre, item.diameter, item.entities]),
    ).toEqual([
      [1, { x: 55, y: 75 }, 10.5, ['10']],
      [2, { x: 103, y: 75 }, 10.5, ['11']],
      [3, { x: 80, y: 50 }, 30, ['12', '13']],
      [4, { x: 55, y: 25 }, 10.5, ['8']],
      [5, { x: 103, y: 25 }, 10.5, ['9']],
    ]);
    const bracket = measured(dxfOf('g6-MB20-A1-4buc.dxf'));
    expect(bracket.holes.map((item) => item.diameter)).toEqual([8.5, 8.5]);
    expect(bracket.cutouts).toHaveLength(1);
    expect([bracket.cutouts[0]!.width, bracket.cutouts[0]!.height]).toEqual([30, 10]);
  });

  it('measures pitches along each axis and centre to centre', () => {
    const plateMeasure = measured(dxfOf('g6-PL60-B2-2buc.dxf'));
    const pitches = rowPitches(plateMeasure).map((pitch) => [
      pitch.axis,
      pitch.from,
      pitch.to,
      pitch.value,
    ]);
    expect(pitches).toContainEqual(['x', 4, 5, 48]);
    expect(pitches).toContainEqual(['x', 1, 2, 48]);
    expect(pitches).toContainEqual(['y', 1, 4, 50]);
    const flange = measured(dxfOf('g6-FL80-C1-2buc.dxf'));
    expect(flange.outlines).toHaveLength(1);
    expect(flange.holes).toHaveLength(7);
    // Six bolt holes on a 90 mm circle, written to six decimals: each nearest neighbour is 45 mm
    // away, centre to centre.
    const bolts = nearestPitches(flange).filter((pitch) => pitch.value < 46);
    expect(bolts).toHaveLength(6);
    for (const pitch of bolts) expect(pitch.value).toBeCloseTo(45, 5);
    expect(
      measurementSummary(flange).pitches.some(
        (pitch) => pitch.axis === 'centre' && Math.abs(pitch.value - 45) < 1e-3,
      ),
    ).toBe(true);
  });

  it('converts declared units and refuses a drawing that gives none', () => {
    const inches = drawing(
      [
        cad.outline('CUT', [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ]),
        cad.circle('CUT', 1, 1, 0.25),
        cad.circle('CUT', 3, 1, 0.25),
      ],
      1,
    );
    const measure = measured(inches);
    expect(measure.width).toBeCloseTo(101.6, 9);
    expect(measure.holes.map((item) => item.diameter)).toEqual([12.7, 12.7]);
    expect(rowPitches(measure)[0]!.value).toBeCloseTo(50.8, 9);
    expect(measureDrawing(parseDrawing(drawing([cad.circle('CUT', 1, 1, 1)], null)))).toEqual({
      status: 'refused',
      reason: 'The drawing does not give its units ($INSUNITS), so it is not measured.',
    });
  });

  it('counts an entity drawn twice once, and leaves a polygon out of the holes', () => {
    const source = autocadDXF([
      ...plate(100, 60, 0),
      ...hole([20, 30], 10),
      ...hole([20, 30], 10),
      ...outline(
        Array.from({ length: 6 }, (_, k): [number, number] => [
          70 + 8 * Math.cos((k * Math.PI) / 3),
          30 + 8 * Math.sin((k * Math.PI) / 3),
        ]),
      ),
    ]);
    const measure = measured(source);
    expect(measure.holes.map((item) => item.entities)).toEqual([['4', '5']]);
    expect(measure.cutouts).toHaveLength(1);
    expect(measure.notes).toEqual(['1 entity is drawn twice; each counts once.']);
  });

  it('summarises for the model in millimetres and entity ids, with no paths', () => {
    const summary = measurementSummary(measured(dxfOf('g6-PL60-B2-2buc.dxf')));
    expect(summary.units).toBe('mm');
    expect(summary.size).toEqual({ width: 160, height: 100 });
    expect(summary.holes[0]).toEqual({
      number: 1,
      entities: ['10'],
      centre: [55, 75],
      diameter: 10.5,
      outline: 1,
    });
    expect(summary.pitches).toContainEqual({
      axis: 'x',
      value: 48,
      holes: [4, 5],
      entities: ['8', '9'],
    });
    expect(JSON.stringify(summary)).not.toMatch(/\//);
  });
});

const inventory: InventoryItem[] = [
  { ref: 'S1', kind: 'request', name: 'Job 1042 request.eml', pages: 1 },
  { ref: 'S2', kind: 'drawing', name: 'Job 1042 drawing.pdf', pages: 1 },
  { ref: 'S3', kind: 'photo', name: 'Plate.jpg' },
  { ref: 'S4', kind: 'dxf', name: 'g6-PL60-B2-2buc.dxf' },
];
const plateName = 'g6-PL60-B2-2buc.dxf';
const plateSource = dxfOf(plateName);
const plateMeasure = measured(plateSource);
const job: GradeJob = {
  inventory,
  dxf: (ref) =>
    ref === 'S4'
      ? {
          name: 'g6-PL60-B2-2buc.dxf',
          outcome: { status: 'measured', measurement: plateMeasure },
        }
      : undefined,
  text: (ref) => (ref === 'S2' ? 'Holes 4× Ø10.5 at 50 mm pitch, centre hole Ø30.' : undefined),
};
const pitchFinding = (patch: Partial<Finding> = {}): Finding => ({
  id: 'F1',
  kind: 'pitch',
  summary: 'The DXF puts the bottom holes 48 mm apart; the drawing gives 50 mm.',
  drawing: {
    ref: 'S2',
    page: 1,
    value: 50,
    quote: '50 mm pitch',
    box: [0.4, 0.2, 0.6, 0.3],
    feature: null,
  },
  dxf: { ref: 'S4', value: 48, axis: 'x', entities: ['8', '9'] },
  photo: null,
  proposal: { target: 50, move: ['9', '11'] },
  ...patch,
});

describe('grading', () => {
  it('confirms a mismatch Viewer measures, with the values and the entities', () => {
    expect(gradeFinding(pitchFinding(), job)).toEqual({
      finding: 'F1',
      status: 'confirmed',
      measured: 48,
      entities: ['8', '9'],
      reason: 'Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
      tolerance: 0.05,
    });
  });

  it('refutes a finding whose DXF value or mismatch Viewer does not measure', () => {
    expect(
      gradeFinding(
        pitchFinding({ dxf: { ref: 'S4', value: 47, axis: 'x', entities: ['8', '9'] } }),
        job,
      ),
    ).toMatchObject({
      status: 'refuted',
      reason:
        'Viewer measured 48.00 mm between holes 4 and 5 along x, not the 47 mm the finding gives.',
    });
    const vertical = pitchFinding({
      drawing: { ref: 'S2', page: 1, value: 50, quote: null, box: null, feature: null },
      dxf: { ref: 'S4', value: 48, axis: null, entities: ['10', '8'] },
    });
    expect(gradeFinding(vertical, job)).toMatchObject({
      status: 'refuted',
      measured: 50,
      reason:
        'Viewer measured 50.00 mm between holes 1 and 4 along y, as the drawing gives: there is no mismatch.',
    });
  });

  it('leaves photo-only claims, unmeasurable entities and missing quotes unverified', () => {
    const photo = pitchFinding({
      dxf: null,
      photo: { ref: 'S3', box: null, feature: null },
      proposal: null,
    });
    expect(gradeFinding(photo, job)).toMatchObject({
      status: 'unverified',
      reason: 'Only a photo shows this; Viewer measures DXF drawings.',
    });
    expect(
      gradeFinding(
        pitchFinding({ dxf: { ref: 'S4', value: 48, axis: 'x', entities: ['8', '0'] } }),
        job,
      ),
    ).toMatchObject({
      status: 'unverified',
      reason: 'Entity 0 is not a hole in g6-PL60-B2-2buc.dxf.',
    });
    expect(
      gradeFinding(
        pitchFinding({
          drawing: {
            ref: 'S2',
            page: 1,
            value: 50,
            quote: '52 mm pitch',
            box: null,
            feature: null,
          },
        }),
        job,
      ),
    ).toMatchObject({
      status: 'unverified',
      reason:
        '“52 mm pitch” is not on page 1 of Job 1042 drawing.pdf, so the drawing value is unconfirmed.',
    });
    expect(
      gradeFinding(pitchFinding({ dxf: { ref: 'S9', value: 48, axis: 'x', entities: [] } }), job),
    ).toMatchObject({ status: 'unverified', reason: 'S9 is not a DXF part in this job.' });
    const refused: GradeJob = {
      ...job,
      dxf: () => ({ name: 'x.dxf', outcome: { status: 'refused', reason: 'No units.' } }),
    };
    expect(gradeFinding(pitchFinding(), refused)).toMatchObject({
      status: 'unverified',
      reason: 'No units.',
    });
    expect(gradeFinding(pitchFinding({ kind: 'material' }), job).status).toBe('unverified');
  });

  it('checks diameters, sizes and counts, and quantities against the name', () => {
    const diameter = pitchFinding({
      kind: 'diameter',
      drawing: { ref: 'S2', page: 1, value: 11, quote: null, box: null, feature: null },
      dxf: { ref: 'S4', value: 10.5, axis: null, entities: ['8'] },
    });
    expect(gradeFinding(diameter, job)).toMatchObject({ status: 'confirmed', measured: 10.5 });
    const width = pitchFinding({
      kind: 'size',
      drawing: { ref: 'S2', page: 1, value: 160, quote: null, box: null, feature: null },
      dxf: { ref: 'S4', value: 160, axis: 'x', entities: [] },
    });
    expect(gradeFinding(width, job)).toMatchObject({ status: 'refuted', measured: 160 });
    const count = pitchFinding({
      kind: 'holes',
      drawing: { ref: 'S2', page: 1, value: 6, quote: null, box: null, feature: null },
      dxf: { ref: 'S4', value: 5, axis: null, entities: [] },
    });
    expect(gradeFinding(count, job)).toMatchObject({
      status: 'confirmed',
      reason: 'Viewer counted 5 holes in outline 1; the drawing gives 6 holes.',
      tolerance: 0,
    });
    const quantity = pitchFinding({
      kind: 'quantity',
      drawing: { ref: 'S1', page: 1, value: 4, quote: null, box: null, feature: null },
      dxf: { ref: 'S4', value: 2, axis: null, entities: [] },
    });
    expect(gradeFinding(quantity, job)).toMatchObject({
      status: 'confirmed',
      measured: 2,
      reason: 'The name g6-PL60-B2-2buc.dxf gives 2 pieces (“2buc”); the request gives 4 pieces.',
    });
  });
});

describe('answer schema', () => {
  const answer = {
    summary: 'One pitch differs.',
    request: [
      {
        ref: 'S1',
        part: 'PL60-B2 base plate',
        dxf: 'S4',
        quantity: 2,
        thickness: 6,
        material: 'S235JR',
        quote: 'PL60-B2 base plate, 6 mm, 2 pieces',
        drawing: null,
      },
    ],
    findings: [pitchFinding()],
    tour: [
      {
        ref: 'S2',
        caption: 'The drawing gives 50 mm.',
        note: null,
        finding: 'F1',
        page: 1,
        box: [0.4, 0.2, 0.6, 0.3],
        entities: [],
      },
      {
        ref: 'S4',
        caption: 'The DXF has 48 mm.',
        note: null,
        finding: 'F1',
        page: null,
        box: null,
        entities: ['8', '9'],
      },
    ],
  };

  it('accepts refs and entity ids only, and every field strictly', () => {
    expect(fabricationAnswerSchema.parse(answer)).toEqual(answer);
    expect(answerIssues(fabricationAnswerSchema.parse(answer), inventory)).toEqual([]);
    const pathRef = structuredClone(answer);
    pathRef.tour[0]!.ref = '/Users/someone/Job/Drawing.pdf';
    expect(() => fabricationAnswerSchema.parse(pathRef)).toThrow();
    const extra = { ...answer, path: 'x' };
    expect(() => fabricationAnswerSchema.parse(extra)).toThrow();
    const named = structuredClone(answer);
    named.findings[0]!.dxf!.entities = ['hole 4'];
    expect(() => fabricationAnswerSchema.parse(named)).toThrow();
    expect(z.toJSONSchema(fabricationAnswerSchema)).toMatchObject({ type: 'object' });
  });

  it('names refs, pages, boxes and findings the schema cannot check', () => {
    const wrong = structuredClone(answer);
    wrong.findings[0]!.dxf!.ref = 'S2';
    wrong.findings[0]!.drawing!.page = 3;
    wrong.tour[0]!.box = [0.6, 0.2, 0.4, 0.3];
    wrong.tour[1]!.finding = 'F7';
    wrong.request[0]!.dxf = 'S9';
    expect(answerIssues(fabricationAnswerSchema.parse(wrong), inventory)).toEqual([
      'Request part 1 names S9, which is not in the inventory.',
      'F1 names page 3 of S2, which has 1.',
      'F1 names S2, a drawing, where it needs a dxf.',
      'Tour stop 1 has a box whose sides are the wrong way round.',
      'Tour stop 2 names F7, which is not a finding.',
    ]);
  });

  it('writes the job’s refs in the model’s prose as the files’ names', () => {
    const sources = [
      { ref: 'S2', name: 'Job 1042 drawing.pdf' },
      { ref: 'S7', name: 'g6-PL60-B2-2buc.dxf' },
    ];
    // the name takes the kind's noun before the ref, which it already says
    expect(namedRefs('Pitch 50 mm on drawing S2 versus 48 mm in the DXF S7.', sources)).toBe(
      'Pitch 50 mm on Job 1042 drawing.pdf versus 48 mm in g6-PL60-B2-2buc.dxf.',
    );
    expect(namedRefs('Drawing S2 gives 50 mm; drawing S9 is not in the job.', sources)).toBe(
      'Job 1042 drawing.pdf gives 50 mm; drawing S9 is not in the job.',
    );
    // only a whole ref the job has: not S20, S9, a number's start or a word holding one
    expect(namedRefs('S20, S9, S2.5 mm, S2’s outline, AS2, (S7)', sources)).toBe(
      'S20, S9, S2.5 mm, Job 1042 drawing.pdf’s outline, AS2, (g6-PL60-B2-2buc.dxf)',
    );
    // a tour's captions name them so too
    const parsed = fabricationAnswerSchema.parse({
      ...answer,
      tour: [{ ...answer.tour[1]!, caption: 'S4 puts them 48 mm apart; S2 gives 50 mm.' }],
    });
    const { stops } = checkTour({
      answer: parsed,
      sources: buildInventory([
        { path: '/jobs/1042/Job 1042 request.eml', kind: 'request', version },
        { path: '/jobs/1042/Job 1042 drawing.pdf', kind: 'drawing', version, pages: 1 },
        { path: '/jobs/1042/Plate.jpg', kind: 'photo', version },
        { path: '/jobs/1042/g6-PL60-B2-2buc.dxf', kind: 'dxf', version },
      ]),
      grades: [gradeFinding(parsed.findings[0]!, job)],
      folder: '/jobs/1042',
      measurement: (ref) => (ref === 'S4' ? plateMeasure : undefined),
    });
    expect(stops[0]!.caption).toBe(
      'g6-PL60-B2-2buc.dxf puts them 48 mm apart; Job 1042 drawing.pdf gives 50 mm.',
    );
  });

  it('turns its tour into stops a tour plays, with grades and the pitch Viewer measured', () => {
    const sources = buildInventory([
      { path: '/jobs/1042/Job 1042 request.eml', kind: 'request', version },
      { path: '/jobs/1042/Job 1042 drawing.pdf', kind: 'drawing', version, pages: 1 },
      { path: '/jobs/1042/Plate.jpg', kind: 'photo', version },
      { path: '/jobs/1042/g6-PL60-B2-2buc.dxf', kind: 'dxf', version },
    ]);
    const parsed = fabricationAnswerSchema.parse(answer);
    const grades = [gradeFinding(parsed.findings[0]!, job)];
    const { stops, skipped } = checkTour({
      answer: parsed,
      sources,
      grades,
      folder: '/jobs/1042',
      measurement: (ref) => (ref === 'S4' ? plateMeasure : undefined),
    });
    expect(skipped).toEqual([]);
    expect(tourDefinitionSchema.parse({ version: 1, name: 'Job 1042', stops }).stops).toEqual(
      stops,
    );
    // without the page's text runs, the quote is marked by the box the model gave
    expect(stops[0]).toEqual({
      id: 'stop-1',
      caption: 'The drawing gives 50 mm.',
      note: grades[0]!.reason,
      source: 'model',
      finding: { id: 'F1', grade: 'confirmed' },
      target: {
        kind: 'file',
        path: 'Job 1042 drawing.pdf',
        version,
        anchor: {
          kind: 'pdf',
          page: 1,
          marks: [
            {
              kind: 'text',
              region: boxRegion({ x: 0.4, y: 0.2, width: 0.6 - 0.4, height: 0.3 - 0.2 }),
            },
          ],
          search: false,
        },
        quote: '50 mm pitch',
      },
    });
    expect(stops[1]!.target).toEqual({
      kind: 'file',
      path: 'g6-PL60-B2-2buc.dxf',
      version,
      anchor: {
        kind: 'dxf',
        entities: ['8', '9'],
        view: { min: [39.75, 9.75], max: [118.25, 40.25] },
        measure: [
          {
            tool: 'distance',
            points: [
              [55, 25],
              [103, 25],
            ],
          },
        ],
      },
    });
    // the hashes the check read go with the stops, so a tour knows each file by its bytes
    const hashed = checkTour({
      answer: parsed,
      sources,
      grades,
      folder: '/jobs/1042',
      measurement: (ref) => (ref === 'S4' ? plateMeasure : undefined),
      sha256: (ref) => ref.replace(/\D/g, '').padStart(64, 'a'),
    });
    expect(hashed.stops.map((stop) => stop.target.kind === 'file' && stop.target.version)).toEqual(
      stops.map((stop) => {
        const ref = sources.find(
          (source) => stop.target.kind === 'file' && source.path.endsWith(stop.target.path),
        )!.ref;
        return { ...version, sha256: ref.replace(/\D/g, '').padStart(64, 'a') };
      }),
    );
    expect(
      tourDefinitionSchema.safeParse({ version: 1, name: 'Job', stops: hashed.stops }).success,
    ).toBe(true);
    const outside = checkTour({
      answer: parsed,
      sources,
      grades,
      folder: '/jobs/other',
      measurement: () => plateMeasure,
    });
    expect(outside.stops).toEqual([]);
    expect(outside.skipped[0]).toBe(
      'Stop 1 shows Job 1042 drawing.pdf, which is outside the tour’s folder.',
    );
  });

  it('marks a quote by its own runs and outlines the feature it is about', () => {
    const sources = buildInventory([
      { path: '/jobs/1042/Job 1042 drawing.pdf', kind: 'drawing', version, pages: 1 },
      { path: '/jobs/1042/g6-PL60-B2-2buc.dxf', kind: 'dxf', version },
    ]);
    const runs = [
      { text: 'Holes 4× Ø10.5 at 50 mm pitch', box: [0.1, 0.9, 0.5, 0.92] as const },
      { text: '50', box: [0.42, 0.21, 0.45, 0.24] as const },
    ].map((run) => ({ ...run, box: [...run.box] as [number, number, number, number] }));
    const parsed = fabricationAnswerSchema.parse({
      ...answer,
      findings: [
        pitchFinding({
          drawing: {
            ref: 'S1',
            page: 1,
            value: 50,
            quote: '50',
            box: [0.4, 0.2, 0.6, 0.3],
            feature: [0.5, 0.5, 0.56, 0.58],
          },
          dxf: { ref: 'S2', value: 48, axis: 'x', entities: ['8', '9'] },
        }),
      ],
      tour: [{ ...answer.tour[0], ref: 'S1' }],
    });
    const { stops, marks } = checkTour({
      answer: parsed,
      sources,
      grades: [],
      folder: '/jobs/1042',
      measurement: () => undefined,
      runs: () => runs,
    });
    const feature = boxRegion({ x: 0.5, y: 0.5, width: 0.56 - 0.5, height: 0.58 - 0.5 });
    // the dimension's "50", nearest the model's box, not the note's
    const text = boxRegion({ x: 0.42, y: 0.21, width: 0.45 - 0.42, height: 0.24 - 0.21 });
    expect(stops[0]!.target).toMatchObject({
      anchor: { kind: 'pdf', page: 1, region: feature, marks: [{ kind: 'text', region: text }] },
    });
    expect(marks.map((mark) => [mark.kind, mark.at, mark.source, mark.finding])).toEqual([
      ['feature', 'region', 'model-box', 'F1'],
      ['text', 0, 'page-text', 'F1'],
    ]);
  });

  it('gives each file an opaque ref and keeps paths out of what the model reads', () => {
    const sources = buildInventory([
      { path: '/jobs/1042/g6-PL60-B2-2buc.dxf', kind: 'dxf', version },
      { path: '/jobs/1042/Job 1042 drawing.pdf', kind: 'drawing', version, pages: 1 },
      { path: '/jobs/1042/Job 1042 request.eml', kind: 'request', version },
    ]);
    expect(sources.map((source) => [source.ref, source.kind, source.path])).toEqual([
      ['S1', 'request', '/jobs/1042/Job 1042 request.eml'],
      ['S2', 'drawing', '/jobs/1042/Job 1042 drawing.pdf'],
      ['S3', 'dxf', '/jobs/1042/g6-PL60-B2-2buc.dxf'],
    ]);
    expect(JSON.stringify(modelInventory(sources))).not.toContain('/jobs');
  });
});

describe('DXF correction', () => {
  const plan = dxfCorrectionSchema.parse({
    kind: 'dxf-correction',
    format: 'dxf',
    from: '8',
    to: '9',
    axis: 'x',
    target: 50,
    measured: 48,
    move: ['11'],
  });

  it('is a transform plan for one drawing, described for review', () => {
    expect(transformPlanSchema.parse(plan)).toEqual(plan);
    expect(validateTransform(plan, 1)).toEqual(plan);
    expect(() => validateTransform(plan, 2)).toThrow('Correct one drawing at a time.');
    expect(transformDescription(plan)).toBe(
      'DXF correction · pitch along x from 48.00 mm to 50.00 mm · moves 2 holes · a new DXF beside the original, which is kept',
    );
    expect(correctedName('g6-PL60-B2-2buc.dxf')).toBe('g6-PL60-B2-2buc (corrected).dxf');
  });

  it('moves the named holes and measures the copy again at the target', () => {
    const before = plateSource;
    const { text, report } = correctDrawing(plateSource, plan, plateName);
    expect(plateSource).toBe(before);
    expect(report).toMatchObject({ axis: 'x', target: 50, before: 48, after: 50 });
    expect(report.shift).toEqual({ x: 2, y: 0 });
    expect(report.moved.map((item) => [item.number, item.from, item.to])).toEqual([
      [5, { x: 103, y: 25 }, { x: 105, y: 25 }],
      [2, { x: 103, y: 75 }, { x: 105, y: 75 }],
    ]);
    const copy = measured(text);
    expect(copy.units.code).toBe(4);
    expect([copy.width, copy.height]).toEqual([160, 100]);
    expect(at(copy, 105, 25).entities).toEqual(report.moved[0]!.corrected);
    expect(at(copy, 105, 75).diameter).toBe(10.5);
    expect(at(copy, 55, 25).diameter).toBe(10.5);
    expect(at(copy, 80, 50).diameter).toBe(30);
    expect(
      rowPitches(copy)
        .filter((pitch) => pitch.axis === 'x')
        .map((pitch) => pitch.value),
    ).toEqual([50, 50]);
    expect(parseDrawing(text).layers.map((layer) => layer.name)).toEqual(['Visible']);
  });

  it('refuses a drawing that changed, a hole that would cut the edge, and one that stays and moves', () => {
    expect(() => correctDrawing(plateSource, { ...plan, measured: 47 }, plateName)).toThrow(
      'g6-PL60-B2-2buc.dxf changed since it was checked: the pitch is now 48.00 mm, not 47.00 mm. Check it again.',
    );
    expect(() => correctDrawing(plateSource, { ...plan, target: 104 }, plateName)).toThrow(
      'Moving hole 5 by 56.00 mm would cut into the part. Choose other holes to move.',
    );
    expect(() => correctDrawing(plateSource, { ...plan, move: ['8'] }, plateName)).toThrow(
      'Hole 4 cannot both stay and move.',
    );
    expect(() => correctDrawing(plateSource, { ...plan, to: '0' }, plateName)).toThrow(
      'Entity 0 is not a hole in g6-PL60-B2-2buc.dxf.',
    );
  });

  it('builds the reviewed plan from a confirmed finding and its proposal', () => {
    const finding = pitchFinding();
    const grade = gradeFinding(finding, job);
    expect(correctionFor(finding, grade, plateMeasure)).toEqual(plan);
    expect(correctionFor(finding, { ...grade, status: 'refuted' }, plateMeasure)).toBeUndefined();
    expect(holeOf(plateMeasure, '13')?.number).toBe(3);
  });
});

describe('quotes', () => {
  // Job 2107's drawing as pdf.js reads it: a parts list's cells, then its title block's lines.
  const runs = [
    ['HP50-A3', 0.71, 0.16],
    ['Hinge plate', 0.78, 0.16],
    ['6 mm', 0.89, 0.16],
    ['2', 0.95, 0.16],
    ['SP20-B3', 0.71, 0.19],
    ['Spacer', 0.78, 0.19],
    ['6 mm', 0.89, 0.19],
    ['4', 0.95, 0.19],
    ['JOB 2107 · HINGE PLATE HP50-A3', 0.71, 0.7],
    ['Material: S235JR steel, 6 mm', 0.71, 0.75],
    ['Quantity: 2 pieces', 0.71, 0.78],
  ].map(([text, left, top]) => ({
    text: text as string,
    box: [left, top, (left as number) + 0.05, (top as number) + 0.02] as [
      number,
      number,
      number,
      number,
    ],
  }));
  const page = pageText(runs);
  const request =
    'Job 2103, in S355 steel:\n\n- FL30-C2 flange plate, 5 mm, 2 pieces\n- CL10-D1 clip, 3 mm, 6 pieces';

  it('gives a page its printed lines: a table row’s cells on one', () => {
    expect(page.split('\n')).toEqual([
      'HP50-A3 Hinge plate 6 mm 2',
      'SP20-B3 Spacer 6 mm 4',
      'JOB 2107 · HINGE PLATE HP50-A3',
      'Material: S235JR steel, 6 mm',
      'Quantity: 2 pieces',
    ]);
  });

  it('takes one passage, passages on lines of their own, or whole lines, in order', () => {
    expect(quoteOn(page, 'hinge  plate 6mm 2')).toBe(true);
    // a request's lines with the line between them left out
    expect(quoteOn(request, 'Job 2103, in S355 steel:\n\n- CL10-D1 clip, 3 mm, 6 pieces')).toBe(
      true,
    );
    // a parts list's row and a title block's lines, joined without line breaks
    const joined = 'HP50-A3 Hinge plate 6 mm 2 Material: S235JR steel, 6 mm Quantity: 2 pieces';
    expect(quoteOn(page, joined)).toBe(true);
    expect(quotePassages(runs, joined)!.map((passage) => passage.map((run) => run.text))).toEqual([
      ['HP50-A3', 'Hinge plate', '6 mm', '2'],
      ['Material: S235JR steel, 6 mm', 'Quantity: 2 pieces'],
    ]);
  });

  it('reads the multiplication sign as x, as a quote types it', () => {
    // the live J2 answer quoted the drawing's "3× Ø8.5" as "3x Ø8.5"
    expect(quoteOn('Holes 3× Ø8.5 at 40 mm pitch.', '3x Ø8.5')).toBe(true);
    expect(quoteOn('Holes 3x Ø8.5 at 40 mm pitch.', '3× Ø8.5')).toBe(true);
    expect(quoteOn('Holes 3× Ø8.5 at 40 mm pitch.', '3x Ø8')).toBe(false);
  });

  it('never takes text the page does not have, pieces cut from lines, or a cut number', () => {
    // every segment must be there, in order
    expect(quoteOn(request, 'Job 2103, in S355 steel:\n- CL10-D1 clip, 3 mm, 8 pieces')).toBe(
      false,
    );
    expect(quoteOn(request, '- CL10-D1 clip, 3 mm, 6 pieces\nJob 2103, in S355 steel:')).toBe(
      false,
    );
    // one row's code with another row's count
    expect(quoteOn(page, 'HP50-A3 Hinge plate 6 mm 4')).toBe(false);
    expect(quoteOn(page, 'Quantity: 2 pieces HP50-A3 Hinge plate 6 mm 2')).toBe(false);
    expect(quoteOn('Quantity: 12 pieces', '2 pieces')).toBe(false);
    expect(quoteOn('Ø8.55 holes', 'Ø8.5')).toBe(false);
    expect(quoteOn('4× Ø9 at 60 mm', 'Ø9')).toBe(true);
    expect(quoteOn(page, '')).toBe(false);
  });
});
