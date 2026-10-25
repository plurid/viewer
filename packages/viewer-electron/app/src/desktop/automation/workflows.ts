import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { DefinitionFiles } from '../persistence/definition-files';
import { DocumentStore } from '../persistence/document-store';
import { entry } from '../files/filesystem';
import { resolveProjectPath } from '../../domain/workspaces/project';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import {
  workflowArtifact,
  workflowDefinitionSchema,
  workflowRunSchema,
  workflowReferences,
  workflowUsesSelection,
  type WorkflowRecord,
  type WorkflowReference,
  type WorkflowReply,
  type WorkflowRequest,
  type WorkflowRun,
} from '../../domain/automation/workflows';
import type { ActionPlanner } from '../actions/planner';
import type { OperationPlans } from '../operations/operation-plans';
import type { Operations } from '../operations/operations';
import type { Comparisons } from '../comparison/comparison';
import type { FileServices } from '../files/file-services';
import type { fileCoordination } from '../files/file-coordination';
import type { ActionRecipe } from '../../domain/services';
import { removePrivateData } from '../operations/removal';

const comments = `// Viewer workflow, version 1. Agents may edit this JSONC file.
// Opening this definition never runs a step. Choose Run workflow explicitly.
// Inputs use paths relative to this file's folder. External folders require named
// bindings selected on this Mac; bindings do not grant file or command access.
// Each step has a unique id and a needs array naming its dependencies.
// Sources refer to { "kind": "input", "name": "..." } or to a completed
// dependency's outputs with { "kind": "step", "id": "..." }.
// { "kind": "selection" } uses the files selected at Run, or the changed files
// supplied by an explicitly enabled watch rule. An empty selection cannot run.
// inspect reads metadata by default. content/ocr opt in to reading file contents.
// compare uses metadata unless hashes is true; hashing may download cloud files.
// copy and recipe steps prepare normal, editable reviews. They cannot approve
// themselves. Resume only after reviewing and completing the associated task.
// Provider permissions still apply. Shell commands and schedules are not supported.
// Private run receipts, bookmarks and credentials never belong in this file.
`;

