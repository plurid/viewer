/**
 * ANSWERS MUSE SPARK GAVE, CHECKED AGAIN: two answers of the live evaluation, run through Viewer's
 * check service on the generated jobs they answered. In J1's quick run one misplaced hole gave
 * two findings, a 60 mm pitch that reads 58 and a 28 mm one that reads 30: they become one finding
 * with one correction and one stop for both. In J2's first run the answer read Bracket B2 from the
 * request with every field empty and left Spacer S4 out: Viewer says so, part by part. Each answer
 * is as it came, with the `feature` boxes the schema now asks for set to null.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FabricationAnswer } from '../src/domain/fabrication/answer';
import type { CheckProgress, CheckRecord, CheckResult } from '../src/domain/fabrication/check';
import { FabricationChecks } from '../src/desktop/fabrication/service';
import { samSegmenter } from '../src/desktop/models/segmentation';
import { correctDrawing } from '../src/domain/fabrication/correction';
import { defaultSettings } from '../src/domain/services';
import { drawPagesInNode } from '../tools/fabrication/live-pages';
import { liveJobs } from '../tools/playground/samples/fabrication-jobs';
import { temporaryRoot } from '../tools/temporary';
import { allowed, jpeg, meta, samReply } from './fabrication-fixtures';

const box = (left: number, top: number, right: number, bottom: number) => [
  left,
  top,
  right,
  bottom,
];
const stop = (
  ref: string,
  finding: string,
  caption: string,
  note: string,
  extra: Partial<FabricationAnswer['tour'][number]> = {},
) => ({ ref, caption, note, finding, page: null, box: null, entities: [], ...extra });

/** J1's answer in the quick run. */
const quickJ1: FabricationAnswer = {
  summary:
    'Job agrees on outline, diameters, hole count and quantities, but TP40-A1 small-hole x-pitch is 60 mm on drawing vs 58 mm in S5, and middle-to-large x-distance is 28 mm vs 30 mm; middle column is 2 mm left.',
  request: [
    {
      ref: 'S1',
      part: 'TP40-A1 top plate',
      dxf: 'S5',
      quantity: 4,
      thickness: 5,
      material: 'S235JR steel',
      quote:
        'all in S235JR steel:\n\n- TP40-A1 top plate, 5 mm, 4 pieces\n- SP12-B1 spacer, 5 mm, 8 pieces',
      drawing: {
        ref: 'S2',
        page: 1,
        quantity: 4,
        thickness: 5,
        material: 'S235JR steel',
        quote: 'Material: S235JR steel, 5 mm\nQuantity: 4 pieces',
      },
    },
    {
      ref: 'S1',
      part: 'SP12-B1 spacer',
      dxf: 'S4',
      quantity: 8,
      thickness: 5,
      material: 'S235JR steel',
      quote:
        'all in S235JR steel:\n\n- TP40-A1 top plate, 5 mm, 4 pieces\n- SP12-B1 spacer, 5 mm, 8 pieces',
      drawing: {
        ref: 'S2',
        page: 1,
        quantity: 8,
        thickness: 5,
        material: null,
        quote: 'SP12-B1 Spacer 5 mm 8',
      },
    },
  ],
  findings: [
    {
      id: 'F1',
      kind: 'pitch',
      summary: 'Drawing shows 60 mm small-hole x-pitch but DXF has 58 mm.',
      drawing: {
        ref: 'S2',
        page: 1,
        value: 60,
        quote: '60',
        box: box(0.3051, 0.1335, 0.3183, 0.1545),
        feature: null,
      },
      dxf: { ref: 'S5', value: 58, axis: 'x', entities: ['10', '11'] },
      photo: null,
      proposal: { target: 60, move: ['11', '9'] },
    },
    {
      id: 'F2',
      kind: 'pitch',
      summary: 'Drawing shows 28 mm middle-to-large x-distance but DXF has 30 mm.',
      drawing: {
        ref: 'S2',
        page: 1,
        value: 28,
        quote: '28',
        box: box(0.4533, 0.1335, 0.4665, 0.1545),
        feature: null,
      },
      dxf: { ref: 'S5', value: 30, axis: 'x', entities: ['11', '12'] },
      photo: null,
      proposal: { target: 28, move: ['11', '9'] },
    },
  ],
  tour: [
    stop(
      'S1',
      'F1',
      'Request asks for TP40-A1 top plate, 5 mm, 4 pieces in S235JR steel.',
      'Request lines name TP40-A1 and SP12-B1; TP40-A1 maps to S5, SP12-B1 maps to S4.',
      { page: 1 },
    ),
    stop(
      'S2',
      'F1',
      'Drawing dimensions the small-hole x-pitch as 60 mm.',
      'Top dimension 60 between left and middle columns; note also says holes at 60 x 50 mm.',
      { page: 1, box: box(0.3051, 0.1335, 0.3183, 0.1545) },
    ),
    stop(
      'S5',
      'F1',
      'DXF draws that top-row pitch as 58 mm.',
      'Holes 1 and 2 entities 10 and 11 measure 58 mm in x; y-pitch is correct at 50 mm.',
      { entities: ['10', '11'] },
    ),
    stop(
      'S2',
      'F2',
      'Drawing dimensions middle-to-large x-distance as 28 mm.',
      'Third top segment 28 from middle column to large-hole centre; 20+60+28=108.',
      { page: 1, box: box(0.4533, 0.1335, 0.4665, 0.1545) },
    ),
    stop(
      'S5',
      'F2',
      'DXF draws that x-distance as 30 mm.',
      'Middle-top hole 11 at x78 and large hole 12 at x108 measure 30 mm in x.',
      { entities: ['11', '12'] },
    ),
    stop(
      'S3',
      'F2',
      'Photo shows TP40-A1 sample with 4 small holes and 1 large hole.',
      'Sample confirms layout with large hole right of middle column; pitch offset not visible by eye.',
    ),
  ],
};

