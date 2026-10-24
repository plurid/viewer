import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DocumentStore } from '../persistence/document-store';
import { absolute, entry } from '../files/filesystem';
import { documentBytes } from '../previews/formats';
import { fileCoordination } from '../files/file-coordination';
import { sourceVersion, sameSourceVersion } from '../../domain/files/inspection';
import {
  declaredReferences,
  fileRelationSchema,
  type FileRelation,
  type RelatedFile,
  type RelationshipsRequest,
  type RelationshipsReply,
  type ObservedOperationLink,
} from '../../domain/files/relationships';
import type { ActionPlan } from '../../domain/services';
import type { WorkflowRun } from '../../domain/automation/workflows';
import { resolveProjectPath } from '../../domain/workspaces/project';
const noteSchema = z
  .array(
    fileRelationSchema.refine(
      (value) => value.basis === 'reported' && value.receipt.service === 'note',
    ),
  )
  .max(2000);

/** Receipt relationships and reported notes remain distinct from declared reference scans. */
export class Relationships {
  private notes: FileRelation[] = [];
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private store: DocumentStore<FileRelation[]>;
  constructor(
    directory: string,
    private dependencies: {
      access(files: readonly string[]): Promise<void>;
      operations(): Promise<ObservedOperationLink[]>;
      recipes(): Promise<ActionPlan[]>;
      workflows(): Promise<WorkflowRun[]>;
    },
  ) {
    this.store = new DocumentStore(path.join(directory, 'file-relationships-v1.json'), (value) =>
      noteSchema.parse(value),
    );
  }
  request(request: RelationshipsRequest): Promise<RelationshipsReply> {
    if (this.closed) return Promise.reject(new Error('Relationships have closed.'));
    if (this.pending >= 16) return Promise.reject(new Error('Too many relationship requests.'));
    this.pending++;
    const task = this.queue
      .catch(() => {})
      .then(() => this.handle(request))
      .finally(() => this.pending--);
    this.queue = task;
    return task;
  }
  private async handle(request: RelationshipsRequest): Promise<RelationshipsReply> {
    await (this.loaded ??= this.store.load().then((notes) => {
      this.notes = notes ?? [];
    }));
    if (request.kind === 'remove-note') {
      const notes = this.notes.filter((note) => note.id !== request.id);
      await this.store.save(notes);
      this.notes = notes;
      return null;
    }
    if (request.kind === 'note') {
      const from = absolute(request.from),
        to = absolute(request.to);
      await this.dependencies.access([from, to]);
      if (this.notes.length >= 2000)
        throw new Error('Remove old relationship notes before adding another.');
      const note = fileRelationSchema.parse({
        id: randomUUID(),
        from: { path: from, version: sourceVersion(await entry(from)) },
        to: { path: to, version: sourceVersion(await entry(to)) },
        kind: 'related',
        basis: 'reported',
        receipt: { service: 'note', id: randomUUID() },
        note: request.note,
      });
      await this.dependencies.access([from, to]);
      await this.store.save([...this.notes, note]);
      this.notes.push(note);
      return structuredClone(note);
    }
    const file = absolute(request.file);
    await this.dependencies.access([file]);
    const [operations, recipes, workflows] = await Promise.all([
      this.dependencies.operations(),
      this.dependencies.recipes(),
      this.dependencies.workflows(),
    ]);
    const relations: FileRelation[] = [],
      reasons: string[] = [];
    let limited = false;
    const push = (relation: FileRelation) => {
      if (relation.from.path !== file && relation.to.path !== file) return;
      if (relations.length < 500) relations.push(relation);
      else limited = true;
    };
    for (const note of this.notes) push(note);
    for (const link of operations.toReversed())
      push({
        id: 'operation:' + link.id,
        from: { path: link.source, version: link.sourceVersion },
        to: { path: link.destination, version: link.targetVersion },
        kind: link.kind,
        basis: 'observed',
        receipt: { service: 'operation', id: link.id, revision: link.revision },
      });
    for (const plan of recipes)
      for (const row of plan.rows)
        if (row.completed) {
          const sources = row.source ? [row.source] : (plan.summaryInputs ?? []);
          for (const source of sources)
            push({
              id: 'recipe:' + plan.id + ':' + row.id + ':' + source.identity,
              from: { path: source.path, version: sourceVersion(source) },
              to: { path: row.destination },
              kind: row.kind,
              basis: 'observed',
              receipt: { service: 'recipe', id: plan.id, revision: plan.revision },
            });
        }
    for (const run of workflows)
      for (const step of run.steps)
        if (step.status === 'completed') {
          const definition = run.definition.steps.find((value) => value.id === step.id);
          if (!definition) continue;
          const references =
            definition.kind === 'copy'
              ? definition.sources
              : definition.kind === 'compare'
                ? [definition.left, definition.right]
                : definition.sources;
          const inputPaths = new Set(
            references.flatMap((reference) =>
              reference.kind === 'input'
                ? (resolveProjectPath(
                    path.dirname(run.file),
                    run.definition.inputs[reference.name],
                    run.bindings,
                  ) ?? [])
                : reference.kind === 'selection'
                  ? run.context.sources
                  : (run.steps
                      .find((value) => value.id === reference.id)
                      ?.outputs.map((value) => value.path) ?? []),
            ),
          );
          const inputs = step.sources.filter((source) => inputPaths.has(source.path));
          // A workflow may have many outputs; a query never constructs a cross product for unrelated files.
          const from = inputs.filter((source) => source.path === file),
            to = step.outputs.filter((source) => source.path === file);
          if (!from.length && !to.length) continue;
          const pairs = from.length
            ? from.flatMap((source) => step.outputs.map((output) => ({ source, output })))
            : to.flatMap((output) => inputs.map((source) => ({ source, output })));
          for (const { source, output } of pairs.slice(0, 200))
            push({
              id:
                'workflow:' +
                run.id +
                ':' +
                step.id +
                ':' +
                createHash('sha256')
                  .update(source.path + '\0' + output.path)
                  .digest('hex')
                  .slice(0, 16),
              from: source,
              to: output,
              kind:
                step.kind === 'inspect'
                  ? 'inspection'
                  : step.kind === 'compare'
                    ? 'comparison'
                    : 'workflow input',
              basis: 'observed',
              receipt: { service: 'workflow', id: run.id + ':' + step.id },
              note: run.definition.name,
            });
          if (pairs.length > 200)
            reasons.push(
              'A workflow step has more than 200 related outputs; showing a bounded subset.',
            );
        }
    if (request.content) {
      const before = sourceVersion(await entry(file));
      const text = await fileCoordination.run([{ path: file, mode: 'read' }], async (signal) => {
        signal?.throwIfAborted();
        return new TextDecoder().decode(await documentBytes(file, 4000000));
      });
      const references = declaredReferences(path.extname(file).slice(1).toLowerCase(), text);
      if (!references.supported)
        reasons.push(
          'This format has no declared-reference reader. Recorded relationships remain available.',
        );
      if (references.limited) reasons.push('Declared references are limited to 200 paths.');
      if (!sameSourceVersion(before, sourceVersion(await entry(file))))
        throw new Error('The source changed during reference scanning. Scan again.');
      await this.dependencies.access([file]);
      const exact = ['md', 'markdown', 'mdx', 'obj'].includes(
        path.extname(file).slice(1).toLowerCase(),
      );
      for (const [index, target] of references.paths.entries())
        push({
          id: 'declared:' + before.identity + ':' + index,
          from: { path: file, version: before },
          to: { path: path.resolve(path.dirname(file), target) },
          kind: 'reference',
          basis: exact ? 'declared' : 'inferred',
          receipt: { service: 'reference-reader', id: before.identity },
          note:
            target + (exact ? '' : ' · Reference syntax match; code is not executed or resolved.'),
        });
    }
    if (limited)
      reasons.push('Showing 500 relationships from the retained operation and workflow history.');
    const visible = relations;
    const files: RelatedFile[] = [];
    const versions = new Map(
      visible
        .flatMap((relation) => [relation.from, relation.to])
        .map((node) => [node.path, node.version]),
    );
    for (const [target, version] of versions) {
      try {
        await this.dependencies.access([target]);
        const current = sourceVersion(await entry(target));
        await this.dependencies.access([target]);
        files.push({
          path: target,
          version: current,
          status: version
            ? sameSourceVersion(version, current)
              ? 'available'
              : 'changed'
            : 'unverified',
        });
      } catch (error) {
        files.push({
          path: target,
          status: 'unavailable',
          reason: (error as Error).message.slice(0, 1000),
        });
      }
    }
    await this.dependencies.access([file]);
    return {
      file,
      relations: visible,
      files,
      coverage: reasons.length ? 'partial' : 'complete',
      reasons,
    };
  }
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
    await this.store.flush();
  }
}
