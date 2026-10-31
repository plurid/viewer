import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckOpening, CheckResult } from '../src/domain/fabrication/check';
import { checkDocumentSchema } from '../src/domain/fabrication/check-document';
import { defaultSettings } from '../src/domain/services';
import { FabricationChecks } from '../src/desktop/fabrication/service';
import type { FabricationPorts } from '../src/desktop/fabrication/service';
import { CheckStore } from '../src/desktop/fabrication/check-store';
import { Operations } from '../src/desktop/operations/operations';
import { handoffOperation } from '../src/domain/fabrication/handoff';
import { temporaryRoot } from '../tools/temporary';
import { allowed, drawingPage, jobAnswer, jpeg, meta, writeJob } from './fabrication-fixtures';

let root: string, folder: string;
const instances: FabricationChecks[] = [];
const generate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const operate = vi.fn(() => randomUUID());
const progress = vi.fn();
function service(ports: Partial<FabricationPorts> = {}) {
  const checks = new FabricationChecks({
    dataPath: path.join(root, 'private'),
    settings: () => ({ ...defaultSettings(root), providers: [meta] }),
    access: async () => {},
    permission: async () => allowed('images'),
    generate: (...args) => generate(...args),
    encodePhoto: async () => Buffer.from(jpeg(1600, 1200)),
    operate,
    progress,
    ...ports,
  });
  instances.push(checks);
  return checks;
}
beforeEach(async () => {
  root = await temporaryRoot('viewer-durable-check-');
  folder = path.join(root, 'Job 1042');
  await writeJob(folder);
  generate.mockReset();
  operate.mockClear();
  progress.mockClear();
});
afterEach(async () => {
  await Promise.all(instances.splice(0).map((checks) => checks.close()));
});