/** Explicit DAG runs compose existing services; this class never approves a mutation. */
export class Workflows {
  readonly definitions: DefinitionFiles<WorkflowRun['definition']>;
  private index: DocumentStore<string[]>;
  private ids: string[] = [];
  private runs = new Map<string, WorkflowRun>();
  private stores = new Map<string, DocumentStore<WorkflowRun>>();
  private sizes = new Map<string, number>();
  private work = new Map<string, Promise<void>>();
  private aborts = new Map<string, AbortController>();
  private loaded?: Promise<void>;
  private controls: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  constructor(
    private directory: string,
    private dependencies: {
      access(files: readonly string[]): Promise<void>;
      files: Pick<FileServices, 'inspect'>;
      comparisons: Pick<Comparisons, 'run' | 'cancel'>;
      /** Everything but apply: a workflow prepares a plan, and the person applies it (2026-10-20). */
      plans: {
        request(
          request: Exclude<Parameters<OperationPlans['request']>[0], { kind: 'apply' }>,
          owner?: string,
        ): ReturnType<OperationPlans['request']>;
      };
      operations: Pick<Operations, 'all'>;
      actions: Pick<ActionPlanner, 'start' | 'get' | 'cancel'>;
      coordination?: Pick<typeof fileCoordination, 'run'>;
      authorizeRun?(run: WorkflowRun): Promise<void>;
      recipeForRun?(run: WorkflowRun, id: string): Promise<ActionRecipe | undefined>;
    },
  ) {
    this.definitions = new DefinitionFiles(
      workflowDefinitionSchema,
      'Workflow',
      comments,
      dependencies.access,
      dependencies.coordination,
    );
    this.index = new DocumentStore(path.join(directory, 'workflow-runs-v1.json'), (value) =>
      z.array(z.uuid()).max(100).parse(value),
    );
  }
  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(path.join(this.directory, 'workflow-runs', id + '.json'), (value) =>
        workflowRunSchema.parse(value),
      );
      this.stores.set(id, store);
    }
    return store;
  }
  private load() {
    return (this.loaded ??= (async () => {
      this.ids = (await this.index.load()) ?? [];
      for (const id of this.ids) {
        const run = await this.store(id).load();
        if (!run)
          throw new Error(
            'A workflow run receipt is missing. Review recovery before running it again.',
          );
        this.checkSize(run);
        if (run.status === 'running') {
          run.status = 'paused';
          for (const record of run.steps)
            if (record.status === 'running') {
              if (record.taskID) record.status = 'waiting-review';
              else if (['copy', 'convert', 'recipe'].includes(record.kind)) {
                record.status = 'failed';
                run.status = 'failed';
                record.error =
                  'The run stopped before recording its task ID. Check the task history before starting another run.';
              } else record.status = 'pending';
            }
        }
        this.runs.set(id, run);
      }
    })().catch((error: unknown) => {
      // A failed read is retried by the next caller instead of disabling this service.
      this.loaded = undefined;
      throw error;
    }));
  }
  private async save(run: WorkflowRun) {
    run.updated = Date.now();
    this.checkSize(run);
    await this.store(run.id).save(run);
  }
  private checkSize(run: WorkflowRun) {
    const bytes = Buffer.byteLength(JSON.stringify(run));
    const total = [...this.sizes].reduce(
      (sum, [id, size]) => sum + (id === run.id ? 0 : size),
      bytes,
    );
    if (bytes > 8 * 1024 ** 2 || total > 64 * 1024 ** 2)
      throw new Error('Workflow history reached its storage limit. Narrow the inspected sources.');
    this.sizes.set(run.id, bytes);
  }
  request(request: WorkflowRequest): Promise<WorkflowReply> {
    if (this.closed) return Promise.reject(new Error('Workflows have closed.'));
    if (this.pending >= 32) return Promise.reject(new Error('Too many workflow requests.'));
    this.pending++;
    const task = this.controls
      .catch(() => {})
      .then(() => this.handle(request))
      .finally(() => this.pending--);
    this.controls = task;
    return task;
  }
  private async handle(request: WorkflowRequest): Promise<WorkflowReply> {
    if (this.closed) throw new Error('Workflows have closed.');
    if (request.kind === 'choose') throw new Error('Use the desktop picker to choose a workflow.');
    if (request.kind === 'read') return this.definitions.read(request.file);
    if (request.kind === 'save')
      return this.definitions.save(request.file, request.revision, request.definition);
    await this.load();
    if (request.kind === 'list')
      return structuredClone(
        [...this.runs.values()].reverse().map((run) => ({
          ...run,
          steps: run.steps.map((step) => ({ ...step, artifact: undefined })),
        })),
      );
    if (request.kind === 'start') {
      if (this.ids.length >= 100)
        throw new Error(
          'The workflow history is full. Export or remove old run receipts before starting another.',
        );
      if (
        [...this.runs.values()].filter((run) =>
          ['running', 'waiting-review', 'paused'].includes(run.status),
        ).length >= 20
      )
        throw new Error('Finish or cancel pending workflows before starting another.');
      const document = await this.definitions.read(request.file);
      if (document.revision !== request.revision)
        throw new Error('The workflow changed on disk. Reload it before running.');
      if (workflowUsesSelection(document.definition) && !request.context.sources.length)
        throw new Error('Select the files to run this workflow on.');
      const bindings = Object.fromEntries(
        document.definition.bindings.map((binding) => {
          const value = Object.hasOwn(request.bindings, binding.name)
            ? request.bindings[binding.name]
            : undefined;
          if (!value || !path.isAbsolute(value) || value.includes('\0'))
            throw new Error('Choose the folder for ' + binding.label + '.');
          return [binding.name, value];
        }),
      );
      await this.dependencies.access([document.file, ...Object.values(bindings)]);
      const run: WorkflowRun = workflowRunSchema.parse({
        version: 1,
        id: randomUUID(),
        file: document.file,
        revision: document.revision,
        watch: request.watch,
        created: Date.now(),
        updated: Date.now(),
        status: 'running',
        definition: document.definition,
        bindings,
        context: request.context,
        steps: document.definition.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          status: 'pending',
          sources: [],
          outputs: [],
        })),
      });
      await this.dependencies.authorizeRun?.(run);
      // Persist the run before it is reachable or any service receives work.
      await this.save(run);
      await this.index.save([...this.ids, run.id]);
      this.ids.push(run.id);
      this.runs.set(run.id, run);
      this.advance(run);
      return structuredClone(run);
    }
    const run = this.runs.get(request.id);
    if (!run) throw new Error('This workflow run is unavailable.');
    if (request.kind === 'get') return structuredClone(run);
    if (request.kind === 'remove') {
      if (this.work.has(run.id) || ['running', 'paused', 'waiting-review'].includes(run.status))
        throw new Error('Finish or cancel this run before removing its history.');
      const ids = this.ids.filter((id) => id !== run.id);
      await this.index.save(ids);
      this.ids = ids;
      this.runs.delete(run.id);
      this.sizes.delete(run.id);
      await this.store(run.id).flush();
      await removePrivateData(this.directory, this.store(run.id).file);
      this.stores.delete(run.id);
      return null;
    }
    if (request.kind === 'cancel') {
      run.status = 'cancelled';
      this.aborts.get(run.id)?.abort();
      for (const record of run.steps) {
        if (record.taskID && ['running', 'waiting-review'].includes(record.status)) {
          if (record.kind === 'recipe') this.dependencies.actions.cancel(record.taskID);
          else if (record.kind === 'copy' || record.kind === 'convert')
            await this.dependencies.plans.request({ kind: 'cancel', id: record.taskID });
        }
        if (['pending', 'running', 'waiting-review'].includes(record.status))
          record.status = 'cancelled';
      }
      await this.save(run);
      return structuredClone(run);
    }
    if (this.work.has(run.id)) return structuredClone(run);
    if (!['waiting-review', 'paused'].includes(run.status))
      throw new Error(
        'Only a paused workflow can resume. Start a new run after correcting a failed step.',
      );
    const document = await this.definitions.read(run.file);
    if (document.revision !== run.revision)
      throw new Error(
        'The workflow definition changed. Start a new run with the updated definition.',
      );
    await this.dependencies.access(Object.values(run.bindings));
    await this.dependencies.authorizeRun?.(run);
    run.status = 'running';
    await this.save(run);
    this.advance(run);
    return structuredClone(run);
  }
  private async capture(paths: readonly string[]) {
    const unique = [...new Set(paths)];
    if (!unique.length || unique.length > 2000)
      throw new Error('Use between 1 and 2,000 workflow sources.');
    await this.dependencies.access(unique);
    const result = [];
    for (const file of unique)
      result.push({ path: file, version: sourceVersion(await entry(file)) });
    await this.dependencies.access(unique);
    return result;
  }
  private async validate(sources: WorkflowRecord['outputs']) {
    await this.dependencies.access(sources.map((source) => source.path));
    for (const source of sources)
      if (!sameSourceVersion(source.version, sourceVersion(await entry(source.path))))
        throw new Error(
          'A workflow source changed. Start a new run to refresh its facts and proposed changes.',
        );
  }
  private async references(run: WorkflowRun, refs: WorkflowReference[]) {
    const paths: string[] = [];
    for (const ref of refs) {
      if (ref.kind === 'input') {
        const file = resolveProjectPath(
          path.dirname(run.file),
          run.definition.inputs[ref.name],
          run.bindings,
        );
        if (!file) throw new Error('Bind the folder for ' + ref.name + '.');
        paths.push(file);
      } else if (ref.kind === 'selection') {
        paths.push(...run.context.sources);
      } else {
        const parent = run.steps.find((step) => step.id === ref.id);
        if (parent?.status !== 'completed') throw new Error('Complete step ' + ref.id + ' first.');
        await this.validate(parent.outputs);
        paths.push(...parent.outputs.map((output) => output.path));
      }
    }
    return [...new Set(paths)];
  }
  private advance(run: WorkflowRun) {
    if (this.closed || this.work.has(run.id)) return;
    const abort = new AbortController();
    this.aborts.set(run.id, abort);
    const task = this.execute(run, abort.signal)
      .catch(async (error) => {
        if (run.status === 'cancelled' || this.closed) return;
        const record = run.steps.find((step) => step.status === 'running');
        if (record) {
          record.status = 'failed';
          record.error = String(error instanceof Error ? error.message : error).slice(0, 2000);
        }
        run.status = 'failed';
        await this.save(run);
      })
      .finally(() => {
        this.work.delete(run.id);
        this.aborts.delete(run.id);
      });
    this.work.set(run.id, task);
    // Errors writing a final receipt remain visible when the run is next opened.
    void task.catch(() => {});
  }
  private async finishReviewed(run: WorkflowRun, record: WorkflowRecord): Promise<boolean> {
    if (!record.taskID)
      throw new Error('The reviewed task receipt is missing. Do not replay this step.');
    if (record.kind === 'recipe') {
      const plan = await this.dependencies.actions.get(record.taskID);
      if (['planning', 'review', 'applying'].includes(plan.status)) return false;
      if (plan.status !== 'completed')
        throw new Error(
          'The recipe did not complete. Review its recovery task before starting another run.',
        );
      const outputs = plan.rows.filter((row) => row.completed).map((row) => row.destination);
      record.outputs = outputs.length ? await this.capture(outputs) : [];
      record.artifact = workflowArtifact({
        kind: 'recipe-receipt',
        id: plan.id,
        revision: plan.revision,
      });
    } else {
      const plan = await this.dependencies.plans.request({ kind: 'get', id: record.taskID });
      if (Array.isArray(plan)) throw new Error('Invalid operation receipt.');
      if (['review', 'applying'].includes(plan.status)) return false;
      if (plan.status !== 'completed')
        throw new Error(
          'The copy did not complete. Review its operation recovery before starting another run.',
        );
      const jobs = this.dependencies.operations.all();
      const outputs = plan.rows.flatMap((row) => {
        if (!row.jobID || !row.source) return [];
        const receipt = jobs.find((job) => job.id === row.jobID);
        // Use actual receipts, including keep-both names, rather than reconstructing destinations.
        return (
          receipt?.completed
            .filter(
              (item) => (row.kind === 'convert' || item.source === row.source) && item.destination,
            )
            .map((item) => item.destination!) ?? []
        );
      });
      record.outputs = outputs.length ? await this.capture(outputs) : [];
      record.artifact = workflowArtifact({
        kind: 'operation-receipt',
        id: plan.id,
        revision: plan.revision,
      });
    }
    record.status = 'completed';
    return true;
  }
  private async execute(run: WorkflowRun, signal: AbortSignal) {
    while (run.status === 'running') {
      signal.throwIfAborted();
      await this.dependencies.authorizeRun?.(run);
      const step = run.definition.steps.find((step) => {
        const record = run.steps.find((record) => record.id === step.id)!;
        return (
          ['pending', 'waiting-review'].includes(record.status) &&
          step.needs.every(
            (id) => run.steps.find((record) => record.id === id)?.status === 'completed',
          )
        );
      });
      if (!step) {
        if (run.steps.some((record) => record.status !== 'completed'))
          throw new Error(
            'Workflow dependencies are incomplete. Review the failed task before starting another run.',
          );
        run.status = 'completed';
        await this.save(run);
        return;
      }
      const record = run.steps.find((record) => record.id === step.id)!;
      if (record.status === 'waiting-review') {
        record.status = 'running';
        if (!(await this.finishReviewed(run, record))) {
          record.status = 'waiting-review';
          run.status = 'waiting-review';
          await this.save(run);
          return;
        }
        signal.throwIfAborted();
        await this.save(run);
        continue;
      }
      record.status = 'running';
      await this.save(run);
      record.sources = await this.capture(await this.references(run, workflowReferences(step)));
      signal.throwIfAborted();
      await this.save(run);
      if (step.kind === 'inspect') {
        if (record.sources.length > 100)
          throw new Error('Inspect at most 100 files in a workflow step.');
        const results = [];
        for (const source of record.sources) {
          signal.throwIfAborted();
          results.push(
            await this.dependencies.files.inspect(source.path, step.content, step.ocr, signal),
          );
          workflowArtifact({ kind: 'inspection', results });
        }
        record.artifact = workflowArtifact({ kind: 'inspection', results });
        await this.validate(record.sources);
        record.outputs = structuredClone(record.sources);
        record.status = 'completed';
      } else if (step.kind === 'compare') {
        const left = await this.references(run, [step.left]),
          right = await this.references(run, [step.right]);
        const [first] = left,
          [second] = right;
        if (left.length !== 1 || right.length !== 1 || !first || !second)
          throw new Error('A compare step needs exactly one location on each side.');
        const id = randomUUID(),
          cancel = () => this.dependencies.comparisons.cancel(id);
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await this.dependencies.comparisons.run(id, first, second, step.hashes);
          record.artifact = workflowArtifact({ kind: 'comparison', result });
        } finally {
          signal.removeEventListener('abort', cancel);
        }
        await this.validate(record.sources);
        record.outputs = structuredClone(record.sources);
        record.status = 'completed';
      } else if (step.kind === 'copy' || step.kind === 'convert') {
        const sources = await this.references(run, step.sources),
          destination = await this.references(run, [step.destination]);
        const [folder] = destination;
        if (destination.length !== 1 || !folder || !(await entry(folder)).directory)
          throw new Error('Choose one destination folder for the copy step.');
        await this.validate(record.sources);
        const plan = await this.dependencies.plans.request({
          kind: 'prepare',
          title: run.definition.name + ' · ' + step.id,
          intents: [
            {
              kind: step.kind,
              ...(step.kind === 'convert' ? { transform: step.transform, name: step.name } : {}),
              sources,
              destination: destination[0],
              expectedSources: record.sources.filter((source) => sources.includes(source.path)),
            },
          ],
        });
        if (Array.isArray(plan)) throw new Error('Invalid operation proposal.');
        record.taskID = plan.id;
        if (signal.aborted) {
          await this.dependencies.plans.request({ kind: 'cancel', id: plan.id });
          signal.throwIfAborted();
        }
        record.status = 'waiting-review';
        run.status = 'waiting-review';
      } else {
        await this.validate(record.sources);
        const expectedRecipe = await this.dependencies.recipeForRun?.(run, step.recipeID);
        record.taskID = await this.dependencies.actions.start(
          {
            recipeID: step.recipeID,
            instructions: step.instructions,
            context: { ...run.context, sources: record.sources.map((source) => source.path) },
          },
          expectedRecipe,
        );
        if (signal.aborted) {
          this.dependencies.actions.cancel(record.taskID);
          signal.throwIfAborted();
        }
        record.status = 'waiting-review';
        run.status = 'waiting-review';
      }
      signal.throwIfAborted();
      await this.save(run);
    }
  }
  async close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
    await this.controls.catch(() => {});
    await Promise.allSettled(this.work.values());
    for (const run of this.runs.values())
      if (run.status === 'running') {
        run.status = 'paused';
        for (const record of run.steps)
          if (record.status === 'running') {
            if (record.taskID) record.status = 'waiting-review';
            else if (['copy', 'convert', 'recipe'].includes(record.kind)) {
              record.status = 'failed';
              run.status = 'failed';
              record.error =
                'The task receipt could not be recorded. Review task history before retrying.';
            } else record.status = 'pending';
          }
        await this.save(run);
      }
    await this.definitions.flush();
    await this.index.flush();
    await Promise.all([...this.stores.values()].map((store) => store.flush()));
  }
}
