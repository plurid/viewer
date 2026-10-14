import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from './document-store';
import { entry, absolute, validName } from './filesystem';
import type { Operations } from './operations';
import type { Checkpoints } from './checkpoints';
import { sourceVersion, sameSourceVersion } from '../domain/inspection';
import {
  operationPlanRowSchema,
  operationPlanRequestSchema,
  type OperationPlan,
  type OperationPlanRequest,
  type OperationPlanReply,
} from '../domain/operation-plan';
const planSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().max(200),
    created: z.number(),
    owner: z.string().optional(),
    status: z.enum([
      'planning',
      'review',
      'applying',
      'completed',
      'partial',
      'cancelled',
      'failed',
      'recovery',
    ]),
    rows: z.array(operationPlanRowSchema).max(10000),
    undoable: z.boolean(),
    checkpointID: z.uuid().optional(),
  })
  .strict();
/** Every mutation is submitted to the existing journaled operation executor. */
export class OperationPlans {
  private plans: OperationPlan[] = [];
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private store: DocumentStore<OperationPlan[]>;
  constructor(
    directory: string,
    private operations: Operations,
    private checkpoints: Checkpoints,
    private access: (files: readonly string[]) => Promise<void>,
  ) {
    this.store = new DocumentStore(path.join(directory, 'operation-plans-v1.json'), (value) =>
      z.array(planSchema).max(100).parse(value),
    );
  }
  private load() {
    return (this.loaded ??= this.store.load().then((value) => {
      this.plans = value ?? [];
    }));
  }
  private async save() {
    await this.store.save(this.plans);
  }
  async request(raw: OperationPlanRequest, owner = 'user'): Promise<OperationPlanReply> {
    const request = operationPlanRequestSchema.parse(raw);
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (request.kind === 'prepare') {
          const rows: OperationPlan['rows'] = [];
          for (const intent of request.intents) {
            if (intent.destination) {
              absolute(intent.destination);
              await this.access([intent.destination]);
              if (!(await entry(intent.destination)).directory)
                throw new Error('Choose a destination folder.');
            }
            if (intent.name) validName(intent.name);
            if (['copy', 'move', 'mkdir'].includes(intent.kind) && !intent.destination)
              throw new Error('Choose a destination folder.');
            if (['mkdir', 'rename'].includes(intent.kind) && !intent.name)
              throw new Error('Enter a name.');
            if (intent.kind === 'mkdir' && intent.sources.length)
              throw new Error('New-folder plans have no source file.');
            if (intent.kind !== 'mkdir' && !intent.sources.length)
              throw new Error('Select a source.');
            for (const file of intent.kind === 'mkdir'
              ? [undefined]
              : [...new Set(intent.sources)]) {
              if (rows.length >= 10000) throw new Error('A plan may contain at most 10,000 rows.');
              if (file) await this.access([file]);
              const item = file ? await entry(file) : undefined;
              const expected = intent.expectedSources?.find((value) => value.path === file);
              if (expected && item && !sameSourceVersion(expected.version, sourceVersion(item)))
                throw new Error('Comparison source changed. Compare it again.');
              const expectedSources = intent.expectedSources?.filter(
                (value) => value.path === file || value.path.startsWith(file! + path.sep),
              );
              for (const proof of expectedSources ?? []) {
                await this.access([proof.path]);
                if (!sameSourceVersion(proof.version, sourceVersion(await entry(proof.path))))
                  throw new Error('Comparison source changed. Compare it again.');
              }
              rows.push({
                id: randomUUID(),
                kind: intent.kind,
                source: file,
                version: item ? sourceVersion(item) : undefined,
                expectedSources,
                destination: intent.destination,
                name: intent.name,
                approved: true,
              });
            }
          }
          const plan: OperationPlan = {
            version: 1,
            id: randomUUID(),
            revision: 1,
            title: request.title,
            created: Date.now(),
            owner,
            status: 'review',
            rows,
            undoable: false,
          };
          let retained = this.plans
            .filter(
              (value) =>
                ['review', 'applying', 'recovery'].includes(value.status) || value.undoable,
            )
            .slice(-50);
          if (retained.reduce((count, value) => count + value.rows.length, rows.length) > 40000)
            throw new Error('Finish or remove pending plans before creating another.');
          retained = [...retained, plan];
          await this.store.save(retained);
          this.plans = retained;
          return structuredClone(plan);
        }
        await this.operations.load();
        const jobs = this.operations.all();
        for (const plan of this.plans)
          if (plan.status === 'applying') {
            const assigned = plan.rows.flatMap((row) =>
              row.jobID ? [jobs.find((job) => job.id === row.jobID)] : [],
            );
            if (assigned.some((job) => !job)) plan.status = 'recovery';
            else if (
              assigned.length &&
              assigned.every(
                (job) => job && !['queued', 'running', 'collision'].includes(job.status),
              )
            ) {
              plan.status = assigned.every((job) => job?.status === 'completed')
                ? 'completed'
                : 'partial';
              plan.undoable = assigned.some((job) => job?.undoable);
            }
          }
        if (request.kind === 'list')
          return structuredClone(this.plans.filter((value) => value.owner === owner));
        const plan = this.plans.find((value) => value.id === request.id && value.owner === owner);
        if (!plan) throw new Error('This plan is unavailable to this actor.');
        if (request.kind === 'get') return structuredClone(plan);
        if (request.kind === 'cancel') {
          for (const row of plan.rows) if (row.jobID) this.operations.cancel(row.jobID);
          plan.status = 'cancelled';
          plan.revision++;
          await this.save();
          return structuredClone(plan);
        }
        if (plan.status !== 'review' || plan.revision !== request.revision)
          throw new Error('This plan changed. Reload the review.');
        const ids = new Set(request.rows.map((row) => row.id));
        if (
          ids.size !== request.rows.length ||
          request.rows.some((row) => !plan.rows.some((original) => original.id === row.id))
        )
          throw new Error('Review contains invalid rows.');
        const edited = plan.rows.map((row) => {
          const choice = request.rows.find((value) => value.id === row.id);
          return {
            ...row,
            approved: !!choice?.approved,
            ...(choice?.destination ? { destination: absolute(choice.destination) } : {}),
            ...(choice?.name ? { name: validName(choice.name) } : {}),
          };
        });
        const selected = edited.filter((row) => row.approved);
        if (!selected.length) throw new Error('Choose a change to apply.');
        const original = structuredClone(plan);
        await this.operations.exclusive(async () => {
          const recover: string[] = [];
          for (const row of selected) {
            await this.access(
              [row.source, row.destination].filter((file): file is string => !!file),
            );
            if (
              row.source &&
              row.version &&
              !sameSourceVersion(row.version, sourceVersion(await entry(row.source)))
            )
              throw new Error('The source changed after planning. Prepare a new plan.');
            if (row.source) recover.push(row.source);
            for (const proof of row.expectedSources ?? []) {
              await this.access([proof.path]);
              if (!sameSourceVersion(proof.version, sourceVersion(await entry(proof.path))))
                throw new Error('The source changed after planning. Prepare a new plan.');
            }
            if (row.destination && row.kind === 'copy') {
              const target = path.join(row.destination, row.name ?? path.basename(row.source!));
              try {
                await this.access([target]);
                await entry(target);
                recover.push(target);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              }
            }
          }
          if (request.checkpoint)
            plan.checkpointID = (await this.checkpoints.create(plan.title, recover)).id;
          plan.rows = edited;
          plan.status = 'applying';
          plan.revision++;
          try {
            await this.save();
          } catch (error) {
            Object.assign(plan, original);
            if (!original.checkpointID) delete plan.checkpointID;
            throw error;
          }
          try {
            for (const row of selected) {
              row.jobID = this.operations.start({
                kind: row.kind,
                sources: row.source ? [row.source] : [],
                destination: row.destination,
                name: row.name,
                expectedSources:
                  row.expectedSources ??
                  (row.source && row.version
                    ? [{ path: row.source, version: row.version }]
                    : undefined),
              });
            }
            await this.save();
          } catch (error) {
            for (const row of selected) if (row.jobID) this.operations.cancel(row.jobID);
            plan.status = 'failed';
            await this.save();
            throw error;
          }
        });
        return structuredClone(plan);
      });
    this.queue = work;
    return work;
  }
  async close() {
    await this.queue.catch(() => {});
    await this.store.flush();
  }
}