async function open(checks: FabricationChecks): Promise<CheckOpening> {
  const reply = await checks.request({ kind: 'open', paths: [folder] }, 1);
  if (reply.kind !== 'opened') throw new Error('Expected inventory.');
  return reply;
}
async function run(
  checks: FabricationChecks,
  opening: CheckOpening,
  unquoted = false,
): Promise<CheckResult> {
  const answer = jobAnswer(opening);
  if (unquoted) answer.findings[0]!.drawing!.quote = null;
  generate.mockResolvedValue(answer);
  const result = await checks.request(
    { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
    1,
  );
  if (result.kind !== 'result') throw new Error('Expected result.');
  return result;
}

describe('durable fabrication checks', () => {
  it('reopens a paid result, source provenance and operation IDs without contacting the model', async () => {
    const first = service(),
      opening = await open(first);
    await run(first, opening);
    const operation = await first.request({ kind: 'correct', id: opening.id, finding: 'F1' }, 1);
    expect(operation.kind).toBe('operation');
    const handoff = randomUUID();
    await first.rememberOperation(
      handoffOperation({
        check: opening.id,
        folder,
        job: opening.job,
        files: opening.sources,
        nestings: [],
      }),
      handoff,
    );
    await first.close();
    const second = service();
    const list = await second.request({ kind: 'list', paths: [folder] }, 2);
    expect(list).toMatchObject({
      kind: 'checks',
      checks: [{ id: opening.id, status: 'completed' }],
    });
    const [saved] = await Promise.all([
      second.request({ kind: 'read', id: opening.id }, 2),
      second.request({ kind: 'read', id: opening.id }, 3),
    ]);
    expect(saved).toMatchObject({
      kind: 'saved',
      paths: [folder],
      status: 'completed',
      changes: [],
      result: { findings: [{ grade: { requirement: { status: 'source-verified', value: 50 } } }] },
      corrections: { F1: operation.kind === 'operation' ? operation.id : '' },
      handoffs: [handoff],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    const result = await second.request({ kind: 'validate', id: opening.id }, 2);
    expect(result).toMatchObject({
      kind: 'result',
      findings: [{ grade: { requirement: { status: 'source-verified' } } }],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(second.request({ kind: 'validate', id: opening.id }, 3)).resolves.toMatchObject({
      kind: 'result',
    });
  });

  it('confirms an unresolved requirement explicitly and uses that canonical target without another model call', async () => {
    const checks = service(),
      opening = await open(checks);
    const initial = await run(checks, opening, true);
    expect(initial.findings[0]?.correction).toBeUndefined();
    expect(initial.findings[0]?.grade.requirement?.status).toBe('unverified');
    const confirmed = await checks.request(
      { kind: 'confirm', id: opening.id, key: 'finding:F1', value: 51, unit: 'mm' },
      1,
    );
    expect(confirmed).toMatchObject({
      kind: 'result',
      findings: [
        {
          grade: {
            requirement: { status: 'human-confirmed', value: 51, confirmedAt: expect.any(Number) },
          },
          correction: { plan: { target: 51, review: { check: opening.id, finding: 'F1' } } },
        },
      ],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    await checks.request({ kind: 'correct', id: opening.id, finding: 'F1' }, 1);
    expect(operate).toHaveBeenLastCalledWith(
      expect.objectContaining({ transform: expect.objectContaining({ target: 51 }) }),
    );
    const drawing = opening.sources.find((source) => source.kind === 'drawing')!;
    await appendFile(drawing.path, '\nchanged');
    await expect(
      checks.request({ kind: 'correct', id: opening.id, finding: 'F1' }, 1),
    ).rejects.toThrow('changed since this check');
    await expect(checks.prepareHandoff(opening.id)).rejects.toThrow('changed since this check');
    expect(operate).toHaveBeenCalledTimes(1);
    const saved = await checks.request({ kind: 'read', id: opening.id }, 1);
    expect(saved).toMatchObject({
      kind: 'saved',
      changes: [{ name: drawing.name, change: 'changed' }],
    });
  });

  it('refuses spoofed correction targets and unrecognized confirmation keys and units', async () => {
    const checks = service(),
      opening = await open(checks);
    const result = await run(checks, opening);
    const correction = result.findings[0]!.correction!;
    await checks.authorizeCorrection(correction.plan, [correction.source]);
    await expect(
      checks.authorizeCorrection({ ...correction.plan, target: 500 }, [correction.source]),
    ).rejects.toThrow('no longer matches');
    const { review: _review, ...unbound } = correction.plan;
    await expect(checks.authorizeCorrection(unbound, [correction.source])).rejects.toThrow(
      'reviewed fabrication check',
    );
    await expect(
      checks.request(
        { kind: 'confirm', id: opening.id, key: 'finding:F99', value: 50, unit: 'mm' },
        1,
      ),
    ).rejects.toThrow('no longer part');
    await expect(
      checks.request(
        { kind: 'confirm', id: opening.id, key: 'finding:F1', value: 50, unit: 'pieces' },
        1,
      ),
    ).rejects.toThrow();
    await expect(
      checks.request(
        { kind: 'confirm', id: opening.id, key: 'finding:F1', value: 50, unit: 'mm' },
        2,
      ),
    ).rejects.toThrow('Open this saved check');
  });

  it('verifies the PDF itself when rendered page text invents a different requirement', async () => {
    const checks = service(),
      opening = await open(checks);
    const page = await drawingPage(opening);
    const answer = jobAnswer(opening);
    const claim = answer.findings[0]!.drawing!;
    claim.value = 75;
    claim.quote = 'Horizontal pitch: 75 mm';
    page.text = [{ text: claim.quote, box: [0.1, 0.1, 0.9, 0.2] }];
    generate.mockResolvedValue(answer);
    const result = await checks.request(
      { kind: 'run', id: opening.id, providerID: meta.id, pages: [page] },
      1,
    );
    if (result.kind !== 'result') throw new Error('Expected result.');
    expect(result.findings[0]?.grade.requirement?.status).toBe('unverified');
    expect(result.findings[0]?.correction).toBeUndefined();
    await expect(
      checks.request({ kind: 'correct', id: opening.id, finding: 'F1' }, 1),
    ).rejects.toThrow();
    expect(operate).not.toHaveBeenCalled();
    const stored = await new CheckStore(path.join(root, 'private', 'fabrication-checks')).read(
      opening.id,
    );
    expect(stored?.verification?.texts[`${page.ref}:1`]).not.toContain('Horizontal pitch: 75 mm');
    expect(stored?.verification?.texts[`${page.ref}:1`]).toContain('50');
  });

  it('detaches a view without cancelling the paid request', async () => {
    const checks = service(),
      opening = await open(checks);
    let complete!: (answer: unknown) => void;
    const started = new Promise<void>((ready) => {
      generate.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
            ready();
          }),
      );
    });
    const pending = checks.request(
      { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
      1,
    );
    await started;
    await checks.request({ kind: 'close', id: opening.id }, 1);
    await checks.request({ kind: 'read', id: opening.id }, 2);
    complete(jobAnswer(opening));
    await expect(pending).resolves.toMatchObject({ kind: 'result' });
    expect(await checks.request({ kind: 'read', id: opening.id }, 2)).toMatchObject({
      kind: 'saved',
      status: 'completed',
    });
    expect(progress).toHaveBeenCalledWith(2, {
      id: opening.id,
      step: 'settled',
      text: 'Check completed.',
    });
    expect(progress).not.toHaveBeenCalledWith(1, expect.objectContaining({ step: 'settled' }));
  });

  it('cancels only on explicit Cancel and does not publish a late provider response', async () => {
    const checks = service(),
      opening = await open(checks);
    let complete!: (answer: unknown) => void;
    const started = new Promise<void>((ready) => {
      generate.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
            ready();
          }),
      );
    });
    const pending = checks.request(
      { kind: 'run', id: opening.id, providerID: meta.id, pages: [await drawingPage(opening)] },
      1,
    );
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await started;
    await checks.request({ kind: 'cancel', id: opening.id }, 1);
    complete(jobAnswer(opening));
    await rejected;
    const saved = await checks.request({ kind: 'read', id: opening.id }, 1);
    expect(saved).toMatchObject({ kind: 'saved', status: 'cancelled' });
    expect(saved).not.toHaveProperty('result');
    expect(progress).toHaveBeenCalledWith(1, {
      id: opening.id,
      step: 'settled',
      text: 'Check cancelled.',
    });
  });

  it('starts one paid run when two views request it while permission is resolving', async () => {
    let permit!: () => void;
    let waiting = false;
    const permission = new Promise<void>((resolve) => {
      permit = resolve;
    });
    const checks = service({
      permission: async () => {
        if (waiting) await permission;
        return allowed('images');
      },
    });
    const opening = await open(checks);
    waiting = true;
    generate.mockResolvedValue(jobAnswer(opening));
    const request = {
      kind: 'run' as const,
      id: opening.id,
      providerID: meta.id,
      pages: [await drawingPage(opening)],
    };
    const first = checks.request(request, 1);
    const duplicate = expect(checks.request(request, 1)).rejects.toThrow('already running');
    permit();
    await duplicate;
    await expect(first).resolves.toMatchObject({ kind: 'result' });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('restores an interrupted request without replaying it and keeps legacy results inspection-only', async () => {
    const first = service(),
      opening = await open(first);
    await run(first, opening);
    await first.close();
    const directory = path.join(root, 'private', 'fabrication-checks');
    const store = new CheckStore(directory);
    const document = (await store.read(opening.id))!;
    await store.save({ ...document, status: 'running' });
    const second = service();
    expect(await second.request({ kind: 'read', id: opening.id }, 2)).toMatchObject({
      kind: 'saved',
      status: 'interrupted',
    });
    expect(generate).toHaveBeenCalledTimes(1);
    await second.close();
    const { verification: _verification, ...legacy } = (await store.read(opening.id))!;
    await store.save({ ...legacy, status: 'completed' });
    const third = service();
    expect(await third.request({ kind: 'read', id: opening.id }, 3)).toMatchObject({
      kind: 'saved',
      result: { kind: 'result' },
    });
    await expect(
      third.request({ kind: 'correct', id: opening.id, finding: 'F1' }, 3),
    ).rejects.toThrow('older result');
    const bytes = await readFile(path.join(directory, `${opening.id}.json`), 'utf8');
    expect(checkDocumentSchema.safeParse(JSON.parse(bytes)).success).toBe(true);
    expect(bytes).not.toContain('apiKey');
  });

  it('revalidates requirement documents immediately before publishing a corrected copy', async () => {
    const checks = service(),
      opening = await open(checks);
    const result = await run(checks, opening);
    const correction = result.findings[0]!.correction!;
    const drawing = opening.sources.find((source) => source.kind === 'drawing')!;
    const original = await readFile(correction.source);
    const validateReview = vi.fn(async (plan, sources) =>
      checks.authorizeCorrection(plan, sources),
    );
    const operations = new Operations(
      async () => {
        throw new Error('No removal is authorized.');
      },
      () => {},
      undefined,
      undefined,
      undefined,
      path.join(root, 'operations'),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        validateReview,
        execute: async (_plan, _sources, output) => {
          await writeFile(output, original, { flag: 'wx' });
          await appendFile(drawing.path, '\nrequirement changed while staging');
        },
      },
    );
    try {
      const id = operations.start({
        kind: 'convert',
        sources: [correction.source],
        destination: folder,
        name: correction.name,
        transform: correction.plan,
        expectedSources: [{ path: correction.source, version: correction.version }],
      });
      await vi.waitFor(() =>
        expect(operations.all().find((job) => job.id === id)?.status).toBe('failed'),
      );
      expect(validateReview).toHaveBeenCalledOnce();
      expect(operations.all().find((job) => job.id === id)?.errors).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('changed since this check') }),
      );
      await expect(readFile(path.join(folder, correction.name))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(correction.source)).toEqual(original);
    } finally {
      await operations.close();
    }
  });
});
