/**
 * THE LIVE EVALUATION, offline: its eight jobs hold the problems their truth plants, and the runner,
 * with the network stubbed by replies shaped as Muse Spark's and SAM 3.1's, counts what was found,
 * missed and invented, Viewer's grades, quotes, a schema failure and its retry, SAM's fallback to
 * the model's box, the outlines' overlap with the truth, and each call's time and tokens.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CheckFinding } from '../src/domain/fabrication/check';
import type { FabricationAnswer } from '../src/domain/fabrication/answer';
import type { MeasurementSummary } from '../src/domain/fabrication/measure';
import type { LiveJob } from '../tools/playground/samples/fabrication-jobs';
import type { LiveReport } from '../tools/fabrication/evaluate-live';
import { buildInventory } from '../src/domain/fabrication/answer';
import { measureDrawing } from '../src/domain/fabrication/measure';
import { readJobName } from '../src/domain/fabrication/names';
import { pageText } from '../src/domain/fabrication/prompt';
import { parseDrawing } from '../src/domain/previews/drawings/dxf/geometry';
import { evaluateLive, failureOf, replyUsage } from '../tools/fabrication/evaluate-live';
import { drawPagesInNode } from '../tools/fabrication/live-pages';
import { findsProblem, polygonIoU } from '../tools/fabrication/live-score';
import { liveJobs, plantedKinds } from '../tools/playground/samples/fabrication-jobs';
import { temporaryRoot } from '../tools/temporary';
import { jpeg } from './fabrication-fixtures';

/** The input as the check sends it, as far as these replies read it. */
interface SentInput {
  job: string;
  inventory: { ref: string; kind: string; name: string }[];
  drawings: { ref: string; shown: { page: number; text: { text: string; box: number[] }[] }[] }[];
  dxf: { ref: string; measurement?: MeasurementSummary }[];
}
const key = 'offline-test-key-0000';
let jobs: LiveJob[];
beforeAll(() => {
  jobs = liveJobs();
});
const jobOf = (id: string) => jobs.find((job) => job.truth.id === id)!;

