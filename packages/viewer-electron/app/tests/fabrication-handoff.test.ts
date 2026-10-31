/**
 * THE HANDOFF: a checked job saved for the shop through File operations, staged and undoable:
 * `Evidence/` copies with their dates, the tour pointed at them, the check record, and each
 * thickness's nesting under `Cut sheets/` as the Layout plane saves it.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckOpening } from '../src/domain/fabrication/check';
import type { HandoffNesting } from '../src/domain/fabrication/handoff';
import type { NestingTransform } from '../src/domain/layout/nesting/plan';
import type { OperationJob } from '../src/domain/contracts';
import { FabricationChecks } from '../src/desktop/fabrication/service';
import { Operations } from '../src/desktop/operations/operations';
import { Transforms } from '../src/desktop/transforms/transforms';
import { entry } from '../src/desktop/files/filesystem';
import { tourDefinitionSchema, sameRecordedFile, stopState } from '../src/domain/tours/tour';
import { Tours } from '../src/desktop/workspaces/tours';
import { sourceVersion } from '../src/domain/files/inspection';
import {
  chooseNestings,
  evidenceNames,
  handoffOperation,
  handoffTour,
  nestingHold,
} from '../src/domain/fabrication/handoff';
import { transformDescription, validateTransform } from '../src/domain/operations/transforms';
import { readCutDrawing } from '../src/domain/layout/nesting/drawing';
import { extractParts } from '../src/domain/layout/nesting/parts';
import { cuttingPresets, nestingDefaults } from '../src/domain/layout/nesting/plan';
import { nestProblem } from '../src/domain/layout/nesting/problem';
import { nestSearch } from '../src/domain/layout/nesting/search';
import { decodeDefinition } from '../src/desktop/persistence/definition-files';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import { allowed, drawingPage, jobAnswer, jpeg, meta, writeJob } from './fabrication-fixtures';

const version = { identity: '1:2', modified: 1_761_800_000_000, size: 10 };
const file = (name: string) => ({ path: `/jobs/1042/${name}`, version });

describe('handoff plans', () => {
  it('names each file once, copies the job and nests from the same sources', () => {
    const nesting: HandoffNesting = {
      title: 'Nesting of 2 parts, 3 mm',
      sources: [file('g3-GS30-D1-6buc.dxf'), file('g3-CV25-E1-10buc.dxf')],
      plan: { sources: [{}, {}], sheets: [{}] } as unknown as NestingTransform,
    };
    const request = handoffOperation({
      check: '9b2f7c3e-1d2a-4c5b-8e6f-7a8b9c0d1e2f',
      folder: '/jobs/1042',
      job: 'Job 1042',
      files: [file('Job 1042 request.eml'), file('g3-CV25-E1-10buc.dxf')],
      nestings: [nesting],
    });
    expect(request).toMatchObject({
      kind: 'convert',
      destination: '/jobs/1042',
      name: 'Job 1042 handoff',
      sources: [
        '/jobs/1042/Job 1042 request.eml',
        '/jobs/1042/g3-CV25-E1-10buc.dxf',
        '/jobs/1042/g3-GS30-D1-6buc.dxf',
      ],
      transform: { kind: 'fabrication-handoff', format: 'folder', evidence: [0, 1] },
    });
    expect(request.transform.nestings[0]!.sources).toEqual([2, 1]);
    expect(request.expectedSources).toHaveLength(3);
  });

  it('keeps out a nesting of a drawing since corrected, and gives the thickness not nested', () => {
    const plate = file('g6-PL60-B2-2buc.dxf');
    const corrected = file('g6-PL60-B2-2buc (corrected).dxf');
    const nesting = (title: string, sources: { path: string; version: typeof version }[]) => ({
      title,
      sources,
      plan: {} as NestingTransform,
    });
    const { nestings, notes, missing } = chooseNestings(
      [
        nesting('Nesting of 1 part, 6 mm', [plate]),
        nesting('Nesting of 1 part, 3 mm', [file('g3-CV25-E1-10buc.dxf')]),
        nesting('Nesting of 1 part, 4 mm', [file('Other job.dxf')]),
      ],
      [corrected.path, '/jobs/1042/g3-CV25-E1-10buc.dxf'],
      new Map([[plate.path, corrected.path]]),
    );
    expect(nestings.map((item) => item.title)).toEqual(['Nesting of 1 part, 3 mm']);
    expect(notes).toEqual([
      '“Nesting of 1 part, 6 mm” nests g6-PL60-B2-2buc.dxf, not its corrected copy, so it is left out.',
    ]);
    // the thickness the export nests first
    expect(missing.map((group) => [group.label, group.items])).toEqual([
      ['6 mm', [corrected.path]],
    ]);
  });

  it('cuts no drawing twice, and groups by the thickness the plane was opened with', () => {
    const nesting = (title: string, names: string[]) => ({
      title,
      sources: names.map(file),
      plan: {} as NestingTransform,
    });
    const cover = '/jobs/1042/g3-CV25-E1-10buc.dxf';
    const gusset = '/jobs/1042/g3-GS30-D1-6buc.dxf';
    // the plane nested the cover alone, then both: the newer one is saved
    const { nestings, missing } = chooseNestings(
      [
        nesting('Nesting of 1 part, 3 mm', ['g3-CV25-E1-10buc.dxf']),
        nesting('Nesting of 2 parts, 3 mm', ['g3-CV25-E1-10buc.dxf', 'g3-GS30-D1-6buc.dxf']),
      ],
      [cover, gusset, '/jobs/1042/Spacer.dxf'],
      new Map(),
      // the request gives the spacer's thickness, which its name does not
      (path) => (path.endsWith('Spacer.dxf') ? 4 : undefined),
    );
    expect(nestings.map((item) => item.title)).toEqual(['Nesting of 2 parts, 3 mm']);
    expect(missing.map((group) => group.label)).toEqual(['4 mm']);
  });

  it('nests for the export only what the job gives, and says which part waits for a person', () => {
    const groups = (thickness?: number) => [
      {
        key: thickness === undefined ? 'unknown' : String(thickness),
        ...(thickness === undefined ? {} : { thickness }),
        label: thickness === undefined ? 'Thickness not in name' : `${thickness} mm`,
        items: ['/jobs/1042/g6-MB20-A1-4buc.dxf', '/jobs/1042/g6-PL60-B2-2buc.dxf'],
      },
    ];
    const plate = { cut: '/jobs/1042/g6-PL60-B2-2buc.dxf', quantity: { sets: 2 } };
    expect(nestingHold([plate, { ...plate, cut: groups(6)[0]!.items[0]! }], groups(6))).toBe(
      undefined,
    );
    expect(
      nestingHold(
        [{ cut: '/jobs/1042/g6-MB20-A1-4buc.dxf', question: 'How many sets?' }, plate],
        groups(6),
      ),
    ).toBe(
      'How many sets of g6-MB20-A1-4buc.dxf to cut is open, so Viewer does not nest it for the export. Prepare the cut sheets and set it in the Layout plane, then export once its tab says Checked.',
    );
    expect(nestingHold([{ cut: '/jobs/1042/g6-MB20-A1-4buc.dxf' }, plate], groups(undefined))).toBe(
      'Nothing in the job gives the quantity or thickness of g6-MB20-A1-4buc.dxf. Nothing in the job gives the thickness of g6-PL60-B2-2buc.dxf, so Viewer does not nest them for the export. Prepare the cut sheets and set them in the Layout plane, then export once its tab says Checked.',
    );
  });

  it('points the tour at the copies, numbering a name an earlier copy has', () => {
    expect(evidenceNames(['Plate.jpg', 'plate.jpg', 'Drawing.pdf', 'Plate.jpg'])).toEqual([
      'Plate.jpg',
      'plate 2.jpg',
      'Drawing.pdf',
      'Plate 3.jpg',
    ]);
    const { definition, skipped } = handoffTour(
      {
        version: 1,
        name: 'Job 1042',
        stops: [
          {
            id: 'stop-1',
            caption: 'The drawing',
            source: 'model',
            target: { kind: 'file', path: 'Drawing.pdf', version },
          },
          {
            id: 'stop-2',
            caption: 'A photo left behind',
            source: 'model',
            target: { kind: 'file', path: 'Photos/Plate.jpg', version },
          },
        ],
      },
      '/jobs/1042',
      new Map([['/jobs/1042/Drawing.pdf', 'Drawing.pdf']]),
    );
    expect(definition!.stops.map((stop) => stop.target)).toEqual([
      { kind: 'file', path: 'Evidence/Drawing.pdf', version },
    ]);
    expect(skipped).toEqual(['A photo left behind: Plate.jpg is not in the handoff.']);
  });
});

const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`);
const qpdf = path.resolve(
  'assets',
  `viewer-optimizers-${process.platform}-${process.arch}`,
  'qpdf',
);

let root: string;
let folder: string;
let checks: FabricationChecks;
let operations: Operations;
let opening: CheckOpening;
beforeEach(async () => {
  root = await temporaryRoot('viewer-fabrication-handoff-');
  folder = path.join(root, 'Job 1042');
  await writeJob(folder);
  checks = new FabricationChecks({
    settings: () => ({ ...defaultSettings(root), providers: [meta] }),
    access: async () => {},
    permission: async () => allowed('images'),
    generate: async () => jobAnswer(opening),
    encodePhoto: async () => Buffer.from(jpeg(1600, 1200)),
  });
  const reply = await checks.request({ kind: 'open', paths: [folder] }, 1);
  if (reply.kind !== 'opened') throw new Error('Expected an inventory.');
  opening = reply;
  const transforms = new Transforms(
    processors,
    async () => {},
    async () => Buffer.alloc(0),
    undefined,
    {},
    (id, plan, sources) => checks.prepareHandoff(id, plan, sources),
  );
  operations = new Operations(
    async () => {
      throw new Error('Nothing goes to the Trash in this test.');
    },
    () => {},
    undefined,
    undefined,
    undefined,
    path.join(root, 'private'),
    undefined,
    undefined,
    undefined,
    undefined,
    transforms,
  );
});
afterEach(async () => {
  await operations.close();
  checks.close();
});

async function finished(id: string): Promise<OperationJob> {
  await vi.waitFor(
    () =>
      expect(
        ['completed', 'failed', 'cancelled'].includes(
          operations.all().find((job) => job.id === id)!.status,
        ),
      ).toBe(true),
    { timeout: 20000, interval: 20 },
  );
  return operations.all().find((job) => job.id === id)!;
}
function nestingOf(names: readonly string[]): Promise<HandoffNesting> {
  return Promise.all(names.map((name) => entry(path.join(folder, name)))).then(async (entries) => {
    const read = await Promise.all(
      entries.map(async (item) => ({
        item,
        parts: extractParts(
          readCutDrawing(await readFile(item.path, 'utf8')),
          { scale: 1, marks: new Set(), together: false },
          item.name.replace(/\.dxf$/i, ''),
        ).parts,
      })),
    );
    const format = { ...nestingDefaults.sheet, price: 0 };
    const quantities = [10, 6];
    const problem = nestProblem(
      read.map(({ parts }, index) => ({
        part: parts[0]!,
        choice: {
          quantity: quantities[index]!,
          rotation: 'quarter' as const,
          mirror: false,
          grain: false,
        },
      })),
      [format],
      { margin: 10, spacing: 5 },
    );
    let best;
    for (const update of nestSearch(problem, { budget: 200, now: () => performance.now() }))
      best = update.best ?? best;
    const title = 'Nesting of 2 parts, 3 mm';
    return {
      title,
      sources: read.map(({ item }) => ({ path: item.path, version: sourceVersion(item) })),
      plan: {
        kind: 'nesting',
        format: 'dxf',
        title,
        sources: read.map(() => ({ units: 4, together: false, marks: [] })),
        parts: read.map(({ parts }, index) => ({
          source: index,
          index: 0,
          name: parts[0]!.name,
          quantity: quantities[index]!,
          width: parts[0]!.width,
          height: parts[0]!.height,
          area: parts[0]!.area,
        })),
        formats: [format],
        sheets: best!.layout.sheets.map((sheet) => ({
          format: sheet.format,
          placements: sheet.placements,
        })),
        margin: 10,
        spacing: 5,
        cutting: { ...cuttingPresets[0]!, thickness: 3, rate: 90, currency: '€' },
        labels: true,
      },
    };
  });
}

describe('handoff export', () => {
  it('saves the evidence, the tour pointed at it and the check record, staged and undoable', async () => {
    const run = await checks.request(
      { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
      1,
    );
    expect(run.kind).toBe('result');
    const request = handoffOperation({
      check: opening.id,
      folder: opening.folder,
      job: opening.job,
      files: opening.sources.map((source) => ({ path: source.path, version: source.version })),
      nestings: [],
    });
    expect(transformDescription(validateTransform(request.transform, request.sources.length))).toBe(
      'Handoff folder · no cut sheets · 8 files copied as evidence · the tour and the check record',
    );
    const job = await finished(operations.start(request));
    const output = path.join(folder, 'Job 1042 handoff');
    expect(job).toMatchObject({
      status: 'completed',
      undoable: true,
      completed: [{ destination: output }],
    });
    expect((await readdir(output)).sort()).toEqual([
      'Check record.json',
      'Evidence',
      'Job.viewer-tour.jsonc',
    ]);
    expect((await readdir(path.join(output, 'Evidence'))).sort()).toEqual(
      opening.sources.map((source) => source.name).sort(),
    );
    const tour = decodeDefinition(
      await readFile(path.join(output, 'Job.viewer-tour.jsonc'), 'utf8'),
      tourDefinitionSchema,
      'Tour',
    );
    expect(tour.stops.map((stop) => stop.target.kind === 'file' && stop.target.path)).toEqual([
      'Evidence/Job 1042 request.eml',
      'Evidence/Job 1042 drawing.pdf',
      'Evidence/g6-PL60-B2-2buc.dxf',
      'Evidence/Plate.jpg',
    ]);
    // each copy keeps its size and date, so the tour plays from the shop's copy unchanged
    for (const stop of tour.stops) {
      if (stop.target.kind !== 'file') continue;
      const copy = await stat(path.join(output, stop.target.path));
      expect(
        sameRecordedFile(stop.target.version, {
          identity: '',
          size: copy.size,
          modified: copy.mtimeMs,
        }),
        stop.target.path,
      ).toBe(true);
    }
    // and its bytes: each stop carries the hash the check read, which the copy has, so the
    // tour finds it unchanged even where a zip moved its date
    const tours = new Tours(async () => {});
    for (const stop of tour.stops) {
      if (stop.target.kind !== 'file') continue;
      const bytes = await readFile(path.join(output, stop.target.path));
      expect(stop.target.version.sha256, stop.target.path).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
      const found = await tours.stat(output, stop.target.path, true);
      if (found.state !== 'found') throw new Error(`${stop.target.path} was not found.`);
      const moved = { ...sourceVersion(found.entry), modified: found.entry.modified + 3_600_000 };
      expect(stopState(stop, { file: { ...moved, sha256: found.sha256 } })).toBe('ready');
    }
    const record = JSON.parse(await readFile(path.join(output, 'Check record.json'), 'utf8'));
    expect(record).toMatchObject({ job: 'Job 1042', validation: { valid: true } });
    expect(JSON.stringify(record)).not.toContain(root);
  });

  it('refuses a handoff before the check has finished', async () => {
    const request = handoffOperation({
      check: opening.id,
      folder: opening.folder,
      job: opening.job,
      files: opening.sources.map((source) => ({ path: source.path, version: source.version })),
      nestings: [],
    });
    const job = await finished(operations.start(request));
    expect(job.status).toBe('failed');
    expect(job.errors[0]!.message).toBe(
      'This older result has no verified source record. Run the check again before correcting or exporting.',
    );
    expect(existsSync(path.join(folder, 'Job 1042 handoff'))).toBe(false);
  });

  it.skipIf(!(process.platform === 'darwin' && existsSync(qpdf)))(
    'saves each nesting under Cut sheets as the Layout plane saves it',
    async () => {
      await checks.request(
        { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
        1,
      );
      const nesting = await nestingOf(['g3-CV25-E1-10buc.dxf', 'g3-GS30-D1-6buc.dxf']);
      const job = await finished(
        operations.start(
          handoffOperation({
            check: opening.id,
            folder: opening.folder,
            job: opening.job,
            files: opening.sources.map((source) => ({
              path: source.path,
              version: source.version,
            })),
            nestings: [nesting],
          }),
        ),
      );
      expect(job.status).toBe('completed');
      const sheets = path.join(
        folder,
        'Job 1042 handoff',
        'Cut sheets',
        'Nesting of 2 parts, 3 mm',
      );
      expect((await readdir(sheets)).sort()).toEqual(
        [
          ...nesting.plan.sheets.map((_, index) => `Sheet ${index + 1}.dxf`),
          'Parts.csv',
          'Report.pdf',
        ].sort(),
      );
    },
  );
});