/** J2's answer in the first run. */
const firstJ2: FabricationAnswer = {
  summary:
    'Bracket B2 middle hole disagrees: drawing specifies 3× Ø8.5 mm but DXF S3 middle hole (entity 9) is Ø10 mm; outline 120x60 mm and 40 mm pitch agree, Spacer S4 has a matching DXF.',
  request: [
    {
      ref: 'S1',
      part: 'Bracket B2',
      dxf: null,
      quantity: null,
      thickness: null,
      material: null,
      quote: null,
      drawing: null,
    },
  ],
  findings: [
    {
      id: 'F1',
      kind: 'diameter',
      summary: 'Drawing requires 3× Ø8.5 mm holes but DXF middle hole is Ø10 mm.',
      drawing: {
        ref: 'S2',
        page: 1,
        value: 8.5,
        quote: '3× Ø8.5',
        box: box(0.4161, 0.3522, 0.4587, 0.3732),
        feature: null,
      },
      dxf: { ref: 'S3', value: 10, axis: 'centre', entities: ['9'] },
      photo: null,
      proposal: null,
    },
  ],
  tour: [
    stop(
      'S2',
      'F1',
      'Drawing calls for 3× Ø8.5 mm holes.',
      'Bottom note also states Holes 3x Ø8.5 at 40 mm pitch.',
      { page: 1, box: box(0.4161, 0.3522, 0.4587, 0.3732) },
    ),
    stop(
      'S3',
      'F1',
      'DXF middle hole is Ø10 mm, not Ø8.5 mm.',
      'Entity 9 is the middle hole; outer holes 8 and 10 are Ø8.5 mm.',
      { entities: ['9'] },
    ),
  ],
};

let root: string;
beforeAll(async () => {
  root = await temporaryRoot('viewer-fabrication-recorded-');
});

/** The job written to a folder of its own, checked with the answer it got. */
async function check(id: string, answer: FabricationAnswer) {
  const job = liveJobs().find((item) => item.truth.id === id)!;
  const folder = path.join(root, job.truth.job);
  await mkdir(folder);
  for (const file of job.files) await writeFile(path.join(folder, file.name), file.bytes);
  const progress: CheckProgress[] = [];
  const checks = new FabricationChecks({
    settings: () => ({ ...defaultSettings(root), providers: [meta] }),
    access: async () => {},
    permission: async () => allowed('images'),
    generate: vi.fn(async () => structuredClone(answer)),
    encodePhoto: async () => Buffer.from(jpeg(1600, 1200)),
    segmenter: () => samSegmenter(async () => samReply, 'Muse Spark'),
    progress: (_owner, step) => progress.push(step),
  });
  const opened = await checks.request({ kind: 'open', paths: [folder] }, 1);
  if (opened.kind !== 'opened') throw new Error('Expected an inventory.');
  const { pages } = await drawPagesInNode(opened.sources);
  const result = (await checks.request(
    { kind: 'run', id: opened.id, providerID: meta.id, pages },
    1,
  )) as CheckResult;
  const record = JSON.parse(checks.handoff(opened.id)!.record) as CheckRecord;
  checks.close();
  return { result, record, progress };
}