describe('live evaluation jobs', () => {
  it('are eight, two of them controls, planting each kind of problem and naming parts both ways', () => {
    expect(jobs.map((job) => job.truth.id)).toEqual([
      'J1',
      'J2',
      'J3',
      'J4',
      'J5',
      'J6',
      'J7',
      'J8',
    ]);
    expect(jobs.filter((job) => job.truth.control).map((job) => job.truth.id)).toEqual([
      'J7',
      'J8',
    ]);
    for (const job of jobs.filter((item) => !item.truth.control))
      expect(job.truth.problems.length).toBeGreaterThanOrEqual(1);
    expect(
      new Set(jobs.flatMap((job) => job.truth.problems.map((problem) => problem.kind))),
    ).toEqual(new Set(plantedKinds));
    expect(new Set(jobs.map((job) => job.truth.naming))).toEqual(
      new Set(['convention', 'plain', 'mixed']),
    );
    for (const job of jobs) {
      const names = job.files.map((file) => file.name);
      expect(names.filter((name) => name.endsWith('.eml'))).toHaveLength(1);
      expect(names.some((name) => name.endsWith('.pdf'))).toBe(true);
      const dxf = names.filter((name) => name.endsWith('.dxf'));
      expect(dxf.length).toBeGreaterThanOrEqual(1);
      expect(dxf.length).toBeLessThanOrEqual(3);
      // A plain name gives neither a thickness nor a quantity.
      for (const part of job.truth.requested.filter(
        (item) => item.dxf && !item.dxf.startsWith('g'),
      )) {
        const read = readJobName(part.dxf!);
        expect([read.thickness, read.quantity], part.dxf).toEqual([undefined, undefined]);
      }
    }
    expect(jobs.filter((job) => job.files.some((file) => file.name.endsWith('.png')))).toHaveLength(
      3,
    );
  });

  it('draws each planted pitch and diameter in the DXF, and gives the other value in the drawing', async () => {
    for (const job of jobs)
      for (const problem of job.truth.problems) {
        if (problem.kind !== 'pitch' && problem.kind !== 'diameter') continue;
        const dxf = job.files.find((file) => file.name === problem.dxf)!;
        const outcome = measureDrawing(parseDrawing(new TextDecoder().decode(dxf.bytes)));
        if (outcome.status !== 'measured') throw new Error(outcome.reason);
        const values =
          problem.kind === 'diameter'
            ? outcome.measurement.holes.map((hole) => hole.diameter)
            : outcome.measurement.holes.flatMap((a) =>
                outcome.measurement.holes.map((b) =>
                  Math.max(Math.abs(a.centre.x - b.centre.x), Math.abs(a.centre.y - b.centre.y)),
                ),
              );
        expect(values, problem.id).toContain(problem.found);
        const drawn = await drawnText(job, problem.part);
        expect(drawn, problem.id).toContain(String(problem.expected));
      }
  });

  it('sets the request against the title block, the name and the DXFs as planted, and not in the controls', async () => {
    const request = (job: LiveJob) =>
      new TextDecoder().decode(job.files.find((file) => file.name.endsWith('.eml'))!.bytes);
    expect(request(jobOf('J3'))).toContain('FL30-C2 flange plate, 5 mm, 2 pieces');
    expect(await drawnText(jobOf('J3'), 'FL30-C2')).toContain('Material: S355 steel, 4 mm');
    expect(request(jobOf('J2'))).toContain('6 pieces of Bracket B2 in 4 mm AlMg3');
    expect(await drawnText(jobOf('J2'), 'B2')).toContain('Quantity: 8 pieces');
    expect(request(jobOf('J6'))).toContain('10 pieces of CL15-A1 cable clamp');
    expect(readJobName('g2-CL15-A1-12buc.dxf').quantity?.value).toBe(12);
    for (const id of ['J4', 'J6']) {
      const missing = jobOf(id).truth.problems.find((problem) => problem.kind === 'missing-dxf')!;
      expect(request(jobOf(id))).toContain(missing.part);
      expect(
        jobOf(id).truth.requested.find((part) => part.part === missing.part)!.dxf,
      ).toBeUndefined();
    }
    const pair = jobOf('J5').files.find((file) => file.name === 'g3-SB40-LR.dxf')!;
    const outcome = measureDrawing(parseDrawing(new TextDecoder().decode(pair.bytes)));
    expect(outcome.status === 'measured' && outcome.measurement.outlines).toHaveLength(2);
    // The controls' DXFs measure as their drawings give.
    for (const id of ['J7', 'J8'])
      for (const part of jobOf(id).truth.requested) {
        const read = readJobName(part.dxf!);
        if (read.quantity) expect(read.quantity.value).toBe(part.quantity);
        if (read.thickness) expect(read.thickness.value).toBe(part.thickness);
      }
  });
});

/** The text of the drawing whose title block names `part`, as the check reads it. */
async function drawnText(job: LiveJob, part: string): Promise<string> {
  pages ??= await temporaryRoot('viewer-fabrication-live-pages-');
  for (const pdf of job.files.filter((file) => file.name.endsWith('.pdf'))) {
    const file = path.join(pages, `${job.truth.id} ${pdf.name}`);
    await writeFile(file, pdf.bytes);
    const [source] = buildInventory([
      { path: file, kind: 'drawing', version: { identity: '1:1', size: 1, modified: 1 } },
    ]);
    const { pages: drawn } = await drawPagesInNode([{ ...source!, sending: 'pages' }]);
    const text = drawn[0]!.text;
    if (text.some((run) => run.text.startsWith('JOB ') && run.text.endsWith(` ${part}`)))
      return pageText(text);
  }
  throw new Error(`${job.truth.job} has no drawing of ${part}.`);
}
let pages: string | undefined;

