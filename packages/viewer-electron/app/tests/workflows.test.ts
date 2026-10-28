import { describe, it, expect, vi } from 'vitest';
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { Workflows } from '../src/desktop/automation/workflows';
import { Comparisons } from '../src/desktop/comparison/comparison';
import { Checkpoints } from '../src/desktop/operations/checkpoints';
import { OperationPlans } from '../src/desktop/operations/operation-plans';
import { Operations } from '../src/desktop/operations/operations';
import { inspectFile } from '../src/desktop/files/inspection';
import {
  workflowDefinitionSchema,
  type WorkflowDocument,
  type WorkflowRun,
} from '../src/domain/automation/workflows';
import type { OperationPlan } from '../src/domain/operations/operation-plan';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
const definition = () =>
  workflowDefinitionSchema.parse({
    version: 1,
    id: 'inspect-copy',
    name: 'Inspect and copy',
    bindings: [{ name: 'output', label: 'Output folder' }],
    inputs: { source: { path: 'Source.txt' }, destination: { binding: 'output', path: '.' } },
    steps: [
      {
        id: 'inspect',
        kind: 'inspect',
        sources: [{ kind: 'input', name: 'source' }],
        content: true,
      },
      {
        id: 'copy',
        kind: 'copy',
        needs: ['inspect'],
        sources: [{ kind: 'step', id: 'inspect' }],
        destination: { kind: 'input', name: 'destination' },
      },
      {
        id: 'verify',
        kind: 'inspect',
        needs: ['copy'],
        sources: [{ kind: 'step', id: 'copy' }],
        content: true,
      },
    ],
  });