describe('one cause, one finding', () => {
  it('shows one misplaced hole as one finding, with one correction and one stop per file', async () => {
    const { result, record, progress } = await check('J1', quickJ1);
    const model = result.findings.filter((item) => item.origin === 'model');
    expect(model).toHaveLength(1);
    const [cause] = model as [(typeof model)[number]];
    expect(cause.finding.summary).toBe(
      'Hole 2 is 2.00 mm off along x: the 60 mm pitch reads 58.00 mm and the 28 mm pitch reads 30.00 mm. Moving it, with hole 5, fixes both.',
    );
    expect(cause.grade.status).toBe('confirmed');
    // each reading keeps its own grade and quote
    expect(
      cause.readings!.map(({ finding, grade }) => [
        finding.id,
        finding.drawing!.quote,
        grade.status,
        grade.reason,
      ]),
    ).toEqual([
      [
        'F1',
        '60',
        'confirmed',
        'Viewer measured 58.00 mm between holes 1 and 2 along x; the drawing gives 60 mm.',
      ],
      [
        'F2',
        '28',
        'confirmed',
        'Viewer measured 30.00 mm between holes 2 and 3 along x; the drawing gives 28 mm.',
      ],
    ]);

    // one correction, which sets both pitches and is measured again for each
    const { correction } = cause;
    expect(correction!.plan).toEqual({
      kind: 'dxf-correction',
      format: 'dxf',
      from: '10',
      to: '11',
      axis: 'x',
      target: 60,
      measured: 58,
      move: ['9'],
      also: [{ from: '12', to: '11', axis: 'x', target: 28, measured: 30 }],
    });
    expect(correction!.description[1]).toBe(
      'pitches along x from 58.00 mm to 60.00 mm and from 30.00 mm to 28.00 mm',
    );
    const corrected = correctDrawing(
      await readFile(correction!.source, 'utf8'),
      correction!.plan,
      'g5-TP40-A1-4buc.dxf',
    );
    expect(corrected.report.after).toBeCloseTo(60, 5);
    expect(corrected.report.also![0]!.after).toBeCloseTo(28, 5);
    expect(corrected.report.shift).toEqual({ x: 2, y: 0 });

    // one drawing stop with both dimensions' text, one DXF stop with both pitches
    const stops = result.tour.stops;
    expect(stops.map((item) => [item.id, item.finding?.id])).toEqual([
      ['stop-1', 'F1'],
      ['stop-2', 'F1'],
      ['stop-3', 'F1'],
      ['stop-6', 'F1'],
    ]);
    const drawing = stops[1]!;
    expect(drawing.caption).toBe(
      'Drawing dimensions the small-hole x-pitch as 60 mm. Drawing dimensions middle-to-large x-distance as 28 mm.',
    );
    expect(drawing.note).toBe(cause.grade.reason);
    const page = drawing.target.kind === 'file' ? drawing.target.anchor : undefined;
    expect(page).toMatchObject({ kind: 'pdf', page: 1, search: false });
    expect(page?.kind === 'pdf' && page.marks?.map((mark) => mark.kind)).toEqual(['text', 'text']);
    expect(cause.outlines.map((outline) => [outline.kind, outline.source, outline.quote])).toEqual([
      ['text', 'page-text', '60'],
      ['text', 'page-text', '28'],
    ]);
    const dxf = stops[2]!.target.kind === 'file' ? stops[2]!.target.anchor : undefined;
    expect(dxf?.kind === 'dxf' && dxf.entities).toEqual(['10', '11', '12']);
    expect(dxf?.kind === 'dxf' && dxf.measure).toHaveLength(2);

    // the record keeps every reading's grade, the cause and its one correction
    expect(record.grades.map((grade) => grade.finding)).toEqual(['F1', 'F2']);
    expect(record.causes).toEqual([
      { finding: 'F1', readings: ['F1', 'F2'], summary: cause.finding.summary },
    ]);
    expect(record.corrections).toEqual([{ finding: 'F1', plan: correction!.plan }]);
    expect(record.tour).toEqual({ stops: 4, skipped: [] });
    // no feature boxed, so SAM has nothing to outline
    expect(progress.map((step) => step.text)).toEqual([
      'Muse Spark is reading the request, 1 drawing page, 1 photo and 2 DXF parts',
    ]);
  }, 30_000);
});

describe('what the answer leaves unread', () => {
  it('says which part has no quantity and which part is missing, with no number of its own', async () => {
    const { result } = await check('J2', firstJ2);
    expect(result.findings[0]).toMatchObject({
      origin: 'model',
      finding: { kind: 'diameter' },
      grade: { status: 'confirmed' },
    });
    const unread = result.findings.filter((item) => item.unread);
    expect(
      unread.map((item) => [item.unread, item.finding.summary, item.grade.status, item.names]),
    ).toEqual([
      [
        'quantity',
        'Muse Spark did not read a quantity for Bracket B2 from the request. Check the request or run the check again.',
        'unverified',
        { drawing: 'Job 2102 request.eml', dxf: 'Bracket B2.dxf' },
      ],
      [
        'part',
        'Muse Spark did not read Spacer S4 from the request. Check the request or run the check again.',
        'unverified',
        { drawing: 'Job 2102 request.eml', dxf: 'Spacer S4.dxf' },
      ],
    ]);
    for (const item of unread) {
      expect(item.finding.drawing!.value).toBeNull();
      expect(item.finding.dxf!.value).toBeNull();
      expect(item.grade.measured).toBeUndefined();
    }
    expect(result.findings).toHaveLength(3);
  }, 30_000);
});