/** SAM's reply for an object prompt: the box it was given, every cell of a 32 × 32 mask set. */
function samReply(prompt: string): string {
  const box = /<\|box;([^|]*)\|>/.exec(prompt)![1]!;
  return `<0f>0<|box;${box};c=0.91|><|mask;x=0;y=0;c=0.91;data=32,32,!!!!!(y:SRo?iX|>`;
}
const refOf = (input: SentInput, name: string) =>
  input.inventory.find((item) => item.name === name)!.ref;
const runBox = (input: SentInput, drawing: string, text: string) => {
  const ref = refOf(input, drawing);
  return input.drawings
    .find((item) => item.ref === ref)!
    .shown[0]!.text.find((run) => run.text === text)!.box;
};
/** A feature's box, as the truth labels it: a hole the finding is about. */
const featureBox = (job: string, label: string) =>
  jobs
    .find((item) => item.truth.job === job)!
    .truth.regions.find((region) => region.label === label)!.box;
const measured = (input: SentInput, name: string) =>
  input.dxf.find((item) => item.ref === refOf(input, name))!.measurement!;
const stop = (
  ref: string,
  caption: string,
  extra: Partial<FabricationAnswer['tour'][number]> = {},
) => ({
  ref,
  caption,
  note: null,
  finding: null,
  page: null,
  box: null,
  entities: [],
  ...extra,
});

/** What the stubbed model answers each job: J1 right, J2 missing the drawing's quantity, J7
 * inventing a pitch, J8 right and with nothing to find. J1 and J2 box the hole they are about. */