async function fixture(overrides: Partial<ConstructorParameters<typeof Workflows>[1]> = {}) {
  const root = await temporaryRoot('viewer-workflow-');
  const profile = path.join(root, 'Profile'),
    destination = path.join(root, 'Destination');
  await mkdir(destination);
  await writeFile(path.join(root, 'Source.txt'), 'Original Unicode 模型');
  const operations = new Operations(
    (file) => rename(file, path.join(root, 'Trash-' + path.basename(file))),
    () => {},
    undefined,
    undefined,
    undefined,
    profile,
  );
  const access = vi.fn(async (_paths: readonly string[]) => {});
  const checkpoints = new Checkpoints(path.join(profile, 'checkpoints'), access, () => 10485760);
  const plans = new OperationPlans(profile, operations, checkpoints, access);
  const comparisons = new Comparisons(access);
  const actions = {
    start: vi.fn(async () => {
      throw new Error('No recipe is invoked in this fixture.');
    }),
    get: vi.fn(),
    cancel: vi.fn(),
  };
  const deps = {
    access,
    files: {
      inspect: (file: string, content = false, _ocr = false, signal?: AbortSignal) =>
        inspectFile(file, { content, signal }),
    },
    comparisons,
    plans,
    operations,
    actions,
    coordination: { run: async <T>(_intents: unknown, work: () => Promise<T>) => work() },
    ...overrides,
  };
  let flows = new Workflows(profile, deps);
  return {
    root,
    profile,
    destination,
    operations,
    plans,
    actions,
    access,
    get flows() {
      return flows;
    },
    reopen: async () => {
      await flows.close();
      flows = new Workflows(profile, deps);
    },
    create: async () =>
      (await flows.request({
        kind: 'save',
        file: path.join(root, 'viewer.workflow.jsonc'),
        revision: '',
        definition: definition(),
      })) as WorkflowDocument,
    start: async (document: WorkflowDocument) =>
      (await flows.request({
        kind: 'start',
        file: document.file,
        revision: document.revision,
        bindings: { output: destination },
        context: {
          workspaceID: 'workspace',
          rootID: 'root',
          paneID: 'pane',
          sources: [],
          actor: 'user',
        },
      })) as WorkflowRun,
    close: async () => {
      await flows.close();
      comparisons.close();
      await plans.close();
      await operations.close();
      await checkpoints.close();
      await trashTemporary(root);
    },
  };
}
describe('explicit portable workflows', () => {
  it('rechecks authorization after inspection before publishing evidence or preparing a copy', async () => {
    let denied = false,
      inspected = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture({
      authorizeRun: async () => {
        if (denied) throw new Error('Client access was revoked.');
      },
      files: {
        inspect: async (file, content, ocr, signal) => {
          const result = await inspectFile(file, { content, ocr: ocr ? 'eng' : undefined, signal });
          inspected = true;
          await gate;
          return result;
        },
      },
    });
    try {
      const run = await f.start(await f.create());
      await expect.poll(() => inspected).toBe(true);
      denied = true;
      release();
      await expect
        .poll(
          async () => ((await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun).status,
        )
        .toBe('failed');
      const failed = (await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun;
      expect(failed.steps[0]!.artifact).toBeUndefined();
      expect(failed.steps[0]!.error).toContain('revoked');
      expect(failed.steps[1]!.taskID).toBeUndefined();
      expect(f.operations.all()).toEqual([]);
    } finally {
      release();
      await f.close();
    }
  });
  it('rejects cycles, hidden executors, missing inputs and implicit step dependencies', () => {
    const flow = definition();
    expect(workflowDefinitionSchema.safeParse({ ...flow, command: 'rm -rf' }).success).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...flow,
        steps: [{ ...flow.steps[0], needs: ['copy'] }, ...flow.steps.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...flow,
        steps: [flow.steps[0], { ...flow.steps[1], needs: [] }, flow.steps[2]],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...flow,
        inputs: { destination: flow.inputs.destination },
      }).success,
    ).toBe(false);
    const steps = Array.from({ length: 100 }, (_, i) => ({
      id: 'step' + i,
      kind: 'inspect',
      needs: Array.from({ length: i }, (_, j) => 'step' + j),
      sources: [{ kind: 'input', name: 'source' }],
    }));
    expect(workflowDefinitionSchema.safeParse({ ...flow, steps }).success).toBe(true);
  });
  it('reading never runs a step; comments survive explicit saves and revisions reject stale editors', async () => {
    const f = await fixture();
    try {
      const document = await f.create();
      const text = await readFile(document.file, 'utf8');
      expect(text).toContain('Opening this definition never runs');
      await f.flows.request({ kind: 'read', file: document.file });
      expect(f.operations.all()).toEqual([]);
      expect(f.actions.start).not.toHaveBeenCalled();
      await f.flows.request({
        kind: 'save',
        file: document.file,
        revision: document.revision,
        definition: { ...document.definition, name: 'Updated' },
      });
      expect(await readFile(document.file, 'utf8')).toContain(
        '// Provider permissions still apply.',
      );
      await expect(
        f.flows.request({
          kind: 'save',
          file: document.file,
          revision: document.revision,
          definition: document.definition,
        }),
      ).rejects.toThrow('changed');
    } finally {
      await f.close();
    }
  });
  it('persists a review without copying, resumes actual normal copy receipts, then inspects the copied file', async () => {
    const f = await fixture();
    try {
      const run = await f.start(await f.create());
      await expect
        .poll(async () => {
          const value = (await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun;
          if (value.status === 'failed')
            throw new Error(
              value.steps.find((step) => step.error)?.error ?? 'Unknown workflow failure',
            );
          return value.status;
        })
        .toBe('waiting-review');
      const waiting = (await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun;
      expect(waiting.steps[0].artifact).toMatchObject({ kind: 'inspection' });
      expect(await readdir(f.destination)).toEqual([]);
      expect(f.operations.all()).toEqual([]);
      await f.reopen();
      expect(((await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun).status).toBe(
        'waiting-review',
      );
      expect(f.operations.all()).toEqual([]);
      const plan = (await f.plans.request({
        kind: 'get',
        id: waiting.steps[1].taskID!,
      })) as OperationPlan;
      await f.plans.request({
        kind: 'apply',
        id: plan.id,
        revision: plan.revision,
        checkpoint: false,
        rows: plan.rows.map((row) => ({ id: row.id, approved: true })),
      });
      await f.operations.exclusive(async () => {});
      await f.flows.request({ kind: 'resume', id: run.id });
      await expect
        .poll(
          async () => ((await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun).status,
        )
        .toBe('completed');
      const completed = (await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun;
      expect(completed.steps[2].sources[0].path).toBe(path.join(f.destination, 'Source.txt'));
      expect(await readFile(completed.steps[2].sources[0].path, 'utf8')).toBe(
        'Original Unicode 模型',
      );
    } finally {
      await f.close();
    }
  });
  it('rejects changed sources before applying a workflow copy and cancels the pending review', async () => {
    const f = await fixture();
    try {
      const run = await f.start(await f.create());
      await expect
        .poll(
          async () => ((await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun).status,
        )
        .toBe('waiting-review');
      const waiting = (await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun;
      const plan = (await f.plans.request({
        kind: 'get',
        id: waiting.steps[1].taskID!,
      })) as OperationPlan;
      await writeFile(path.join(f.root, 'Source.txt'), 'Changed after inspection');
      await expect(
        f.plans.request({
          kind: 'apply',
          id: plan.id,
          revision: plan.revision,
          checkpoint: false,
          rows: plan.rows.map((row) => ({ id: row.id, approved: true })),
        }),
      ).rejects.toThrow('changed');
      await f.flows.request({ kind: 'cancel', id: run.id });
      expect(await f.plans.request({ kind: 'get', id: plan.id })).toMatchObject({
        status: 'cancelled',
      });
      expect(await readdir(f.destination)).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('never replays an ambiguous mutation step after a crash', async () => {
    const f = await fixture();
    try {
      const run = await f.start(await f.create());
      await expect
        .poll(
          async () => ((await f.flows.request({ kind: 'get', id: run.id })) as WorkflowRun).status,
        )
        .toBe('waiting-review');
      await f.flows.close();
      const file = path.join(f.profile, 'workflow-runs', run.id + '.json');
      const receipt = JSON.parse(await readFile(file, 'utf8')) as WorkflowRun;
      receipt.status = 'running';
      receipt.steps[1].status = 'running';
      delete receipt.steps[1].taskID;
      await writeFile(file, JSON.stringify(receipt));
      await f.reopen();
      expect(await f.flows.request({ kind: 'get', id: run.id })).toMatchObject({
        status: 'failed',
        steps: [{}, { status: 'failed' }, {}],
      });
      await expect(f.flows.request({ kind: 'resume', id: run.id })).rejects.toThrow('paused');
      expect(f.operations.all()).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
