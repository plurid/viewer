import type { FileChange } from '../domain/changes';
import type { TrashOrigin } from '../domain/trash';
import type { ObservedOperationLink } from '../domain/relationships';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  CollisionDecision,
  OperationJob,
  OperationProgress,
  OperationRequest,
} from '../domain/contracts';
import { absolute, exists, message, validName, entry } from './filesystem';
import { sourceVersion, sameSourceVersion } from '../domain/inspection';
import { macFiles, type TrashReceipt, type ReceiptAccess } from './macos-files';
import { createArchive, extractArchive } from './archive-jobs';
import { OperationLog, outputProof, type OperationReceipt } from './operation-journal';
import { privateStage } from './staging';
import { fileCoordination } from './file-coordination';
import { removeEmptyDirectory, unlinkVerified } from './removal';
import { ProtectedPaths } from './protected-paths';
import {
  conversionOutput,
  convertibleExtensions,
  unavailableConverter,
  type ImageConverter,
} from './image-convert';
import { holds, sameItem, unchanged, type Replaced } from './item-identity';
import {
  copyTree,
  keepBothName,
  publish,
  syncDirectories,
  type CopyFingerprint,
  type TransferJob,
} from './file-transfer';

interface UndoStep {
  from: string;
  to: string;
  identity: string;
  modified: number;
  size: number;
  caseOnly?: boolean;
  remove?: boolean;
  proof?: string;
  trash?: boolean;
  bookmark?: string;
  directory?: boolean;
}
class ReceiptFailure extends Error {}
interface Target {
  path: string;
  replaces?: Replaced;
}
interface Task {
  job: OperationJob;
  request: OperationRequest;
  abort: AbortController;
  decision?: (decision: CollisionDecision) => void;
  policy?: CollisionDecision;
  undo: UndoStep[];
  lastProgress: number;
  intent?: OperationReceipt['intent'];
  /** The request Redo would start, pinned to the versions Undo restored. */
  redo?: OperationRequest;
}