function answerFor(input: SentInput): FabricationAnswer {
  const request = input.inventory.find((item) => item.kind === 'request')!.ref;
  const photo = input.inventory.find((item) => item.kind === 'photo')?.ref;
  const truth = jobs.find((job) => job.truth.job === input.job)!.truth;
  const photoBox = truth.regions.find((region) => region.label.startsWith('photo:'))?.box;
  if (input.job === 'Job 2101') {
    const drawing = refOf(input, 'Job 2101 drawing.pdf');
    const plate = refOf(input, 'g5-TP40-A1-4buc.dxf');
    const { pitches, holes } = measured(input, 'g5-TP40-A1-4buc.dxf');
    const pitch = pitches.find((item) => item.axis === 'x' && item.value === 58)!;
    const box = runBox(input, 'Job 2101 drawing.pdf', '60');
    return {
      summary: 'The top plate’s right holes are 58 mm from the left ones; the drawing gives 60 mm.',
      request: [
        {
          ref: request,
          part: 'TP40-A1 top plate',
          dxf: plate,
          quantity: 4,
          thickness: 5,
          material: 'S235JR steel',
          quote: 'TP40-A1 top plate, 5 mm, 4 pieces',
          drawing: {
            ref: drawing,
            page: 1,
            quantity: 4,
            thickness: 5,
            material: 'S235JR steel',
            quote: 'Quantity: 4 pieces',
          },
        },
        {
          ref: request,
          part: 'SP12-B1 spacer',
          dxf: refOf(input, 'g5-SP12-B1-8buc.dxf'),
          quantity: 8,
          thickness: 5,
          material: 'S235JR steel',
          quote: 'SP12-B1 spacer, 5 mm, 8 pieces',
          drawing: null,
        },
      ],
      findings: [
        {
          id: 'F1',
          kind: 'pitch',
          summary:
            'The DXF puts the right holes 58 mm from the left ones; the drawing gives 60 mm.',
          drawing: {
            ref: drawing,
            page: 1,
            value: 60,
            quote: '60',
            box,
            feature: featureBox('Job 2101', 'TP40-A1, hole 2 Ø9'),
          },
          dxf: { ref: plate, value: 58, axis: 'x', entities: pitch.entities },
          photo: null,
          proposal: {
            target: 60,
            move: holes.filter((hole) => hole.centre[0] === 78).map((hole) => hole.entities[0]!),
          },
        },
      ],
      tour: [
        stop(request, 'The request asks for 4 top plates.'),
        stop(drawing, 'The drawing gives 60 mm.', { finding: 'F1', page: 1, box }),
        stop(plate, 'The DXF has 58 mm.', { finding: 'F1', entities: pitch.entities }),
        stop(photo!, 'The sample plate.', { box: photoBox! }),
      ],
    };
  }
  if (input.job === 'Job 2102') {
    const drawing = refOf(input, 'Bracket B2.pdf');
    const bracket = refOf(input, 'Bracket B2.dxf');
    const wide = measured(input, 'Bracket B2.dxf').holes.find((hole) => hole.diameter === 10)!;
    const box = runBox(input, 'Bracket B2.pdf', '3× Ø8.5');
    return {
      summary: 'The bracket’s middle hole is Ø10 in the DXF; the drawing gives Ø8.5.',
      request: [
        {
          ref: request,
          part: 'Bracket B2',
          dxf: bracket,
          quantity: 6,
          thickness: 4,
          material: 'AlMg3',
          quote: '6 pieces of Bracket B2 in 4 mm AlMg3',
          drawing: null,
        },
        {
          ref: request,
          part: 'Spacer S4',
          dxf: refOf(input, 'Spacer S4.dxf'),
          quantity: 12,
          thickness: 4,
          material: 'AlMg3',
          quote: '12 pieces of Spacer S4, also 4 mm AlMg3',
          drawing: null,
        },
      ],
      findings: [
        {
          id: 'F1',
          kind: 'diameter',
          summary: 'The middle hole is Ø10 in the DXF; the drawing gives 3× Ø8.5.',
          drawing: {
            ref: drawing,
            page: 1,
            value: 8.5,
            quote: '3× Ø8.5',
            box,
            feature: featureBox('Job 2102', 'Bracket B2, hole 2 Ø8.5'),
          },
          dxf: { ref: bracket, value: 10, axis: null, entities: wide.entities },
          photo: null,
          proposal: null,
        },
      ],
      tour: [stop(drawing, 'The drawing gives 3× Ø8.5.', { finding: 'F1', page: 1, box })],
    };
  }
  if (input.job === 'Job 2107') {
    const drawing = refOf(input, 'Job 2107 drawing.pdf');
    const plate = refOf(input, 'g6-HP50-A3-2buc.dxf');
    const pitch = measured(input, 'g6-HP50-A3-2buc.dxf').pitches.find((item) => item.axis === 'x')!;
    const box = runBox(input, 'Job 2107 drawing.pdf', '45');
    return {
      summary: 'One pitch of the hinge plate is 43 mm in the DXF.',
      request: [
        {
          ref: request,
          part: 'HP50-A3 hinge plate',
          dxf: plate,
          quantity: 2,
          thickness: 6,
          material: 'S235JR steel',
          quote: 'HP50-A3 hinge plate, 6 mm, 2 pieces',
          drawing: null,
        },
        {
          ref: request,
          part: 'SP20-B3 spacer',
          dxf: refOf(input, 'g6-SP20-B3-4buc.dxf'),
          quantity: 4,
          thickness: 6,
          material: 'S235JR steel',
          quote: 'SP20-B3 spacer, 6 mm, 4 pieces',
          drawing: null,
        },
      ],
      findings: [
        {
          id: 'F1',
          kind: 'pitch',
          summary: 'The DXF puts two holes 43 mm apart; the drawing gives 45 mm.',
          drawing: { ref: drawing, page: 1, value: 45, quote: '45', box, feature: null },
          dxf: { ref: plate, value: 43, axis: 'x', entities: pitch.entities },
          photo: null,
          proposal: null,
        },
      ],
      tour: [
        stop(drawing, 'The drawing gives 45 mm.', { finding: 'F1', page: 1, box }),
        stop(photo!, 'The hinge plate.', { box: photoBox! }),
      ],
    };
  }
  const drawing = refOf(input, 'Plate P9.pdf');
  return {
    summary: 'The job agrees with itself.',
    request: [
      {
        ref: request,
        part: 'Plate P9',
        dxf: refOf(input, 'Plate P9.dxf'),
        quantity: 5,
        thickness: 3,
        material: 'AlMg3',
        // misquoted: the request says 5 pcs
        quote: 'Plate P9: 3 mm, 6 pcs',
        drawing: null,
      },
      {
        ref: request,
        part: 'Tab pair P4, left and right',
        dxf: refOf(input, 'Tab pair P4.dxf'),
        quantity: 4,
        thickness: 3,
        material: 'AlMg3',
        quote: 'Tab pair P4, left and right: 3 mm, 4 pcs (2 of each)',
        drawing: null,
      },
    ],
    findings: [],
    tour: [
      stop(drawing, 'The plate’s title block.', {
        page: 1,
        box: runBox(input, 'Plate P9.pdf', 'Quantity: 5 pieces'),
      }),
    ],
  };
}

