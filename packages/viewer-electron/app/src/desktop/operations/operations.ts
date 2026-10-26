import type { FileChange } from '../../domain/files/changes';
import type { TrashOrigin } from '../../domain/files/trash';
import type { ObservedOperationLink } from '../../domain/files/relationships';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  CollisionDecision,
  OperationJob,
  OperationProgress,
  OperationRequest,
} from '../../domain/contracts';
import { absolute, exists, message, validName, entry } from '../files/filesystem';
import {
  sourceVersion,
  sameSourceVersion,
  type SourceVersion,
} from '../../domain/files/inspection';
import { macFiles, type TrashReceipt, type ReceiptAccess } from '../native/macos-files';
import { createArchive, extractArchive } from './archive-jobs';
import { OperationLog, outputProof, type OperationReceipt } from './operation-journal';
import {
  verifyReviewedFile,
  type ReviewedFile,
  type ReviewedFileExpectation,
} from '../native/reviewed-file';
import { privateStage } from './staging';
import { keepMetadata } from '../files/file-metadata';
import { MAX_TEXT_BYTES, textChangedCode } from '../../domain/editing/documents';
import { fileCoordination } from '../files/file-coordination';
import { removeEmptyDirectory, unlinkVerified } from './removal';
import { ProtectedPaths } from '../files/protected-paths';
import {
  conversionOutput,
  convertibleExtensions,
  unavailableConverter,
  type ImageConverter,
} from './image-convert';
import { holds, sameItem, unchanged, type Replaced } from '../files/item-identity';
import {
  validateTransform,
  transformExtension,
  combinedTransform,
} from '../../domain/operations/transforms';
import type { TransformExecutor } from '../transforms/transforms';
import {
  aliasName,
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
  reviewedFile?: ReviewedFile;
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
  /** Runs as exclusive work rather than from the queue (a text save), counted once as pending. */
  exclusive?: boolean;
}
const changedOnDisk = () =>
  Object.assign(
    new Error('The file changed on disk since it was opened. Reload it, or save over it.'),
    { code: textChangedCode },
  );
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

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
  /** Jobs whose state changed since their last durable record. */
  private dirty = new Set<Task>();
  private queue: Task[] = [];
  private running = false;
  private exclusiveQueue: Promise<void> = Promise.resolve();
  private stopped = false;
  private idle: (() => void)[] = [];
  /** The queued job in progress and exclusive work in progress, which quiesce waits for. */
  private active?: Task;
  private exclusiveActive = false;
  /** Exclusive work asked for and not finished: an Undo, a plan apply, a Trash restore. */
  private exclusivePending = 0;
  /** Each job's Undo in progress, which a second Undo of it joins. */
  private undoing = new Map<string, Promise<void>>();
  private settled: (() => void)[] = [];
  private journal?: OperationLog;
  private loaded?: Promise<void>;
  constructor(
    private trash: (
      file: string,
      expected?: ReviewedFileExpectation,
    ) => Promise<void | TrashReceipt>,
    private changed: (job: OperationJob) => void,
    private progressed: (progress: OperationProgress) => void = () => {},
    private filesChanged: (changes: FileChange[]) => void = () => {},
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    dataPath?: string,
    private receiptAccess: ReceiptAccess = async (_receipt, work) => work(),
    private notice: (message: string) => void = () => {},
    private protection = new ProtectedPaths(),
    private images: ImageConverter = unavailableConverter,
    private transforms?: TransformExecutor,
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
      // A forward job clears its intent before its last record, so an intent beside a finished
      // status is an Undo's, whichever way the job itself ended (2026-10-20: only a completed
      // job's was recognised, and a cancelled job offered its interrupted Undo again).
      const interruptedUndo =
        !!receipt.intent && ['completed', 'failed', 'cancelled'].includes(job.status);
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
      const task: Task = {
        job,
        request: receipt.request,
        undo: receipt.undo,
        abort: new AbortController(),
        lastProgress: 0,
        intent: receipt.intent,
      };
      this.tasks.set(job.id, task);
      // An interrupted job's new status reaches its log with the next checkpoint.
      this.dirty.add(task);
    }
  }
  /** Records `task` and every job that changed since the last checkpoint, so a job is
   * journaled however many others are queued. Each appends only what changed. */
  private checkpoint(task?: Task): Promise<void> {
    const journal = this.journal;
    if (task) this.dirty.add(task);
    const changed = [...this.dirty];
    this.dirty.clear();
    if (!journal) return Promise.resolve();
    return Promise.all(
      changed.map(({ job, request, undo, intent }) =>
        journal.record({ job, request, undo, intent }),
      ),
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
    return this.startOperation(request, redo);
  }

  /** A native review pins the script through queueing, coordination and the OS Trash adapter. */
  async trashReviewedFile(reviewed: ReviewedFile): Promise<void> {
    const id = this.startOperation(
      {
        kind: 'trash',
        sources: [reviewed.path],
        expectedSources: [{ path: reviewed.path, version: reviewed.version }],
      },
      false,
      reviewed,
    );
    const task = this.tasks.get(id)!;
    while (['queued', 'running', 'collision'].includes(task.job.status))
      await new Promise<void>((resolve) => this.settled.push(resolve));
    if (task.job.status !== 'completed')
      throw new Error(task.job.errors[0]?.message || 'The shell command was preserved.');
  }

  private startOperation(
    request: OperationRequest,
    redo = false,
    reviewedFile?: ReviewedFile,
  ): string {
    if (this.stopped) throw new Error('The file operation queue has closed.');
    if (
      request.kind === 'rewrite' ||
      request.textSHA256 !== undefined ||
      request.textBytes !== undefined
    )
      throw new Error('Save text from its editor: a save is not an ordinary file operation.');
    if (!redo) this.endRedo();
    if (request.kind === 'alias' && process.platform !== 'darwin')
      throw new Error('Finder aliases require macOS.');
    const sources = [...new Set(request.sources.map(absolute))];
    // A selected descendant is already carried by its selected parent.
    const roots = operationRoots(sources);
    if (request.destination) request = { ...request, destination: absolute(request.destination) };
    // Reviewed versions and contents are matched by path; a spelling that matched no source
    // would silently skip its check, so normalize and require a match.
    const pinned = <T extends { path: string }>(reviewed: T[]): T[] => {
      const normalized = reviewed.map((expected) => ({
        ...expected,
        path: absolute(expected.path),
      }));
      if (
        normalized.some(
          (expected) =>
            !roots.some(
              (root) => expected.path === root || expected.path.startsWith(root + path.sep),
            ),
        )
      )
        throw new Error('The reviewed items no longer match this operation. Prepare a new plan.');
      return normalized;
    };
    if (request.expectedSources)
      request = { ...request, expectedSources: pinned(request.expectedSources) };
    if (request.expectedContents)
      request = { ...request, expectedContents: pinned(request.expectedContents) };
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
      if (request.transform) {
        if (!this.transforms)
          throw new Error('Transform processors are unavailable in this build.');
        if (request.conversion) throw new Error('Choose one conversion plan.');
        request.transform = validateTransform(request.transform, roots.length);
        if (combinedTransform(request.transform) && (!request.destination || !request.name))
          throw new Error('Choose a destination folder and output name.');
      } else {
        if (!request.conversion) throw new Error('Choose an image quick action.');
        if (
          roots.some(
            (file) => !convertibleExtensions.has(path.extname(file).slice(1).toLowerCase()),
          )
        )
          throw new Error('Quick actions work on JPEG, PNG, TIFF, HEIC, GIF, BMP and WebP images.');
        if (
          request.conversion === 'pdf' &&
          (!request.destination || !request.name?.toLowerCase().endsWith('.pdf'))
        )
          throw new Error('Choose a folder and a PDF name.');
      }
    }
    // A PDF is one output from every source; other conversions create one file per image.
    const single =
      ['mkdir', 'mkfile', 'compress'].includes(request.kind) ||
      (request.kind === 'convert' &&
        (request.conversion === 'pdf' || combinedTransform(request.transform)));
    const task = this.add({ ...request, sources: roots }, single ? 1 : roots.length);
    task.reviewedFile = reviewedFile;
    this.queue.push(task);
    void this.run();
    return task.job.id;
  }
  /** A new operation ends earlier Redo offers, as in other applications. */
  private endRedo(): void {
    for (const task of this.tasks.values())
      if (task.redo) {
        task.redo = undefined;
        task.job.redoable = false;
        this.emit(task);
      }
  }
  /** A job for `request`, announced and kept with the history. */
  private add(request: OperationRequest, itemsTotal: number): Task {
    const job: OperationJob = {
      id: randomUUID(),
      revision: 0,
      kind: request.kind,
      status: 'queued',
      sources: request.sources,
      destination: request.destination,
      bytesDone: 0,
      bytesTotal: 0,
      itemsDone: 0,
      itemsTotal,
      completed: [],
      errors: [],
      errorCount: 0,
      undoable: false,
    };
    const task: Task = {
      job,
      request,
      abort: new AbortController(),
      undo: [],
      lastProgress: 0,
    };
    this.tasks.set(job.id, task);
    this.emit(task);
    // Completed history is bounded on its own: a large queued batch must not discard
    // earlier Undo receipts, and pending work, including collision decisions, is never dropped.
    if (this.tasks.size > 100) {
      const finished = (old: Task) => ['completed', 'failed', 'cancelled'].includes(old.job.status);
      let retained = [...this.tasks.values()].filter(finished).length;
      for (const [id, old] of this.tasks) {
        if (retained <= 100) break;
        if (!finished(old)) continue;
        this.tasks.delete(id);
        this.dirty.delete(old);
        retained--;
        void this.journal?.forget(id).catch(() => {});
      }
    }
    return task;
  }
  /**
   * Saving text. Writes `text` to `file` as a job of its own: over the version that was
   * read (`expected`), which goes to the Trash with an Undo step, as Replace does; or, with none, to a
   * new file, created exclusively. It runs as exclusive work, beside a job waiting at its prompt when
   * that job leaves the file alone. The text is never journaled, only its hash and length, so a save
   * is not offered for Redo.
   */
  async writeText(
    file: string,
    text: string,
    expected?: { version: SourceVersion; sha256?: string },
  ): Promise<OperationJob> {
    if (this.stopped) throw new Error('The file operation queue has closed.');
    file = absolute(file);
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > MAX_TEXT_BYTES)
      throw new Error('Text over 4 MiB is saved from another app; Viewer edits up to 4 MiB.');
    const folder = path.dirname(file);
    const request: OperationRequest = {
      ...(expected
        ? {
            kind: 'rewrite' as const,
            sources: [file],
            expectedSources: [{ path: file, version: expected.version }],
          }
        : { kind: 'mkfile' as const, sources: [], destination: folder, name: path.basename(file) }),
      textSHA256: sha256(bytes),
      textBytes: bytes.length,
    };
    if (request.name !== undefined) validName(request.name);
    await this.load();
    this.endRedo();
    const task = this.add(request, 1);
    task.exclusive = true;
    const { job } = task;
    let failure: unknown;
    await this.exclusive(
      async () => {
        job.status = 'running';
        job.current = file;
        this.emit(task);
        let stage: Awaited<ReturnType<typeof privateStage>> | undefined;
        try {
          this.check(task);
          if (expected) {
            await this.access([file, folder]);
            const existing = await lstat(file);
            if (existing.isSymbolicLink())
              throw new Error('Save to the file a symbolic link points to, rather than the link.');
            if (!existing.isFile()) throw new Error('Only a regular file can be saved over.');
            if (!sameSourceVersion(expected.version, sourceVersion(await entry(file))))
              throw changedOnDisk();
            if (expected.sha256 && sha256(await readFile(file)) !== expected.sha256)
              throw changedOnDisk();
            stage = await privateStage(folder, '.viewer-save-', this.trash);
            task.intent = { source: file, destination: file, staging: stage.file };
            await this.checkpoint(task);
            const output = await open(stage.file, 'wx', 0o600);
            try {
              await output.writeFile(bytes);
              await keepMetadata(file, output);
              await output.sync();
            } finally {
              await output.close();
            }
            this.check(task);
            // the version read goes to the Trash, pinned to what was checked above
            await this.publishReplacing(task, stage.file, file, existing);
          } else {
            await this.access([file]);
            task.intent = { source: '', destination: file };
            await this.checkpoint(task);
            await fileCoordination.run(
              [{ path: file, mode: 'write' }],
              async (signal) => {
                signal?.throwIfAborted();
                this.check(task);
                const actual = fileCoordination.path(file);
                await this.access([actual]);
                // Exclusive creation: an item that appeared meanwhile is never touched.
                const output = await open(actual, 'wx', 0o644).catch(
                  (error: NodeJS.ErrnoException) => {
                    if (error.code === 'EEXIST')
                      throw new Error(
                        `${path.basename(file)} already exists. Choose another name.`,
                      );
                    throw error;
                  },
                );
                try {
                  await output.writeFile(bytes);
                  await output.sync();
                } finally {
                  await output.close();
                }
              },
              task.abort.signal,
            );
          }
          // Undo moves the saved version to the Trash, then puts back the one it replaced.
          const proof = await outputProof(file);
          if (proof) {
            const info = await lstat(file);
            task.undo.push({
              from: file,
              to: '',
              remove: true,
              proof,
              identity: `${info.dev}:${info.ino}`,
              modified: info.mtimeMs,
              size: info.size,
            });
          }
          job.completed.push({ source: expected ? file : '', destination: file });
          task.intent = undefined;
        } catch (error) {
          failure = error;
          job.errors.push({ path: file, message: message(error).slice(0, 4000) });
        } finally {
          if (stage) await this.disposeStage(task, stage);
        }
        job.itemsDone = 1;
        job.status = task.abort.signal.aborted ? 'cancelled' : failure ? 'failed' : 'completed';
        job.undoable = !!task.undo.length;
        job.current = undefined;
        if (task.intent) job.recovery = task.intent;
        task.intent = undefined;
        this.emit(task);
        await this.checkpoint(task);
        await this.compact(task);
      },
      () => [file],
    );
    if (failure) throw failure;
    return structuredClone(job);
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
    const involves = (task: Task) =>
      task.request.sources.some(related) ||
      (!!task.request.destination && related(task.request.destination));
    for (const task of this.tasks.values()) if (involves(task)) this.cancel(task.job.id);
    // Cancelled work that has not started touches nothing (each item checks its abort first), and
    // an unrelated job keeps to its own paths, even while its collision prompt is open: only a
    // related job in progress, and exclusive work, are waited for. Waiting for the whole queue
    // held an Eject or a revoke behind any unanswered prompt.
    while (this.exclusiveActive || (this.active && involves(this.active)))
      await new Promise<void>((resolve) => this.settled.push(resolve));
  }
  /** Wakes quiesce whenever the work in progress changes. */
  private settle(): void {
    for (const resolve of this.settled.splice(0)) resolve();
  }
  /** Whether exclusive work over `footprint` may run while the current job waits at its prompt. */
  private besidePrompt(footprint: string[]): boolean {
    const active = this.active;
    if (this.exclusiveActive || !active?.decision || active.job.status !== 'collision')
      return false;
    // Waiting is always safe, so other case and Unicode spellings match too, as in quiesce.
    const key = (file: string) =>
      file
        .normalize('NFC')
        .toLocaleLowerCase('en-US')
        .replace(/[\\/]+$/, '');
    const own = footprint.filter(Boolean).map(key);
    const related = (file: string) => {
      const other = key(file);
      return own.some(
        (mine) =>
          mine === other || mine.startsWith(other + path.sep) || other.startsWith(mine + path.sep),
      );
    };
    return ![active, ...this.queue].some((task) => this.footprint(task).some(related));
  }
  /** What a job reads or changes: its sources and destination, the folder a rename, duplicate,
   * alias or conversion writes into, and the paths its prompt asks about. */
  private footprint({ request, job }: Task): string[] {
    const besideSources = ['rename', 'duplicate', 'alias', 'convert'].includes(request.kind);
    return [
      ...request.sources,
      ...(besideSources ? request.sources.map((file) => path.dirname(file)) : []),
      request.destination ?? '',
      job.collision?.source ?? '',
      job.collision?.destination ?? '',
    ].filter(Boolean);
  }
  /** An item put back from the Trash takes its Trash step with it, so Undo is no longer offered
   * for it and the Trash stops showing it as Viewer's (2026-10-20: Undo stayed offered and
   * failed with a raw ENOENT). */
  async trashRestored(file: string): Promise<void> {
    const key = (value: string) => value.normalize('NFC');
    for (const task of this.tasks.values()) {
      const kept = task.undo.filter((step) => !(step.trash && key(step.from) === key(file)));
      if (kept.length === task.undo.length) continue;
      task.undo = kept;
      if (['completed', 'failed', 'cancelled'].includes(task.job.status))
        task.job.undoable = !!kept.length;
      this.emit(task);
      await this.checkpoint(task);
    }
  }
  resolve(id: string, decision: CollisionDecision, applyAll: boolean): void {
    const task = this.tasks.get(id);
    if (!task?.decision) throw new Error('This collision has already been resolved.');
    if (applyAll) task.policy = decision;
    task.decision(decision);
  }
  /** What Quit would cancel: queued, running and prompting jobs, and exclusive work. */
  pendingCount(): number {
    let jobs = 0;
    for (const { job, exclusive } of this.tasks.values())
      if (
        !exclusive &&
        (job.status === 'queued' || job.status === 'running' || job.status === 'collision')
      )
        jobs++;
    return jobs + this.exclusivePending;
  }
  /** Resolves once nothing is pending; a job waiting at its prompt waits for its answer. */
  async drained(): Promise<void> {
    while (this.pendingCount() > 0) await new Promise<void>((resolve) => this.idle.push(resolve));
  }
  async close(): Promise<void> {
    this.stopped = true;
    for (const task of this.tasks.values()) this.cancel(task.job.id);
    // a loop: a wake-up from finished exclusive work can come while the queue runs on
    while (this.running || this.exclusiveActive)
      await new Promise<void>((resolve) => this.idle.push(resolve));
    await this.journal?.flush();
  }
  undo(id: string): Promise<void> {
    // a second ⌘Z while the first Undo waits would fail: the job is no longer undoable once it ran
    let undoing = this.undoing.get(id);
    if (!undoing) {
      undoing = this.load()
        .then(() =>
          this.exclusive(
            async () => this.undoTask(id),
            () => (this.tasks.get(id)?.undo ?? []).flatMap((step) => [step.from, step.to]),
          ),
        )
        .finally(() => this.undoing.delete(id));
      this.undoing.set(id, undoing);
    }
    return undoing;
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
      await this.checkpoint(task);
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
      await this.checkpoint(task);
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
    // An agent approval's contents pins are not carried over: Redo is the person's own, pinned to
    // what Undo put back. A save kept no text to write again.
    if (task.request.textSHA256 === undefined) {
      task.redo = { ...task.request, expectedSources, expectedContents: undefined };
      task.job.redoable = true;
    }
    this.emit(task);
    await this.checkpoint(task);
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
    return this.startOperation(request, true, task.reviewedFile);
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
        // A folder's version misses nested edits; the contents a person reviewed are compared here,
        // where nothing else can change them before the move. Compared only at approval, a Trash
        // queued behind other work ran on whatever the folder held by then.
        for (const expected of task.request.expectedContents ?? []) {
          if (expected.path !== file && !expected.path.startsWith(file + path.sep)) continue;
          const current = fileCoordination.path(expected.path);
          await this.access([current]);
          if ((await outputProof(current)) !== expected.proof)
            throw new Error('The contents changed after review. This item was not moved to Trash.');
        }
        signal?.throwIfAborted();
        if (task.reviewedFile) await verifyReviewedFile({ ...task.reviewedFile, path: actual });
        return this.trash(actual, task.reviewedFile);
      },
      task.abort.signal,
    );
    if (!receipt) return;
    try {
      await this.receiptAccess(receipt, async () => {
        const proof = await outputProof(receipt.path);
        // Too large to prove unchanged, so there is no Undo; said, as a missing bookmark is.
        if (!proof)
          throw new Error(
            'it holds more than 10,000 items, too many to check before putting them back.',
          );
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
    await this.checkpoint(task);
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
    guard?: () => Promise<void>,
  ): Promise<void> {
    // Without Replace, the exclusive publication below refuses an existing destination.
    await guard?.();
    if (replaced) {
      await this.protection.check(destination, 'replaced');
      await this.trashItem(task, destination, replaced);
    }
    try {
      await publish(source, destination, this.access, this.transferJob(task), guard);
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
    /** The paths the work changes. With them it may also run while the current job waits at its
     * prompt, when neither that job nor a queued one involves them; the job goes on once it ends.
     * An Undo waited for the whole queue, so behind any unanswered prompt. */
    footprint?: () => string[],
  ): Promise<T> {
    this.exclusivePending++;
    const task = this.exclusiveQueue
      .catch(() => {})
      .then(async () => {
        while (this.running && !(footprint && this.besidePrompt(footprint())))
          await new Promise<void>((resolve) => this.settled.push(resolve));
        if (this.stopped) throw new Error('The operation service is closed.');
        // beside a prompt, `running` stays the queue's
        const beside = this.running;
        this.running = true;
        this.exclusiveActive = true;
        try {
          return await work((source, destination, guard, signal) =>
            publish(source, destination, this.access, undefined, guard, signal),
          );
        } finally {
          if (!beside) this.running = false;
          this.exclusiveActive = false;
          this.settle();
          for (const resolve of this.idle.splice(0)) resolve();
          void this.run();
        }
      })
      .finally(() => {
        this.exclusivePending--;
        for (const resolve of this.idle.splice(0)) resolve();
      });
    this.exclusiveQueue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private emit(task: Task): void {
    this.dirty.add(task);
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
      progress: job.progress,
      detail: job.detail,
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
      await this.checkpoint(task);
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
  /** The reviewed versions of `source` and what it holds: checked as its item starts, again once a
   * collision is decided and inside the claim that publishes it. Checked only at the start, a source
   * edited while its collision prompt was open was copied or moved. */
  private async checkPins(task: Task, source: string): Promise<void> {
    for (const expected of task.request.expectedSources ?? []) {
      if (source && expected.path !== source && !expected.path.startsWith(source + path.sep))
        continue;
      const current = fileCoordination.path(expected.path);
      await this.access([current]);
      if (!sameSourceVersion(expected.version, sourceVersion(await entry(current))))
        throw new Error('The source changed after review. Prepare a new plan.');
    }
  }
  private async target(task: Task, source: string, destination: string): Promise<Target | null> {
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!existing) return { path: destination };
    if (task.request.transform) return { path: await keepBothName(destination) };
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
      // an Undo waiting for the queue may run meanwhile
      this.settle();
      decision = await pending;
      task.decision = undefined;
      task.job.collision = undefined;
      task.job.status = 'running';
      this.emit(task);
      while (this.exclusiveActive) await new Promise<void>((resolve) => this.settled.push(resolve));
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
    // The reviewed source is checked again inside the claim that publishes it (see checkPins).
    const guard = () => this.checkPins(task, source);
    if (move && (await lstat(source)).dev === (await stat(path.dirname(destination))).dev) {
      try {
        await this.publishReplacing(task, source, destination, replaced, guard);
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
      await this.checkpoint(task);
      await copyTree(this.transferJob(task), source, staging, fingerprints, this.access);
      this.check(task);
      // Do not clobber a file created while the transfer was in flight.
      if (!replaced && (await exists(destination)))
        throw new Error(
          'A file appeared at the destination during the transfer. Retry to choose a collision action.',
        );
      await this.publishReplacing(task, staging, destination, replaced, guard);
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
        // nor does a job start while one runs beside a prompt
        while (this.exclusiveActive)
          await new Promise<void>((resolve) => this.settled.push(resolve));
        const task = this.queue.shift();
        if (!task) break;
        currentTask = task;
        this.active = task;
        this.settle();
        const { job, request } = task;
        job.status = 'running';
        this.emit(task);
        const single =
          ['mkdir', 'mkfile', 'compress'].includes(request.kind) ||
          (request.kind === 'convert' &&
            (request.conversion === 'pdf' || combinedTransform(request.transform)));
        const items = single ? [''] : request.sources;
        for (const source of items) {
          const priorErrors = job.errors.length;
          try {
            this.check(task);
            await this.access(
              [source, request.destination].filter((file): file is string => !!file),
            );
            await this.checkPins(task, source);
            job.current = source || request.destination;
            task.intent = { source, destination: request.destination };
            // Each intent is made durable immediately before the first change it covers;
            // Trash is the only change that follows directly.
            if (request.kind === 'trash') await this.checkpoint(task);
            this.progress(task);
            let destination: string | undefined;
            let statistics:
              { inputBytes: number; outputBytes: number; optimized: boolean } | undefined;
            // A transfer moves only within one volume. Its destination folder is resolved, as
            // the transfer itself resolves it, so a link to a folder on another volume copies.
            const move =
              request.kind === 'move' ||
              request.kind === 'rename' ||
              (request.kind === 'transfer' &&
                (await lstat(source)).dev === (await stat(request.destination!)).dev);
            let undoable = false,
              caseOnly = false;
            if (request.kind === 'trash') await this.protection.check(source, 'moved to the Trash');
            else if (move) await this.protection.check(source, 'moved or renamed');
            if (request.kind === 'trash') await this.trashItem(task, source);
            else {
              destination = single
                ? path.join(request.destination!, validName(request.name!))
                : request.kind === 'convert'
                  ? request.transform
                    ? path.join(
                        request.destination || path.dirname(source),
                        request.name && request.sources.length === 1
                          ? validName(request.name)
                          : path.basename(source, path.extname(source)) +
                              (request.transform.kind === 'pdf' ||
                              (request.transform.kind === 'image' && request.transform.optimize)
                                ? ' optimized.'
                                : ' converted.') +
                              transformExtension(request.transform.format),
                      )
                    : conversionOutput(source, request.conversion!)
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
                          ? await aliasName(source)
                          : path.join(request.destination!, request.name ?? path.basename(source));
              if (source === destination && !request.transform)
                throw new Error('Source and destination are the same.');
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
                // A collision prompt can stay open indefinitely.
                await this.checkPins(task, source);
                await this.access([destination]);
                task.intent = { source, destination };
                await this.checkpoint(task);
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
                    await this.checkpoint(task);
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
                    await this.checkpoint(task);
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
                    await this.checkpoint(task);
                    const inputs = source ? [source] : request.sources;
                    await this.access([...inputs, staging]);
                    job.current = source || destination;
                    if (request.transform) {
                      const result = await this.transforms!.execute(
                        request.transform,
                        inputs,
                        staging,
                        task.abort.signal,
                        (fraction, detail) => {
                          job.progress = Math.max(
                            job.progress || 0,
                            (job.itemsDone + Math.max(0, Math.min(1, fraction))) /
                              Math.max(1, job.itemsTotal),
                          );
                          job.detail = detail;
                          this.progress(task);
                        },
                      );
                      if (result) {
                        await this.checkPins(task, source);
                        statistics = {
                          ...result,
                          optimized: result.outputBytes < result.inputBytes,
                        };
                        if (!statistics.optimized) {
                          job.completed.push({ source, ...statistics });
                          job.itemsDone++;
                          task.intent = undefined;
                          job.detail = 'Already compact · original kept';
                          await this.checkpoint(task);
                          this.progress(task);
                          continue;
                        }
                      }
                    } else
                      await this.images.convert(
                        request.conversion!,
                        inputs,
                        staging,
                        task.abort.signal,
                      );
                    this.check(task);
                    await this.publishReplacing(
                      task,
                      staging,
                      destination,
                      replaced,
                      request.transform ? () => this.checkPins(task, source) : undefined,
                    );
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
            job.completed.push({ source, destination, ...statistics });
            if (destination && move) this.filesChanged([{ source, destination }]);
            job.itemsDone++;
            task.intent = undefined;
          } catch (error) {
            if (error instanceof ReceiptFailure) throw error;
            if (task.abort.signal.aborted) break;
            // Cleanup may already have reported retained partial content. Keep this item's
            // original failure before those details, without reordering earlier items.
            job.errors.splice(priorErrors, 0, {
              path: source || request.destination!,
              message: message(error).slice(0, 4000),
            });
            job.itemsDone++;
          }
          this.progress(task);
          await this.checkpoint(task);
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
        await this.checkpoint(task);
        await this.compact(task);
        currentTask = undefined;
        this.active = undefined;
        this.settle();
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
      this.active = undefined;
      this.settle();
      for (const resolve of this.idle.splice(0)) resolve();
    }
  }
}