/** Selected ancestors carry their descendants; membership checks preserve source order. */
export function operationRoots(sources: readonly string[], paths = path): string[] {
  const selected = new Set(sources);
  return [...selected].filter((file) => {
    let parent = paths.dirname(file);
    while (parent !== file) {
      if (selected.has(parent)) return false;
      const next = paths.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    return true;
  });
}
export class Operations {
  private tasks = new Map<string, Task>();
  private queue: Task[] = [];
  private running = false;
  private exclusiveQueue: Promise<void> = Promise.resolve();
  private stopped = false;
  private idle: (() => void)[] = [];
  private journal?: OperationLog;
  private loaded?: Promise<void>;
  constructor(
    private trash: (file: string) => Promise<void | TrashReceipt>,
    private changed: (job: OperationJob) => void,
    private progressed: (progress: OperationProgress) => void = () => {},
    private filesChanged: (changes: FileChange[]) => void = () => {},
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    dataPath?: string,
    private receiptAccess: ReceiptAccess = async (_receipt, work) => work(),
    private notice: (message: string) => void = () => {},
    private protection = new ProtectedPaths(),
    private images: ImageConverter = unavailableConverter,
  ) {
    if (dataPath) this.journal = new OperationLog(dataPath);
  }
  load(): Promise<void> {
    // A transient read failure must not disable file operations until restart.
    return (this.loaded ??= this.restore().catch((error) => {
      this.loaded = undefined;
      throw error;
    }));
  }
  /** Unreadable records are renamed aside by the log, never deleted or replayed. */
  private async readJournal(): Promise<OperationReceipt[]> {
    if (!this.journal) return [];
    const { receipts, notices } = await this.journal.load();
    for (const notice of notices) this.notice(notice);
    return receipts;
  }
  private async restore(): Promise<void> {
    for (const receipt of await this.readJournal()) {
      if (this.tasks.has(receipt.job.id)) continue;
      const job = receipt.job;
      const interruptedUndo = !!receipt.intent && job.status === 'completed';
      if (receipt.intent || ['queued', 'running', 'collision'].includes(job.status)) {
        job.status = 'failed';
        job.collision = undefined;
        job.current = undefined;
        job.recovery = receipt.intent;
        job.errors.push({
          path: receipt.intent?.source || job.sources[0] || job.destination || '',
          message:
            'Interrupted operation. Completed items were kept. Review the recorded source, destination and any temporary transfer before retrying.',
        });
        job.errorCount = job.errors.length;
        // An interrupted Undo may already have moved or removed its current
        // item. Never replay that ambiguous receipt automatically.
        job.undoable = !interruptedUndo && !!receipt.undo.length;
      }
      // Redo is offered only within the session that performed the Undo.
      delete job.redoable;
      this.tasks.set(job.id, {
        job,
        request: receipt.request,
        undo: receipt.undo,
        abort: new AbortController(),
        lastProgress: 0,
        intent: receipt.intent,
      });
    }
  }
  /** Each retained job appends only what changed since its last record. */
  private checkpoint(): Promise<void> {
    const journal = this.journal;
    if (!journal) return Promise.resolve();
    return Promise.all(
      [...this.tasks.values()]
        .slice(-100)
        .map(({ job, request, undo, intent }) => journal.record({ job, request, undo, intent })),
    )
      .then(() => {})
      .catch((error) => {
        throw new ReceiptFailure(message(error));
      });
  }
  /** A finished job's log becomes one line; the uncompacted log stays valid on failure. */
  private async compact(task: Task): Promise<void> {
    const { job, request, undo, intent } = task;
    await this.journal?.compact({ job, request, undo, intent }).catch(() => {});
  }
  all(): OperationJob[] {
    return [...this.tasks.values()].map((task) => structuredClone(task.job));
  }
  /** Exact native Trash receipts only; a filename alone never proves an origin. */
  async trashOrigins(): Promise<TrashOrigin[]> {
    await this.load();
    return [...this.tasks.values()].flatMap((task) =>
      task.undo
        .filter((step) => step.trash && path.isAbsolute(step.to))
        .map((step) => ({ file: step.from, originalPath: step.to, identity: step.identity })),
    );
  }
  /** Minimal durable provenance; bookmarks, staging paths and Undo internals stay private. */
  observedLinks(): ObservedOperationLink[] {
    const result: ObservedOperationLink[] = [];
    for (const task of [...this.tasks.values()].slice(-100).toReversed()) {
      const sources = new Map(
        task.request.expectedSources?.map((source) => [source.path, source.version]) ?? [],
      );
      const targets = new Map(task.undo.map((step) => [step.from, step]));
      for (let index = task.job.completed.length - 1; index >= 0; index--) {
        const item = task.job.completed[index];
        if (!item?.source || !item.destination || item.source === item.destination) continue;
        const source = sources.get(item.source),
          target = targets.get(item.destination);
        result.push({
          id: task.job.id + ':' + index,
          revision: task.job.revision,
          kind: task.job.kind,
          source: item.source,
          destination: item.destination,
          ...(source ? { sourceVersion: source } : {}),
          ...(target
            ? {
                targetVersion: {
                  identity: target.identity,
                  modified: target.modified,
                  size: target.size,
                },
              }
            : {}),
        });
        if (result.length === 2000) return result.reverse();
      }
    }
    return result.reverse();
  }
  start(request: OperationRequest, redo = false): string {
    if (this.stopped) throw new Error('The file operation queue has closed.');
    // A new operation ends earlier Redo offers, as in other applications.
    if (!redo)
      for (const task of this.tasks.values())
        if (task.redo) {
          task.redo = undefined;
          task.job.redoable = false;
          this.emit(task);
        }
    if (request.kind === 'alias' && process.platform !== 'darwin')
      throw new Error('Finder aliases require macOS.');
    const sources = [...new Set(request.sources.map(absolute))];
    // A selected descendant is already carried by its selected parent.
    const roots = operationRoots(sources);
    if (request.destination) request = { ...request, destination: absolute(request.destination) };
    if (request.expectedSources) {
      // Reviewed versions are matched by path; a spelling that matched no source
      // would silently skip its check, so normalize and require a match.
      const expectedSources = request.expectedSources.map((expected) => ({
        ...expected,
        path: absolute(expected.path),
      }));
      if (
        expectedSources.some(
          (expected) =>
            !roots.some(
              (root) => expected.path === root || expected.path.startsWith(root + path.sep),
            ),
        )
      )
        throw new Error('The reviewed items no longer match this operation. Prepare a new plan.');
      request = { ...request, expectedSources };
    }
    if (request.name !== undefined) validName(request.name);
    if (request.name && ['copy', 'move', 'transfer'].includes(request.kind) && roots.length !== 1)
      throw new Error('A destination name requires a single source.');
    if (
      ['copy', 'move', 'transfer', 'mkdir', 'mkfile', 'compress', 'extract'].includes(
        request.kind,
      ) &&
      !request.destination
    )
      throw new Error('Choose a destination folder.');
    if (!['mkdir', 'mkfile'].includes(request.kind) && !roots.length)
      throw new Error('Select at least one file.');
    if (request.kind === 'rename' && (roots.length !== 1 || !request.name))
      throw new Error('Rename one file at a time.');
    if (request.kind === 'mkdir' && !request.name) throw new Error('Enter a folder name.');
    if (request.kind === 'mkfile' && !request.name) throw new Error('Enter a file name.');
    if (
      request.kind === 'compress' &&
      (!request.name || !request.name.toLowerCase().endsWith('.zip'))
    )
      throw new Error('Enter a ZIP archive name.');
    if (request.kind === 'convert') {
      if (!request.conversion) throw new Error('Choose an image quick action.');
      if (
        roots.some((file) => !convertibleExtensions.has(path.extname(file).slice(1).toLowerCase()))
      )
        throw new Error('Quick actions work on JPEG, PNG, TIFF, HEIC, GIF, BMP and WebP images.');
      if (
        request.conversion === 'pdf' &&
        (!request.destination || !request.name?.toLowerCase().endsWith('.pdf'))
      )
        throw new Error('Choose a folder and a PDF name.');
    }
    // A PDF is one output from every source; other conversions create one file per image.
    const single =
      ['mkdir', 'mkfile', 'compress'].includes(request.kind) ||
      (request.kind === 'convert' && request.conversion === 'pdf');
    const job: OperationJob = {
      id: randomUUID(),
      revision: 0,
      kind: request.kind,
      status: 'queued',
      sources: roots,
      destination: request.destination,
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 0,
      itemsTotal: single ? 1 : roots.length,
      completed: [],
      errors: [],
      errorCount: 0,
      undoable: false,
    };
    const task: Task = {
      job,
      request: { ...request, sources: roots },
      abort: new AbortController(),
      undo: [],
      lastProgress: 0,
    };
    this.tasks.set(job.id, task);
    this.queue.push(task);
    this.emit(task);
    void this.run();
    // Completed history is bounded. Never discard pending collision decisions.
    if (this.tasks.size > 100)
      for (const [id, old] of this.tasks) {
        if (this.tasks.size <= 100) break;
        if (['completed', 'failed', 'cancelled'].includes(old.job.status)) {
          this.tasks.delete(id);
          void this.journal?.forget(id).catch(() => {});
        }
      }
    return job.id;
  }
  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task || ['completed', 'failed', 'cancelled'].includes(task.job.status)) return;
    task.abort.abort();
    task.decision?.('cancel');
  }
  async quiesce(root: string): Promise<void> {
    // Stopping work is always safe, so other case and Unicode spellings match too.
    const key = (file: string) => file.normalize('NFC').toLocaleLowerCase('en-US');
    const base = key(root.replace(/[\\/]$/, ''));
    const related = (file: string) => key(file) === base || key(file).startsWith(base + path.sep);
    for (const task of this.tasks.values())
      if (
        task.request.sources.some(related) ||
        (task.request.destination && related(task.request.destination))
      )
        this.cancel(task.job.id);
    await this.exclusive(async () => {});
  }
  resolve(id: string, decision: CollisionDecision, applyAll: boolean): void {
    const task = this.tasks.get(id);
    if (!task?.decision) throw new Error('This collision has already been resolved.');
    if (applyAll) task.policy = decision;
    task.decision(decision);
  }
  async close(): Promise<void> {
    this.stopped = true;
    for (const task of this.tasks.values()) this.cancel(task.job.id);
    if (this.running) await new Promise<void>((resolve) => this.idle.push(resolve));
    await this.journal?.flush();
  }
  async undo(id: string): Promise<void> {
    await this.load();
    return this.exclusive(async () => this.undoTask(id));
  }
  private async undoTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task?.job.undoable) throw new Error('This operation cannot be undone.');
    await this.access(
      task.undo.flatMap((step) =>
        step.trash ? [step.to] : step.remove ? [step.from] : [step.from, step.to],
      ),
    );
    // Validate the entire undo first, so a known conflict never produces a partial undo.
    for (const step of task.undo) {
      await this.withStep(step, async () => {
        const info = await lstat(step.from);
        if (
          `${info.dev}:${info.ino}` !== step.identity ||
          (!info.isDirectory() && (info.mtimeMs !== step.modified || info.size !== step.size))
        )
          throw new Error(`Cannot undo: ${step.from} changed since the operation.`);
        if (step.proof && (await outputProof(step.from)) !== step.proof)
          throw new Error(`Cannot undo: ${step.from} or its contents changed since the operation.`);
        if (!step.remove && (await exists(step.to))) {
          const destination = await lstat(step.to);
          const willVacate = task.undo
            .slice(task.undo.indexOf(step) + 1)
            .some((other) => other.from === step.to);
          if (
            !willVacate &&
            (!step.caseOnly || `${destination.dev}:${destination.ino}` !== step.identity)
          )
            throw new Error(`Cannot undo: ${step.to} already exists.`);
        }
      });
    }
    for (const step of [...task.undo].reverse()) {
      task.intent = { source: step.from, destination: step.remove ? undefined : step.to };
      await this.checkpoint();
      await this.withStep(step, () =>
        fileCoordination.run(
          step.remove
            ? [{ path: step.from, mode: 'delete' }]
            : [
                { path: step.from, mode: 'move' },
                { path: step.to, mode: 'write' },
              ],
          async (signal) => {
            signal?.throwIfAborted();
            await this.access(step.remove ? [step.from] : [step.from, step.to]);
            const current = await lstat(step.from);
            if (
              `${current.dev}:${current.ino}` !== step.identity ||
              (!current.isDirectory() &&
                (current.size !== step.size || current.mtimeMs !== step.modified))
            )
              throw new Error(`Cannot undo: ${step.from} changed since the operation.`);
            if (step.proof && (await outputProof(step.from)) !== step.proof)
              throw new Error(`Cannot undo: ${step.from} changed since the operation.`);
            if (step.remove) await this.trash(step.from);
            else if (step.caseOnly && (await exists(step.to)))
              await this.changeCase(step.from, step.to);
            // A Trash bookmark authorizes its item, rather than browsing the Trash
            // directory. Restore it with one exclusive native rename; hard-link
            // publication requires different sandbox rights and can fall back to
            // streaming a resource fork unnecessarily.
            else if (step.trash && process.platform === 'darwin')
              await macFiles().renameExclusive(
                fileCoordination.path(step.from),
                fileCoordination.path(step.to),
                fileCoordination.purpose(),
              );
            else await publish(step.from, step.to, this.access);
          },
        ),
      );
      if (!step.remove) this.filesChanged([{ source: step.from, destination: step.to }]);
      task.undo.splice(task.undo.indexOf(step), 1);
      task.intent = undefined;
      await this.checkpoint();
    }
    task.job.undoable = false;
    // Redo may only act on the very items Undo put back.
    const expectedSources: NonNullable<OperationRequest['expectedSources']> = [];
    for (const file of task.request.sources)
      try {
        expectedSources.push({ path: file, version: sourceVersion(await entry(file)) });
      } catch {
        // A source that is absent after Undo (a created output) needs no pin.
      }
    task.redo = { ...task.request, expectedSources };
    task.job.redoable = true;
    this.emit(task);
    await this.checkpoint();
    await this.compact(task);
  }
  /** Starts an undone operation again as a new job, with every usual check. */
  redo(id: string): string {
    const task = this.tasks.get(id);
    if (!task?.redo) throw new Error('This operation cannot be redone.');
    const request = task.redo;
    task.redo = undefined;
    task.job.redoable = false;
    this.emit(task);
    return this.start(request, true);
  }
  private withStep<T>(step: UndoStep, work: () => Promise<T>): Promise<T> {
    return step.trash
      ? this.receiptAccess(
          { path: step.from, directory: !!step.directory, bookmark: step.bookmark },
          work,
        )
      : work();
  }
  /** `replaced` pins a collision's existing item: anything else now at that path is kept. */
  private async trashItem(task: Task, file: string, replaced?: Replaced): Promise<void> {
    const receipt = await fileCoordination.run(
      [{ path: file, mode: 'delete' }],
      async (signal) => {
        signal?.throwIfAborted();
        this.check(task);
        const actual = fileCoordination.path(file);
        await this.access([actual]);
        signal?.throwIfAborted();
        if (replaced && !unchanged(await lstat(actual), replaced))
          throw new Error(
            'The existing item changed after Replace was chosen, so it was kept. Retry to review it again.',
          );
        for (const expected of task.request.expectedSources ?? []) {
          if (expected.path !== file && !expected.path.startsWith(file + path.sep)) continue;
          const current = fileCoordination.path(expected.path);
          await this.access([current]);
          if (!sameSourceVersion(expected.version, sourceVersion(await entry(current))))
            throw new Error('The source changed after review. This item was not moved to Trash.');
        }
        signal?.throwIfAborted();
        return this.trash(actual);
      },
      task.abort.signal,
    );
    if (!receipt) return;
    try {
      await this.receiptAccess(receipt, async () => {
        const proof = await outputProof(receipt.path);
        if (!proof) return;
        const info = await lstat(receipt.path);
        task.undo.push({
          from: receipt.path,
          to: file,
          trash: true,
          bookmark: receipt.bookmark,
          directory: receipt.directory,
          proof,
          identity: `${info.dev}:${info.ino}`,
          modified: info.mtimeMs,
          size: info.size,
        });
      });
    } catch (error) {
      // The item is already in the Trash. Report the missing Undo record rather
      // than presenting a completed move as a failure.
      task.job.errors.push({
        path: file,
        message:
          `Moved to the Trash at ${receipt.path}, but Undo is unavailable: ${message(error)}`.slice(
            0,
            4000,
          ),
      });
    }
    await this.checkpoint();
  }
  /** Put a replaced item back when its replacement could not be published. */
  private async restoreReplaced(task: Task, destination: string): Promise<boolean> {
    const step = task.undo.findLast((item) => item.trash && item.to === destination);
    if (!step) return false;
    try {
      if (await exists(destination)) return false;
      await this.withStep(step, () =>
        process.platform === 'darwin'
          ? macFiles().renameExclusive(
              fileCoordination.path(step.from),
              fileCoordination.path(step.to),
              fileCoordination.purpose(),
            )
          : publish(step.from, step.to, this.access),
      );
    } catch {
      return false;
    }
    task.undo.splice(task.undo.indexOf(step), 1);
    return true;
  }
  /** Replace trashes the existing item only once its replacement is ready to publish. */
  private async publishReplacing(
    task: Task,
    source: string,
    destination: string,
    replaced?: Replaced,
  ): Promise<void> {
    // Without Replace, the exclusive publication below refuses an existing destination.
    if (replaced) {
      await this.protection.check(destination, 'replaced');
      await this.trashItem(task, destination, replaced);
    }
    try {
      await publish(source, destination, this.access, this.transferJob(task));
    } catch (error) {
      if (replaced && !(await this.restoreReplaced(task, destination)))
        throw new Error(
          `${message(error)} The replaced item is in the Trash; Undo in Recent file operations can restore it.`,
        );
      throw error;
    }
  }
  exclusive<T>(
    work: (
      publish: (
        source: string,
        destination: string,
        guard?: () => Promise<void>,
        signal?: AbortSignal,
      ) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const task = this.exclusiveQueue
      .catch(() => {})
      .then(async () => {
        while (this.running) await new Promise<void>((resolve) => this.idle.push(resolve));
        if (this.stopped) throw new Error('The operation service is closed.');
        this.running = true;
        try {
          return await work((source, destination, guard, signal) =>
            publish(source, destination, this.access, undefined, guard, signal),
          );
        } finally {
          this.running = false;
          for (const resolve of this.idle.splice(0)) resolve();
          void this.run();
        }
      });
    this.exclusiveQueue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private emit(task: Task): void {
    task.job.revision++;
    task.job.errorCount = task.job.errors.length;
    task.lastProgress = performance.now();
    this.changed(structuredClone(task.job));
  }
  private progress(task: Task): void {
    const now = performance.now();
    if (now - task.lastProgress < 80) return;
    task.lastProgress = now;
    const job = task.job;
    job.revision++;
    job.errorCount = job.errors.length;
    this.progressed({
      id: job.id,
      revision: job.revision,
      current: job.current,
      bytesDone: job.bytesDone,
      bytesTotal: job.bytesTotal,
      itemsDone: job.itemsDone,
      itemsTotal: job.itemsTotal,
      errorCount: job.errorCount,
    });
  }
  private check(task: Task): void {
    task.abort.signal.throwIfAborted();
  }
  private transferJob(task: Task): TransferJob {
    return {
      check: () => this.check(task),
      signal: task.abort.signal,
      started: (file, bytes) => {
        task.job.current = file;
        task.job.bytesTotal += bytes;
      },
      copied: (bytes) => {
        task.job.bytesDone += bytes;
        this.progress(task);
      },
    };
  }
  private async changeCase(source: string, destination: string, task?: Task): Promise<void> {
    const temporary = path.join(path.dirname(source), `.viewer-rename-${randomUUID()}`);
    if (task) {
      // Journal the hidden intermediate name first, so recovery can find it after a crash.
      task.intent = { source, destination, staging: temporary };
      await this.checkpoint();
    }
    await publish(source, temporary, this.access, task && this.transferJob(task));
    try {
      await publish(temporary, destination, this.access, task && this.transferJob(task));
    } catch (error) {
      // Restore only when the old name is still available; preserve the intermediate otherwise.
      await publish(temporary, source, this.access).catch(() => undefined);
      throw error;
    }
  }
  private async target(task: Task, source: string, destination: string): Promise<Target | null> {
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!existing) return { path: destination };
    // Creating something new never replaces what is already there.
    let replaceable = !['mkdir', 'mkfile'].includes(task.request.kind);
    if (source) {
      // Another spelling of the source itself must never be offered for Replace.
      if (sameItem(await lstat(source), existing)) {
        if (task.request.kind === 'copy') return { path: await keepBothName(destination) };
        throw new Error('Source and destination are the same item.');
      }
      if (await holds(existing, source)) replaceable = false;
    }
    let decision = task.policy;
    if (!decision) {
      task.job.status = 'collision';
      task.job.collision = { source, destination, ...(replaceable ? {} : { replaceable }) };
      const pending = new Promise<CollisionDecision>((resolve) => {
        task.decision = resolve;
      });
      this.emit(task);
      decision = await pending;
      task.decision = undefined;
      task.job.collision = undefined;
      task.job.status = 'running';
      this.emit(task);
    }
    this.check(task);
    if (decision === 'cancel') {
      task.abort.abort();
      this.check(task);
    }
    if (decision === 'skip') return null;
    if (decision === 'keep-both') return { path: await keepBothName(destination) };
    if (!replaceable)
      throw new Error(
        task.request.kind === 'mkdir' || task.request.kind === 'mkfile'
          ? 'A new item cannot replace an existing one. Choose Keep both.'
          : 'The existing item contains the source, so it cannot be replaced. Choose Keep both or Skip.',
      );
    return { path: destination, replaces: existing };
  }
  private async transfer(
    task: Task,
    source: string,
    destination: string,
    move: boolean,
    replaced?: Replaced,
  ): Promise<boolean> {
    if (move && (await lstat(source)).dev === (await stat(path.dirname(destination))).dev) {
      try {
        await this.publishReplacing(task, source, destination, replaced);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      }
    }
    const stage = await privateStage(path.dirname(destination), '.viewer-transfer-', this.trash);
    const staging = stage.file;
    task.intent = { source, destination, staging };
    const fingerprints: CopyFingerprint[] = [];
    try {
      await this.checkpoint();
      await copyTree(this.transferJob(task), source, staging, fingerprints, this.access);
      this.check(task);
      // Do not clobber a file created while the transfer was in flight.
      if (!replaced && (await exists(destination)))
        throw new Error(
          'A file appeared at the destination during the transfer. Retry to choose a collision action.',
        );
      await this.publishReplacing(task, staging, destination, replaced);
      if (move) {
        for (const fingerprint of fingerprints) {
          const info = await lstat(fingerprint.file);
          if (
            info.dev !== fingerprint.info.dev ||
            info.ino !== fingerprint.info.ino ||
            info.mtimeMs !== fingerprint.info.mtimeMs ||
            info.ctimeMs !== fingerprint.info.ctimeMs ||
            info.size !== fingerprint.info.size ||
            (fingerprint.children &&
              JSON.stringify((await readdir(fingerprint.file)).sort()) !==
                JSON.stringify(fingerprint.children))
          )
            throw new Error(
              'Source changed during the move. The completed copy and the original have both been kept.',
            );
        }
        // The copy's directory entries must be durable on its volume before any
        // original is removed from the other volume.
        await syncDirectories(destination);
        // Remove only the copied entries. A newly created child keeps its directory
        // nonempty, so it survives even if it appears after validation.
        for (const fingerprint of [...fingerprints].reverse()) {
          await fileCoordination.run(
            [{ path: fingerprint.file, mode: 'delete' }],
            async (signal) => {
              signal?.throwIfAborted();
              this.check(task);
              const file = fileCoordination.path(fingerprint.file);
              await this.access([file]);
              const current = await lstat(file);
              if (
                current.dev !== fingerprint.info.dev ||
                current.ino !== fingerprint.info.ino ||
                (!current.isDirectory() &&
                  (current.ctimeMs !== fingerprint.info.ctimeMs ||
                    current.size !== fingerprint.info.size))
              )
                throw new Error(
                  'Source changed during the move. The completed copy and remaining original items have been kept.',
                );
              if (current.isDirectory()) await removeEmptyDirectory(file);
              else await unlinkVerified(file);
            },
            task.abort.signal,
          );
        }
      }
      return false;
    } finally {
      await this.disposeStage(task, stage);
    }
  }
  /** Cleanup never replaces an item's real outcome; kept partial content is reported. */
  private async disposeStage(
    task: Task,
    stage: { file: string; dispose(): Promise<string | undefined> },
  ): Promise<void> {
    let kept: string | undefined;
    try {
      kept = await stage.dispose();
    } catch (error) {
      task.job.errors.push({ path: path.dirname(stage.file), message: message(error) });
      return;
    }
    if (kept)
      task.job.errors.push({
        path: kept,
        message:
          'Partial temporary content could not be moved to the Trash, so it was kept here for inspection.',
      });
  }
  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let currentTask: Task | undefined;
    try {
      await this.load();
      while (this.queue.length) {
        const task = this.queue.shift()!;
        currentTask = task;
        const { job, request } = task;
        job.status = 'running';
        this.emit(task);
        const single =
          ['mkdir', 'mkfile', 'compress'].includes(request.kind) ||
          (request.kind === 'convert' && request.conversion === 'pdf');
        const items = single ? [''] : request.sources;
        for (const source of items) {
          try {
            this.check(task);
            await this.access(
              [source, request.destination].filter((file): file is string => !!file),
            );
            for (const expected of request.expectedSources ?? []) {
              if (expected.path !== source && !expected.path.startsWith(source + path.sep))
                continue;
              await this.access([expected.path]);
              if (!sameSourceVersion(expected.version, sourceVersion(await entry(expected.path))))
                throw new Error('The source changed after review. Prepare a new plan.');
            }
            job.current = source || request.destination;
            task.intent = { source, destination: request.destination };
            // Each intent is made durable immediately before the first change it covers;
            // Trash is the only change that follows directly.
            if (request.kind === 'trash') await this.checkpoint();
            this.progress(task);
            let destination: string | undefined;
            const move =
              request.kind === 'move' ||
              request.kind === 'rename' ||
              (request.kind === 'transfer' &&
                (await lstat(source)).dev === (await lstat(request.destination!)).dev);
            let undoable = false,
              caseOnly = false;
            if (request.kind === 'trash') await this.protection.check(source, 'moved to the Trash');
            else if (move) await this.protection.check(source, 'moved or renamed');
            if (request.kind === 'trash') await this.trashItem(task, source);
            else {
              destination = single
                ? path.join(request.destination!, validName(request.name!))
                : request.kind === 'convert'
                  ? conversionOutput(source, request.conversion!)
                  : request.kind === 'extract'
                    ? path.join(
                        request.destination!,
                        validName(
                          path.basename(source).replace(/\.(?:tar\.gz|tgz|zip|tar)$/i, '') ||
                            'Extracted archive',
                        ),
                      )
                    : request.kind === 'rename'
                      ? path.join(path.dirname(source), validName(request.name!))
                      : request.kind === 'duplicate'
                        ? await keepBothName(source)
                        : request.kind === 'alias'
                          ? await keepBothName(source + ' alias')
                          : path.join(request.destination!, request.name ?? path.basename(source));
              if (source === destination) throw new Error('Source and destination are the same.');
              await this.access([destination]);
              task.intent = { source, destination };
              if (source && destination.startsWith(source + path.sep))
                throw new Error('A folder cannot be placed inside itself.');
              if (
                request.kind === 'compress' &&
                request.sources.some(
                  (file) => destination === file || destination!.startsWith(file + path.sep),
                )
              )
                throw new Error('Save the archive outside the selected folders.');
              // Resolve symlinks in the destination's ancestry as well.
              if (source && (await lstat(source)).isDirectory()) {
                const { realpath } = await import('node:fs/promises');
                const realSource = await realpath(source);
                const realDestination = path.join(
                  await realpath(path.dirname(destination)),
                  path.basename(destination),
                );
                if (
                  realDestination === realSource ||
                  realDestination.startsWith(realSource + path.sep)
                )
                  throw new Error(
                    'A folder cannot be placed inside itself through a symbolic link.',
                  );
              }
              // Case-only renames on case-insensitive macOS volumes need an intermediate name.
              const sourceInfo = source ? await lstat(source) : null;
              const destInfo = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return null;
                throw error;
              });
              if (
                request.kind === 'rename' &&
                destInfo &&
                sourceInfo &&
                destInfo.dev === sourceInfo.dev &&
                destInfo.ino === sourceInfo.ino
              ) {
                await this.changeCase(source, destination, task);
                undoable = true;
                caseOnly = true;
              } else {
                const resolved = await this.target(task, source, destination);
                if (!resolved) {
                  job.itemsDone++;
                  this.progress(task);
                  continue;
                }
                destination = resolved.path;
                const replaced = resolved.replaces;
                this.check(task);
                await this.access([destination]);
                task.intent = { source, destination };
                await this.checkpoint();
                if (request.kind === 'mkdir')
                  await fileCoordination.run(
                    [{ path: destination, mode: 'write' }],
                    async (signal) => {
                      signal?.throwIfAborted();
                      this.check(task);
                      await this.access([fileCoordination.path(destination!)]);
                      await mkdir(fileCoordination.path(destination!));
                    },
                    task.abort.signal,
                  );
                else if (request.kind === 'mkfile')
                  await fileCoordination.run(
                    [{ path: destination, mode: 'write' }],
                    async (signal) => {
                      signal?.throwIfAborted();
                      this.check(task);
                      await this.access([fileCoordination.path(destination!)]);
                      // Exclusive creation: an item that appeared meanwhile is never touched.
                      await (await open(fileCoordination.path(destination!), 'wx', 0o644)).close();
                    },
                    task.abort.signal,
                  );
                else if (request.kind === 'alias') {
                  const stage = await privateStage(
                    path.dirname(destination),
                    '.viewer-alias-',
                    this.trash,
                  );
                  task.intent = { source, destination, staging: stage.file };
                  try {
                    await this.checkpoint();
                    await fileCoordination.run(
                      [
                        { path: source, mode: 'metadata' },
                        { path: stage.file, mode: 'write' },
                      ],
                      async (signal) => {
                        signal?.throwIfAborted();
                        await this.access([
                          fileCoordination.path(source),
                          fileCoordination.path(stage.file),
                        ]);
                        signal?.throwIfAborted();
                        await macFiles().alias(
                          fileCoordination.path(source),
                          fileCoordination.path(stage.file),
                        );
                      },
                      task.abort.signal,
                    );
                    this.check(task);
                    await this.publishReplacing(task, stage.file, destination, replaced);
                  } finally {
                    await this.disposeStage(task, stage);
                  }
                } else if (request.kind === 'compress' || request.kind === 'extract') {
                  const stage = await privateStage(
                    path.dirname(destination),
                    '.viewer-archive-',
                    this.trash,
                  );
                  const staging = stage.file;
                  task.intent = { source, destination, staging };
                  try {
                    await this.checkpoint();
                    const work = {
                      signal: task.abort.signal,
                      access: this.access,
                      progress: (file: string, done: number, total: number) => {
                        job.current = file;
                        job.bytesDone = done;
                        job.bytesTotal = total;
                        this.progress(task);
                      },
                    };
                    if (request.kind === 'compress')
                      await createArchive(request.sources, staging, work);
                    else await extractArchive(source, staging, work);
                    this.check(task);
                    await this.publishReplacing(task, staging, destination, replaced);
                  } finally {
                    await this.disposeStage(task, stage);
                  }
                } else if (request.kind === 'convert') {
                  const stage = await privateStage(
                    path.dirname(destination),
                    '.viewer-convert-',
                    this.trash,
                  );
                  // The staged file keeps the output's extension, which picks its encoding.
                  const staging = stage.file + path.extname(destination);
                  task.intent = { source, destination, staging };
                  try {
                    await this.checkpoint();
                    const inputs = source ? [source] : request.sources;
                    await this.access([...inputs, staging]);
                    job.current = source || destination;
                    await this.images.convert(
                      request.conversion!,
                      inputs,
                      staging,
                      task.abort.signal,
                    );
                    this.check(task);
                    await this.publishReplacing(task, staging, destination, replaced);
                  } finally {
                    await this.disposeStage(task, stage);
                  }
                } else undoable = await this.transfer(task, source, destination, move, replaced);
              }
              if (undoable && move) {
                const info = await lstat(destination);
                task.undo.push({
                  from: destination,
                  to: source,
                  identity: `${info.dev}:${info.ino}`,
                  modified: info.mtimeMs,
                  size: info.size,
                  caseOnly,
                });
              }
              if (
                !move &&
                destination &&
                [
                  'copy',
                  'transfer',
                  'duplicate',
                  'alias',
                  'mkdir',
                  'mkfile',
                  'compress',
                  'extract',
                  'convert',
                ].includes(request.kind)
              ) {
                const proof = await outputProof(destination);
                if (proof) {
                  const info = await lstat(destination);
                  task.undo.push({
                    from: destination,
                    to: '',
                    remove: true,
                    proof,
                    identity: `${info.dev}:${info.ino}`,
                    modified: info.mtimeMs,
                    size: info.size,
                  });
                }
              }
            }
            job.completed.push({ source, destination });
            if (destination && move) this.filesChanged([{ source, destination }]);
            job.itemsDone++;
            task.intent = undefined;
          } catch (error) {
            if (error instanceof ReceiptFailure) throw error;
            if (task.abort.signal.aborted) break;
            job.errors.push({
              path: source || request.destination!,
              message: message(error).slice(0, 4000),
            });
            job.itemsDone++;
          }
          this.progress(task);
          await this.checkpoint();
        }
        job.status = task.abort.signal.aborted
          ? 'cancelled'
          : job.errors.length && !job.completed.length
            ? 'failed'
            : 'completed';
        job.undoable = !!task.undo.length;
        job.current = undefined;
        // Terminal failures have a known outcome. Keep their recovery paths,
        // but reserve an in-flight intent for an actually interrupted mutation.
        if (task.intent) job.recovery = task.intent;
        task.intent = undefined;
        this.emit(task);
        await this.checkpoint();
        await this.compact(task);
        currentTask = undefined;
      }
    } catch (error) {
      for (const task of this.tasks.values())
        if (task === currentTask || ['queued', 'running', 'collision'].includes(task.job.status)) {
          task.job.status = 'failed';
          task.job.errors.push({
            path: task.job.current || task.job.destination || task.job.sources[0] || '',
            message:
              'Operation receipts could not be saved. Further file changes were stopped. ' +
              message(error),
          });
          task.job.recovery = task.intent ?? task.job.recovery;
          task.job.undoable = !!task.undo.length;
          this.emit(task);
        }
      this.queue.length = 0;
    } finally {
      this.running = false;
      for (const resolve of this.idle.splice(0)) resolve();
    }
  }
}