describe('live evaluation runner', () => {
  let out: string;
  let report: LiveReport;
  let replies: string[];
  beforeAll(async () => {
    out = path.join(await temporaryRoot('viewer-fabrication-live-'), 'run');
    replies = [];
    let clock = 0;
    let schemaMissed = false;
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages?: { content: { text?: string }[] }[];
        input?: { content: { text?: string; image_url?: string }[] }[];
      };
      if (String(url).endsWith('/responses')) {
        clock += 900;
        const [prompt, picture] = body.input![0]!.content;
        // Photos are re-encoded to 1600 px; SAM is down for them.
        if (Buffer.from(picture!.image_url!.split(',')[1]!, 'base64').length < 100)
          return Response.json({ error: { message: 'busy' } }, { status: 500 });
        return Response.json({
          output: [{ content: [{ type: 'output_text', text: samReply(prompt!.text!) }] }],
        });
      }
      clock += 6000;
      const input = JSON.parse(body.messages![1]!.content[0]!.text!) as SentInput;
      let answer: unknown = answerFor(input);
      // Job 2101's first answer has no tour, as a model sometimes answers.
      if (input.job === 'Job 2101' && !schemaMissed) {
        schemaMissed = true;
        answer = { ...(answer as object), tour: 'none' };
      }
      const content = JSON.stringify(answer);
      replies.push(content);
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content } }],
        usage: { prompt_tokens: 12000, completion_tokens: 900, total_tokens: 12900 },
      });
    }) as typeof fetch;
    report = await evaluateLive({
      out,
      key,
      jobs: ['J1', 'J2', 'J7', 'J8'],
      price: { input: 1, output: 4 },
      request,
      encodePhoto: async () => Buffer.from(jpeg(1600, 1200)),
      now: () => clock,
      wait: async () => {},
    });
  }, 60_000);

  it('counts the planted problems found and missed, by kind, with their grades', () => {
    const { recall } = report.metrics;
    expect(recall.pitch).toEqual({ planted: 1, found: 1, confirmed: 1, expected: 1 });
    expect(recall.diameter).toEqual({ planted: 1, found: 1, confirmed: 1, expected: 1 });
    expect(recall.quantity).toEqual({ planted: 1, found: 0, confirmed: 0, expected: 0 });
    expect(recall.all).toEqual({ planted: 3, found: 2, confirmed: 2, expected: 2 });
    const j2 = report.runs.find((run) => run.job === 'J2')!;
    expect(j2.problems.map((problem) => [problem.kind, problem.found])).toEqual([
      ['diameter', true],
      ['quantity', false],
    ]);
    expect(report.summary).toContain('- J2 run 1, B2: The request asks for 6 brackets');
  });

  it('counts the invented finding as false, per control job, and Viewer refutes it', () => {
    const { falseFindings, grades } = report.metrics;
    expect(falseFindings).toMatchObject({
      total: 1,
      perRun: 0.25,
      byOrigin: { model: 1, viewer: 0 },
      byGrade: { confirmed: 0, refuted: 1, unverified: 0 },
    });
    expect(falseFindings.jobs.filter((job) => job.control)).toEqual([
      {
        job: 'J7',
        name: 'Job 2107',
        control: true,
        runs: 1,
        findings: 1,
        grades: { confirmed: 0, refuted: 1, unverified: 0 },
      },
      {
        job: 'J8',
        name: 'Job 2108',
        control: true,
        runs: 1,
        findings: 0,
        grades: { confirmed: 0, refuted: 0, unverified: 0 },
      },
    ]);
    expect(grades.planted).toEqual({ confirmed: 2, refuted: 0, unverified: 0 });
    expect(report.runs.find((run) => run.job === 'J7')!.findings).toEqual([
      expect.objectContaining({ kind: 'pitch', origin: 'model', grade: 'refuted' }),
    ]);
    // A drawing of two pieces asked for 4 pieces is 2 sets: no question is raised.
    expect(report.runs.find((run) => run.job === 'J8')!.findings).toEqual([]);
  });

  it('checks every quote against its page, and the request as the model read it', () => {
    expect(report.metrics.quotes).toEqual({ checked: 12, onPage: 11, notOnPage: 1, noText: 0 });
    expect(report.runs.find((run) => run.job === 'J8')!.quotes.missed).toEqual([
      '“Plate P9: 3 mm, 6 pcs” on page 1 of Job 2108 request.eml',
    ]);
    expect(report.metrics.request).toEqual({
      parts: 8,
      listed: 8,
      quantity: 8,
      thickness: 8,
      dxf: 8,
    });
  });

  it('counts the schema failure and its retry, keeping where the answer missed the schema', async () => {
    expect(report.metrics.attempts).toEqual({
      total: 5,
      retried: 1,
      failedRuns: 0,
      failures: { schema: 1, json: 0, incomplete: 0, http: 0, timeout: 0, network: 0, other: 0 },
    });
    const answers = JSON.parse(await readFile(path.join(out, 'answers.json'), 'utf8')) as {
      runs: {
        job: string;
        attempts: { outcome: string; schemaIssues?: string[]; calls: { reply?: string }[] }[];
        record: { inputs: { pictures: { image: unknown }[] }[] };
      }[];
    };
    const [first, second] = answers.runs.find((run) => run.job === 'J1')!.attempts;
    expect(first).toMatchObject({ outcome: 'schema' });
    expect(first!.schemaIssues![0]).toMatch(/^tour: /);
    expect(second).toMatchObject({ outcome: 'graded' });
    // every raw answer is kept, as it came
    expect(
      answers.runs.flatMap((run) =>
        run.attempts.flatMap((attempt) => attempt.calls.map((call) => call.reply)),
      ),
    ).toEqual(
      expect.arrayContaining(
        replies.map((content) => expect.stringContaining(JSON.stringify(content))),
      ),
    );
    // the record numbers each picture sent; it does not hold the picture
    for (const run of answers.runs)
      for (const input of run.record.inputs)
        for (const picture of input.pictures) expect(typeof picture.image).toBe('number');
  });

  it('scores text boxes and SAM’s feature outlines apart, and counts SAM’s fallback', () => {
    const { text, features } = report.metrics.outlines;
    // the quotes of J1, J2 and J7, and J8's stop over one text run, each by its own runs
    expect(text).toMatchObject({ total: 4, runs: 4, model: 0 });
    expect(text.iou).toMatchObject({ count: 4, median: 1 });
    // the holes J1 and J2 box, and the photos, for which SAM is down
    expect(features).toMatchObject({ total: 4, sam: 2, fallback: 2, fallbackRate: 0.5 });
    expect(Object.keys(features.reasons)).toEqual([
      expect.stringMatching(/^Model request failed \(500\)/),
    ]);
    const j1 = report.runs.find((run) => run.job === 'J1')!.outlines;
    expect(j1.map((outline) => [outline.file, outline.kind, outline.source])).toEqual([
      ['Job 2101 drawing.pdf', 'feature', 'segmentation'],
      ['Job 2101 drawing.pdf', 'text', 'page-text'],
      ['TP40-A1 sample.png', 'feature', 'model-box'],
    ]);
    // SAM's whole-box mask over the hole's box is the square around the hole's circle: π/4
    expect(j1[0]).toMatchObject({ region: 'TP40-A1, hole 2 Ø9', confidence: 0.91 });
    expect(j1[0]!.iou).toBeCloseTo(Math.PI / 4, 1);
    expect(j1[1]).toMatchObject({ region: 'text “60”', iou: 1, boxIoU: 1 });
    expect(j1[2]).toMatchObject({ region: 'photo: TP40-A1', iou: 1, boxIoU: 1 });
    expect(features.iou.count).toBe(2);
  });

  it('times each call and sums its tokens and cost', () => {
    const { latency, tokens } = report.metrics;
    expect(latency.model).toMatchObject({ count: 5, median: 6000, max: 6000 });
    expect(latency.segmentation).toMatchObject({ count: 4, median: 900 });
    expect(tokens).toEqual({ input: 60000, output: 4500, total: 64500, calls: 5, cost: 0.078 });
  });

  it('writes the summary, the truth and the jobs, never the key, and never over a run', async () => {
    const summary = await readFile(path.join(out, 'summary.md'), 'utf8');
    expect(summary).toBe(report.summary);
    for (const heading of [
      '## Planted problems found',
      '## Findings not planted',
      '## Outlines',
      '## Calls',
    ])
      expect(summary).toContain(heading);
    expect(summary).toContain('with the API’s own reasoning effort');
    expect(summary).toContain('| Text, as drawn | 4 | 1.00 | 1.00 |');
    expect(summary).toContain('| Feature, SAM 3.1 | 2 |');
    for (const file of ['summary.md', 'answers.json', 'truth.json'])
      expect(await readFile(path.join(out, file), 'utf8')).not.toContain(key);
    expect(
      await readFile(path.join(out, 'jobs', 'Job 2101', 'g5-TP40-A1-4buc.dxf'), 'utf8'),
    ).toContain('AC1024');
    await expect(evaluateLive({ out, key, request: fetch })).rejects.toThrow('is not empty');
  });
});

