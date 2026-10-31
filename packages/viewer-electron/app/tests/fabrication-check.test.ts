/**
 * THE FABRICATION CHECK on Job 1042, the model stubbed with a prepared answer: the inventory and
 * what is sent, the answer graded against Viewer's own measurement, the tour, the correction, the
 * request's quantities, the quoted text's box and SAM's outline of the feature, the evidence
 * record, the steps a window is told of, the time limit, and the refusals. Then a job's files: its
 * folders read one level down, what has nothing to check, and what changed since a check.
 */
import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { CheckOpening, CheckProgress, CheckResult } from '../src/domain/fabrication/check';
import type { ModelDataLevel } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import type { GenerateOptions } from '../src/desktop/models/providers';
import type { SamRequest } from '../src/desktop/models/segmentation';
import { FabricationChecks } from '../src/desktop/fabrication/service';
import { samSegmenter } from '../src/desktop/models/segmentation';
import { checkAnswerSchema, checkInstructions } from '../src/domain/fabrication/prompt';
import { boxRegion } from '../src/domain/files/regions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import {
  allowed,
  drawingPage,
  jobAnswer,
  jpeg,
  meta,
  samReply,
  writeJob,
} from './fabrication-fixtures';

let root: string;
let folder: string;
let level: ModelDataLevel;
let generate: Mock<(...args: unknown[]) => Promise<unknown>>;
let checks: FabricationChecks;
let samRequest: Mock<SamRequest>;
let providers: ModelProvider[];
let progress: [number, CheckProgress][];
beforeEach(async () => {
  root = await temporaryRoot('viewer-fabrication-check-');
  folder = path.join(root, 'Job 1042');
  await writeJob(folder);
  level = 'images';
  generate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  samRequest = vi.fn<SamRequest>(async () => samReply);
  providers = [meta];
  progress = [];
  checks = new FabricationChecks({
    settings: () => ({ ...defaultSettings(root), providers }),
    access: async () => {},
    permission: async () => allowed(level),
    generate: (...args) => generate(...args),
    // the re-encoded photo: 1600 px on its longer side, as the image processor gives it
    encodePhoto: async () => Buffer.from(jpeg(1600, 1200)),
    segmenter: () => samSegmenter((...args) => samRequest(...args), 'Muse Spark'),
    progress: (owner, step) => progress.push([owner, step]),
  });
});
afterEach(() => checks.close());