describe('live evaluation options', () => {
  it('sends the reasoning effort asked for, and says it in the summary', async () => {
    const bodies: Record<string, unknown>[] = [];
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
        messages: { content: { text?: string }[] }[];
      };
      if (String(url).endsWith('/responses'))
        return Response.json({ error: { message: 'busy' } }, { status: 500 });
      bodies.push(body);
      const input = JSON.parse(body.messages[1]!.content[0]!.text!) as SentInput;
      return Response.json({
        choices: [
          { finish_reason: 'stop', message: { content: JSON.stringify(answerFor(input)) } },
        ],
      });
    }) as typeof fetch;
    const out = path.join(await temporaryRoot('viewer-fabrication-live-effort-'), 'run');
    const report = await evaluateLive({
      out,
      key,
      jobs: ['J8'],
      effort: 'minimal',
      request,
      wait: async () => {},
    });
    expect(bodies.map((body) => body.reasoning_effort)).toEqual(['minimal']);
    expect(report.summary).toContain('with reasoning effort minimal');
    const answers = JSON.parse(await readFile(path.join(out, 'answers.json'), 'utf8')) as {
      effort: string | null;
    };
    expect(answers.effort).toBe('minimal');
  }, 30_000);
});

describe('live evaluation scoring', () => {
  it('measures overlap as intersection over union', () => {
    const square: [number, number][] = [
      [0.2, 0.2],
      [0.4, 0.2],
      [0.4, 0.4],
      [0.2, 0.4],
    ];
    expect(polygonIoU(square, [0.2, 0.2, 0.4, 0.4])).toBeCloseTo(1);
    expect(polygonIoU(square, [0.3, 0.2, 0.5, 0.4])).toBeCloseTo(1 / 3);
    expect(polygonIoU(square, [0.6, 0.6, 0.8, 0.8])).toBe(0);
    // a hole is the circle in its box: its box overlaps it by π/4, a circle of it entirely
    expect(polygonIoU(square, [0.2, 0.2, 0.4, 0.4], 'ellipse')).toBeCloseTo(Math.PI / 4, 2);
    const circle = Array.from({ length: 90 }, (_, index): [number, number] => [
      0.3 + 0.1 * Math.cos((index / 90) * 2 * Math.PI),
      0.3 + 0.1 * Math.sin((index / 90) * 2 * Math.PI),
    ]);
    expect(polygonIoU(circle, [0.2, 0.2, 0.4, 0.4], 'ellipse')).toBeGreaterThan(0.99);
    // a triangle, half the box
    expect(
      polygonIoU(
        [
          [0.2, 0.2],
          [0.4, 0.2],
          [0.2, 0.4],
        ],
        [0.2, 0.2, 0.4, 0.4],
      ),
    ).toBeCloseTo(0.5);
  });

  it('finds a missing DXF by its part and an open count by its DXF', () => {
    const finding = (
      overrides: Partial<CheckFinding['finding']>,
      names: CheckFinding['names'],
      question?: string,
    ) =>
      ({
        finding: {
          id: 'F1',
          kind: 'other',
          summary: '',
          drawing: null,
          dxf: null,
          photo: null,
          proposal: null,
          ...overrides,
        },
        grade: { finding: 'F1', status: 'unverified', entities: [], reason: '', tolerance: 0 },
        origin: 'model',
        names,
        outlines: [],
        ...(question ? { question } : {}),
      }) as CheckFinding;
    const [missing, count] = [
      jobOf('J4').truth.problems.find((problem) => problem.kind === 'missing-dxf')!,
      jobOf('J5').truth.problems.find((problem) => problem.kind === 'piece-count')!,
    ];
    expect(
      findsProblem(
        finding({ summary: 'The request asks for Cover C5, which has no DXF.' }, {}),
        missing,
      ),
    ).toBe(true);
    expect(findsProblem(finding({ summary: 'The base has no DXF.' }, {}), missing)).toBe(false);
    expect(
      findsProblem(
        finding({ kind: 'quantity' }, { dxf: 'g3-SB40-LR.dxf' }, 'How many sets?'),
        count,
      ),
    ).toBe(true);
    expect(findsProblem(finding({ kind: 'pitch' }, { dxf: 'g3-SB40-LR.dxf' }), count)).toBe(false);
  });

  it('reads tokens from either envelope, and names each kind of failure', () => {
    expect(
      replyUsage('{"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}'),
    ).toEqual({
      input: 10,
      output: 2,
      total: 12,
    });
    expect(
      replyUsage(
        '{"metrics":[{"metric":"num_prompt_tokens","value":7},{"metric":"num_completion_tokens","value":3}]}',
      ),
    ).toEqual({ input: 7, output: 3, total: 10 });
    expect(replyUsage('{"choices":[]}')).toBeUndefined();
    const model = (status: number) => [
      { route: 'model' as const, status, milliseconds: 1, sent: 1 },
    ];
    expect(
      failureOf(
        new Error('Meta’s answer does not fit the check’s form at tour, so nothing was graded.'),
        model(200),
      ),
    ).toBe('schema');
    expect(
      failureOf(new Error('The model returned invalid JSON. No changes were applied.'), model(200)),
    ).toBe('json');
    expect(failureOf(new Error('Model request failed (429).'), model(429))).toBe('http');
    expect(failureOf(new Error('The provider request timed out.'), model(0))).toBe('timeout');
  });
});