async function opened(): Promise<CheckOpening> {
  const reply = await checks.request({ kind: 'open', paths: [folder] }, 1);
  if (reply.kind !== 'opened') throw new Error('Expected an inventory.');
  return reply;
}
async function checked(opening: CheckOpening, answer = jobAnswer(opening)): Promise<CheckResult> {
  generate.mockResolvedValue(answer);
  const reply = await checks.request(
    { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
    1,
  );
  if (reply.kind !== 'result') throw new Error('Expected a result.');
  return reply;
}

describe('fabrication check', () => {
  it('lists the job in refs, says how each file is sent, and leaves out what it cannot read', async () => {
    const opening = await opened();
    expect(opening.job).toBe('Job 1042');
    expect(opening.sources.map((source) => [source.ref, source.name, source.sending])).toEqual([
      ['S1', 'Job 1042 request.eml', 'text'],
      ['S2', 'Job 1042 drawing.pdf', 'pages'],
      ['S3', 'Plate.jpg', 'picture'],
      ['S4', 'g3-CV25-E1-10buc.dxf', 'measurement'],
      ['S5', 'g3-GS30-D1-6buc.dxf', 'measurement'],
      ['S6', 'g6-FL80-C1-2buc.dxf', 'measurement'],
      ['S7', 'g6-MB20-A1-4buc.dxf', 'measurement'],
      ['S8', 'g6-PL60-B2-2buc.dxf', 'measurement'],
    ]);
    expect(opening.skipped).toEqual([
      { name: 'Notes.json', reason: 'not a request, drawing, photo or DXF' },
    ]);
    expect(opening.providers).toEqual([
      { id: 'meta', name: 'Meta', model: 'muse-spark-1.3', pictures: true, allowed: true },
    ]);
    expect(opening.providerID).toBe('meta');
  });

  it('sends refs, text, measurements and pictures at the images level, never a path', async () => {
    const opening = await opened();
    await checked(opening);
    const [provider, instructions, input, schema, , sent, actor, options] = generate.mock
      .calls[0]! as [
      ModelProvider,
      string,
      unknown,
      unknown,
      AbortSignal,
      string,
      string,
      GenerateOptions,
    ];
    expect(provider.id).toBe('meta');
    expect(instructions).toBe(checkInstructions);
    expect(schema).toBe(checkAnswerSchema);
    expect([sent, actor]).toEqual(['images', 'user']);
    expect(options.images!.map((image) => image.type)).toEqual(['image/jpeg', 'image/jpeg']);
    const text = JSON.stringify(input);
    expect(text).not.toContain(root);
    expect(text).toContain('Please cut the parts for job 1042 in S235JR steel');
    expect(text).toContain('Holes 4× Ø10.5 at 50 mm pitch');
    expect(text).not.toContain('mara.pop@example.invalid');
    expect(input).toMatchObject({
      job: 'Job 1042',
      drawings: [{ ref: 'S2', pages: 1, shown: [{ page: 1, image: 1, width: 2048 }] }],
      photos: [{ ref: 'S3', image: 2, width: 1600, height: 1200 }],
      pictures: '2 pictures follow this text, in the order of their image numbers.',
    });
    const plate = (
      input as { dxf: { ref: string; measurement?: { pitches: unknown[] } }[] }
    ).dxf.find((item) => item.ref === 'S8');
    expect(plate?.measurement?.pitches).toContainEqual({
      axis: 'x',
      value: 48,
      holes: [4, 5],
      entities: ['8', '9'],
    });
  });

  it('grades the pitch Confirmed, builds the tour and proposes the correction', async () => {
    const opening = await opened();
    const result = await checked(opening);
    expect(result.issues).toEqual([]);
    const [finding] = result.findings;
    expect(finding).toMatchObject({
      origin: 'model',
      grade: {
        status: 'confirmed',
        measured: 48,
        reason: 'Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
      },
      names: { drawing: 'Job 1042 drawing.pdf', dxf: 'g6-PL60-B2-2buc.dxf' },
      correction: {
        source: path.join(folder, 'g6-PL60-B2-2buc.dxf'),
        name: 'g6-PL60-B2-2buc (corrected).dxf',
        plan: { kind: 'dxf-correction', from: '8', to: '9', axis: 'x', target: 50, measured: 48 },
      },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.tour.root).toBe(folder);
    expect(
      result.tour.stops.map((stop) => stop.target.kind === 'file' && stop.target.path),
    ).toEqual(['Job 1042 request.eml', 'Job 1042 drawing.pdf', 'g6-PL60-B2-2buc.dxf', 'Plate.jpg']);
    expect(result.tour.stops[1]).toMatchObject({
      finding: { id: 'F1', grade: 'confirmed' },
      note: finding!.grade.reason,
    });
    // the request decides each part's quantity and thickness, and says so
    expect(result.parts.find((part) => part.name === 'g6-PL60-B2-2buc.dxf')).toMatchObject({
      pieces: 1,
      quantity: { sets: 2, pieces: 2, source: 'request' },
      thickness: { value: 6, source: 'request' },
    });
  });

  it('marks the quote by its text runs, outlines the feature with SAM 3.1, and says when the box stands in', async () => {
    samRequest.mockImplementation(async (picture: { width: number }) => {
      if (picture.width === 1600) throw new Error('The provider request timed out.');
      return samReply;
    });
    const opening = await opened();
    const result = await checked(opening);
    // only features go to SAM: the hole on the drawing and the photo's region, never the text
    expect(samRequest).toHaveBeenCalledTimes(2);
    const [prompt] = samRequest.mock.calls[0]!.slice(1) as [string];
    // the feature, 0.55 to 0.6 of 2048 px and 0.42 to 0.5 of 1448 px; right and bottom inclusive
    expect(prompt).toBe('<0f>0<|box;x1=1126;y1=608;x2=1228;y2=723;w=2048;h=1448|>');
    const sam: [number, number][] = [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75],
    ];
    // the fixture gives every text run of the page one box
    const text = boxRegion({ x: 0.1, y: 0.1, width: 0.8, height: 0.12 - 0.1 });
    expect(result.tour.stops[1]!.target).toMatchObject({
      anchor: {
        kind: 'pdf',
        page: 1,
        search: false,
        region: sam,
        marks: [{ kind: 'text', region: text }],
      },
    });
    expect(result.findings[0]!.outlines).toEqual([
      {
        stop: 'stop-2',
        kind: 'feature',
        source: 'segmentation',
        label: 'outline from SAM 3.1',
        region: sam,
        box: [0.55, 0.42, 0.6, 0.5],
        confidence: 0.8904109597206116,
      },
      {
        stop: 'stop-2',
        kind: 'text',
        source: 'page-text',
        label: 'the text on the drawing',
        region: text,
        box: [0.08, 0.86, 0.6, 0.9],
        quote: 'Holes 4× Ø10.5 at 50 mm pitch',
      },
    ]);
    const photo = result.tour.stops[3]!.target;
    expect(photo.kind === 'file' && photo.anchor).toMatchObject({ kind: 'image', x: 0.2, y: 0.2 });
    // the window is told each step: the model reading, then SAM outlining
    expect(progress).toEqual([
      [
        1,
        {
          id: opening.id,
          step: 'reading',
          text: 'Muse Spark is reading the request, 1 drawing page, 1 photo and 5 DXF parts',
        },
      ],
      [1, { id: opening.id, step: 'outlining', text: 'SAM 3.1 is outlining 2 features' }],
    ]);
    const record = JSON.parse(checks.handoff(opening.id)!.record) as {
      segmentation: { label: string; note?: string }[];
    };
    expect(record.segmentation[2]).toMatchObject({
      stop: 'stop-4',
      ref: 'S3',
      kind: 'feature',
      source: 'model-box',
      label: 'box from Muse Spark',
      note: 'SAM 3.1 gave no outline: The provider request timed out.',
    });
  });

  it('raises a quantity the request’s own words do not give, and keeps it unverified', async () => {
    const opening = await opened();
    const answer = jobAnswer(opening);
    const bracket = answer.request.find((part) => part.part.startsWith('MB20-A1'))!;
    bracket.quantity = 5;
    const result = await checked(opening, answer);
    const raised = result.findings.find((item) => item.origin === 'viewer');
    expect(raised).toMatchObject({
      finding: {
        id: 'F2',
        kind: 'quantity',
        summary: 'The request asks for 5 pieces of MB20-A1; its file name gives 4 pieces (“4buc”).',
      },
      grade: {
        status: 'unverified',
        reason: '“MB20-A1 mounting bracket, 6 mm, 4 pieces” does not give 5 pieces.',
      },
      names: { drawing: 'Job 1042 request.eml', dxf: 'g6-MB20-A1-4buc.dxf' },
    });
    // the request still comes first, with the finding beside it
    expect(
      result.parts.find((part) => part.name === 'g6-MB20-A1-4buc.dxf')!.quantity,
    ).toMatchObject({ sets: 5, source: 'request' });
  });

  it('keeps an evidence record of what was asked, sent and answered, for the handoff only', async () => {
    const opening = await opened();
    expect(checks.handoff(opening.id)).toBeUndefined();
    await checked(opening);
    const handoff = checks.handoff(opening.id)!;
    expect(handoff.tour!.definition).toMatchObject({ version: 1, name: 'Job 1042' });
    const record = JSON.parse(handoff.record) as Record<string, unknown> & {
      inputs: { name: string; sha256: string; sending: string; pictures: unknown[] }[];
    };
    expect(record).toMatchObject({
      version: 1,
      job: 'Job 1042',
      provider: { kind: 'meta', endpoint: 'https://api.meta.ai/v1', model: 'muse-spark-1.3' },
      level: 'images',
      instructions: checkInstructions,
      validation: { valid: true, issues: [] },
      corrections: [{ finding: 'F1', plan: { target: 50 } }],
      tour: { stops: 4, skipped: [] },
    });
    expect(record.output).toEqual(jobAnswer(opening));
    expect(
      record.inputs.map((input) => [input.name, input.sending, input.pictures.length]),
    ).toEqual([
      ['Job 1042 request.eml', 'text', 0],
      ['Job 1042 drawing.pdf', 'pages', 1],
      ['Plate.jpg', 'picture', 1],
      ['g3-CV25-E1-10buc.dxf', 'measurement', 0],
      ['g3-GS30-D1-6buc.dxf', 'measurement', 0],
      ['g6-FL80-C1-2buc.dxf', 'measurement', 0],
      ['g6-MB20-A1-4buc.dxf', 'measurement', 0],
      ['g6-PL60-B2-2buc.dxf', 'measurement', 0],
    ]);
    expect(record.inputs.every((input) => /^[0-9a-f]{64}$/.test(input.sha256))).toBe(true);
    expect(handoff.record).not.toContain(root);
  });

  it('refuses before reading anything when the provider may not receive pictures', async () => {
    level = 'full-text';
    const opening = await opened();
    expect(opening.providers[0]!.allowed).toBe(false);
    await expect(
      checks.request({ kind: 'run', id: opening.id, providerID: meta.id, pages: [] }, 1),
    ).rejects.toThrow(
      'Meta may receive filenames, metadata and extracted document text. This check also sends pictures: allow filenames, metadata, document text and pictures (photos and rendered drawing pages) for Meta.',
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses a page drawn from another version of the drawing, and a check of another window', async () => {
    const opening = await opened();
    const page = await drawingPage(opening);
    await expect(
      checks.request(
        {
          kind: 'run',
          id: opening.id,
          providerID: meta.id,
          pages: [{ ...page, version: { ...page.version, size: page.version.size + 1 } }],
        },
        1,
      ),
    ).rejects.toThrow(
      'Job 1042 drawing.pdf changed since the check listed it. Check the job again.',
    );
    await expect(
      checks.request({ kind: 'run', id: opening.id, providerID: meta.id, pages: [page] }, 2),
    ).rejects.toThrow('This check was closed.');
    expect(generate).not.toHaveBeenCalled();
  });

  it('can be cancelled while the model answers, and grades nothing', async () => {
    const opening = await opened();
    generate.mockImplementation(
      (...args: unknown[]) =>
        new Promise((_, reject) => {
          const signal = args[4] as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const running = checks.request(
      { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
      1,
    );
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    await checks.request({ kind: 'cancel', id: opening.id }, 1);
    await expect(running).rejects.toThrow('The check was cancelled. Nothing was graded.');
    expect(checks.handoff(opening.id)).toBeUndefined();
  });

  it('waits 240 s for the answer, and on a timeout names the step and the faster effort', async () => {
    const opening = await opened();
    generate.mockRejectedValue(new DOMException('The provider request timed out.', 'TimeoutError'));
    const run = async () =>
      checks.request(
        { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
        1,
      );
    await expect(run()).rejects.toThrow(
      'Muse Spark timed out after 240 s reading the job, so nothing was graded. Run the check again, or choose Minimal under Reasoning effort for Meta in Settings → Models to answer faster.',
    );
    expect((generate.mock.calls[0]![7] as GenerateOptions).timeout).toBe(240_000);
    expect(JSON.parse(checks.handoff(opening.id)?.record ?? '{}')).toEqual({});
    // already at the fastest effort, nothing faster is offered
    providers = [{ ...meta, effort: 'minimal' }];
    await expect(run()).rejects.toThrow(
      /^Muse Spark timed out after 240 s reading the job, so nothing was graded\. Run the check again\.$/,
    );
  });

  it('refuses an answer that does not fit the schema, keeping what came back in the record', async () => {
    const opening = await opened();
    generate.mockResolvedValue({
      summary: 'No findings.',
      request: [],
      findings: [],
      tour: 'none',
    });
    await expect(
      checks.request(
        { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
        1,
      ),
    ).rejects.toThrow(
      'Meta’s answer does not fit the check’s form at tour, so nothing was graded.',
    );
  });
});

describe('a job’s files', () => {
  /** A folder holding `files`: each copied from Job 1042, or a few bytes when it is not there. */
  async function job(name: string, files: readonly string[]): Promise<string> {
    const made = path.join(root, name);
    for (const file of files) {
      const target = path.join(made, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(folder, path.basename(file)), target).catch(() =>
        writeFile(target, 'not a drawing'),
      );
    }
    return made;
  }
  const open = (paths: string[], owner = 1) => checks.request({ kind: 'open', paths }, owner);

  it('reads the folders in a job one level down, but not its handoff or a deeper folder', async () => {
    const parts = await job('Job 2001', [
      'Job 1042 request.eml',
      'Job 1042 drawing.pdf',
      'DXF/g6-PL60-B2-2buc.dxf',
      'DXF/g3-CV25-E1-10buc.dxf',
      'DXF/Bracket.dwg',
      'DXF/Old/g6-PL60-B2-2buc.dxf',
      'Job 2001 handoff/Check record.json',
    ]);
    const reply = await open([parts]);
    if (reply.kind !== 'opened') throw new Error('Expected an inventory.');
    expect(reply.sources.map((source) => [source.ref, source.name, source.path])).toEqual([
      ['S1', 'Job 1042 request.eml', path.join(parts, 'Job 1042 request.eml')],
      ['S2', 'Job 1042 drawing.pdf', path.join(parts, 'Job 1042 drawing.pdf')],
      ['S3', 'g3-CV25-E1-10buc.dxf', path.join(parts, 'DXF', 'g3-CV25-E1-10buc.dxf')],
      ['S4', 'g6-PL60-B2-2buc.dxf', path.join(parts, 'DXF', 'g6-PL60-B2-2buc.dxf')],
    ]);
    expect(reply.skipped).toEqual(
      expect.arrayContaining([
        { name: 'Job 2001 handoff', reason: 'a handoff a check saved' },
        { name: 'DXF/Bracket.dwg', reason: 'a DWG; Viewer measures DXF only' },
        { name: 'DXF/Old', reason: 'a folder in a folder; the check looks one level down' },
      ]),
    );
    expect(reply.skipped).toHaveLength(3);
  });

  it('checks DXF parts without a request or drawing by their names and measurements', async () => {
    const parts = await job('Parts', ['g6-PL60-B2-2buc.dxf', 'g3-CV25-E1-10buc.dxf']);
    const reply = await open([parts]);
    if (reply.kind !== 'opened') throw new Error('Expected an inventory.');
    expect(reply.sources.map((source) => [source.kind, source.sending])).toEqual([
      ['dxf', 'measurement'],
      ['dxf', 'measurement'],
    ]);
    generate.mockResolvedValue({
      summary: 'Both parts agree.',
      request: [],
      findings: [],
      tour: [],
    });
    const result = await checks.request(
      { kind: 'run', id: reply.id, providerID: meta.id, pages: [] },
      1,
    );
    expect(result).toMatchObject({ kind: 'result', findings: [], summary: 'Both parts agree.' });
  });

  it('says plainly when a folder has nothing to check, naming it', async () => {
    const pictures = await job('Pictures', ['Plate.jpg', 'Album/Plate.jpg']);
    expect(await open([pictures])).toEqual({
      kind: 'nothing',
      folder: pictures,
      job: 'Pictures',
      text: 'Pictures and its folder hold no DXF or DWG file, so there is nothing to check.',
    });
    const drawings = await job('Drawings', ['Bracket.dwg', 'Plate.dwg']);
    expect(await open([drawings])).toMatchObject({
      kind: 'nothing',
      text: 'Drawings holds 2 DWG files and no DXF. Viewer measures DXF only: save them as DXF from the CAD app, then check again.',
    });
    const clients = await job('Clients', [
      'Job A/Job 1042 request.eml',
      'Job A/g6-PL60-B2-2buc.dxf',
      'Job B/Job 1042 request.eml',
      'Job B/g3-CV25-E1-10buc.dxf',
    ]);
    expect(await open([clients])).toMatchObject({
      kind: 'nothing',
      text: 'Clients holds Job A and Job B. Check one of them.',
    });
    // a job beside a folder of parts: neither is read into the other
    const fabrication = await job('fabrication', [
      'Job 1042/Job 1042 request.eml',
      'Job 1042/g6-PL60-B2-2buc.dxf',
      'Evaluation/g3-CV25-E1-10buc.dxf',
      'Evaluation/g6-FL80-C1-2buc.dxf',
    ]);
    expect(await open([fabrication])).toMatchObject({
      kind: 'nothing',
      text: 'fabrication holds Job 1042 and Evaluation. Check one of them.',
    });
  });

  it('says what changed in the job since the check listed it, but not the copy a correction saved', async () => {
    const opening = await opened();
    const changes = () => checks.request({ kind: 'changes', id: opening.id }, 1);
    expect(await changes()).toEqual({ kind: 'changes', id: opening.id, changes: [] });
    await writeFile(path.join(folder, 'g6-PL60-B2-2buc (corrected).dxf'), 'corrected');
    expect(await changes()).toMatchObject({ changes: [] });
    await appendFile(path.join(folder, 'g6-PL60-B2-2buc.dxf'), '\n');
    await copyFile(
      path.join(folder, 'g6-MB20-A1-4buc.dxf'),
      path.join(folder, 'g6-MB20-A2-4buc.dxf'),
    );
    expect(await changes()).toMatchObject({
      changes: [
        { name: 'g6-PL60-B2-2buc.dxf', change: 'changed' },
        { name: 'g6-MB20-A2-4buc.dxf', change: 'added' },
      ],
    });
    await expect(checks.request({ kind: 'changes', id: opening.id }, 2)).rejects.toThrow(
      'This check was closed.',
    );
  });

  it('keeps a window’s last eight checks, closing its oldest past them', async () => {
    const first = await opened();
    for (let count = 0; count < 7; count++) await opened();
    await expect(checks.request({ kind: 'changes', id: first.id }, 1)).resolves.toMatchObject({
      kind: 'changes',
    });
    // another window's checks do not count
    await open([folder], 2);
    await opened();
    await expect(checks.request({ kind: 'changes', id: first.id }, 1)).rejects.toThrow(
      'This check was closed.',
    );
  });
});
