import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  link,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rmdir,
  symlink,
  unlink,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  CollisionDecision,
  OperationJob,
  OperationProgress,
  OperationRequest,
} from '../domain/contracts';
import { absolute, exists, message, validName } from './filesystem';
import { macFiles, type TrashReceipt, type ReceiptAccess } from './macos-files';
import { createArchive, extractArchive } from './archive-jobs';
import { operationJournal, outputProof, type OperationReceipt } from './operation-journal';
import { privateStage } from './staging';
import { fileCoordination } from './file-coordination';

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
interface CopyFingerprint {
  file: string;
  info: Stats;
  children?: string[];
}
class ReceiptFailure extends Error {}
interface Task {
  job: OperationJob;
  request: OperationRequest;
  abort: AbortController;
  decision?: (decision: CollisionDecision) => void;
  policy?: CollisionDecision;
  undo: UndoStep[];
  lastProgress: number;
  intent?: OperationReceipt['intent'];
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
  private journal?: ReturnType<typeof operationJournal>;
  private loaded?: Promise<void>;
  constructor(
    private trash: (file: string) => Promise<void | TrashReceipt>,
    private changed: (job: OperationJob) => void,
    private progressed: (progress: OperationProgress) => void = () => {},
    private filesChanged: (changes: import('../domain/changes').FileChange[]) => void = () => {},
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    dataPath?: string,
    private receiptAccess: ReceiptAccess = async (_receipt, work) => work(),
  ) {
    if (dataPath) this.journal = operationJournal(dataPath);
  }
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const document = await this.journal?.load();
      for (const receipt of document?.records ?? []) {
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
        this.tasks.set(job.id, {
          job,
          request: receipt.request,
          undo: receipt.undo,
          abort: new AbortController(),
          lastProgress: 0,
          intent: receipt.intent,
        });
      }
    })());
  }
  private checkpoint(): Promise<void> {
    return Promise.resolve()
      .then(() =>
        this.journal?.save({
          version: 1,
          records: [...this.tasks.values()]
            .slice(-100)
            .map(({ job, request, undo, intent }) => ({ job, request, undo, intent })),
        }),
      )
      .catch((error) => {
        throw new ReceiptFailure(message(error));
      });
  }
  all(): OperationJob[] {
    return [...this.tasks.values()].map((task) => structuredClone(task.job));
  }
  start(request: OperationRequest): string {
    if (this.stopped) throw new Error('The file operation queue has closed.');
    const sources = [...new Set(request.sources.map(absolute))];
    // A selected descendant is already carried by its selected parent.
    const roots = operationRoots(sources);
    if (request.destination) request = { ...request, destination: absolute(request.destination) };
    if (request.name !== undefined) validName(request.name);
    if (
      ['copy', 'move', 'transfer', 'mkdir', 'compress', 'extract'].includes(request.kind) &&
      !request.destination
    )
      throw new Error('Choose a destination folder.');
    if (request.kind !== 'mkdir' && !roots.length) throw new Error('Select at least one file.');
    if (request.kind === 'rename' && (roots.length !== 1 || !request.name))
      throw new Error('Rename one file at a time.');
    if (request.kind === 'mkdir' && !request.name) throw new Error('Enter a folder name.');
    if (
      request.kind === 'compress' &&
      (!request.name || !request.name.toLowerCase().endsWith('.zip'))
    )
      throw new Error('Enter a ZIP archive name.');
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
      itemsTotal: ['mkdir', 'compress'].includes(request.kind) ? 1 : roots.length,
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
        if (['completed', 'failed', 'cancelled'].includes(old.job.status)) this.tasks.delete(id);
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
    const related = (file: string) =>
      file === root || file.startsWith(root.replace(/[\\/]$/, '') + path.sep);
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
            else await this.publish(step.from, step.to);
          },
        ),
      );
      if (!step.remove) this.filesChanged([{ source: step.from, destination: step.to }]);
      task.undo.splice(task.undo.indexOf(step), 1);
      task.intent = undefined;
      await this.checkpoint();
    }
    task.job.undoable = false;
    this.emit(task);
    await this.checkpoint();
  }
  private withStep<T>(step: UndoStep, work: () => Promise<T>): Promise<T> {
    return step.trash
      ? this.receiptAccess(
          { path: step.from, directory: !!step.directory, bookmark: step.bookmark },
          work,
        )
      : work();
  }
  private async trashItem(task: Task, file: string): Promise<void> {
    const receipt = await fileCoordination.run(
      [{ path: file, mode: 'delete' }],
      async (signal) => {
        signal?.throwIfAborted();
        this.check(task);
        const actual = fileCoordination.path(file);
        await this.access([actual]);
        signal?.throwIfAborted();
        return this.trash(actual);
      },
      task.abort.signal,
    );
    if (!receipt) return;
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
    await this.checkpoint();
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
            this.publish(source, destination, undefined, guard, signal),
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
  /** macOS uses a coordinated exclusive rename; other platforms use exclusive publication.
   * A concurrent writer can make publication fail, but its file is never overwritten. */
  private async publish(
    source: string,
    destination: string,
    task?: Task,
    guard?: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (process.platform === 'darwin') {
      return fileCoordination.run(
        [
          { path: source, mode: 'move' },
          { path: destination, mode: 'write' },
        ],
        async (signal) => {
          signal?.throwIfAborted();
          if (task) this.check(task);
          const from = fileCoordination.path(source),
            to = fileCoordination.path(destination);
          await this.access([from, to]);
          await guard?.();
          signal?.throwIfAborted();
          const info = await lstat(from);
          if (!info.isDirectory() && !info.isFile() && !info.isSymbolicLink())
            throw new Error('Special devices and sockets cannot be transferred.');
          await macFiles().renameExclusive(from, to, fileCoordination.purpose());
        },
        task?.abort.signal ?? signal,
      );
    }
    await this.access([source, destination]);
    await guard?.();
    signal?.throwIfAborted();
    const info = await lstat(source);
    if (!info.isDirectory()) {
      if (!info.isFile() && !info.isSymbolicLink())
        throw new Error('Special devices and sockets cannot be transferred.');
      if (info.isSymbolicLink()) {
        await symlink(await readlink(source), destination);
      } else {
        try {
          await link(source, destination);
        } catch (error) {
          // exFAT and some network mounts cannot create hard links. Keep the same
          // exclusive destination and cancellable streaming semantics there.
          if (
            !['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS'].includes(
              (error as NodeJS.ErrnoException).code || '',
            )
          )
            throw error;
          await this.copyFile(source, destination, info, task);
        }
      }
      try {
        await unlink(source);
      } catch (error) {
        throw new Error(
          `The destination is complete, but the original could not be removed: ${message(error)}`,
        );
      }
      return;
    }
    await mkdir(destination, { mode: info.mode });
    const reserved = await lstat(destination);
    try {
      await rename(source, destination);
    } catch (error) {
      const current = await lstat(destination).catch(() => null);
      if (current?.dev === reserved.dev && current.ino === reserved.ino)
        await rmdir(destination).catch(() => undefined);
      throw error;
    }
  }
  private async changeCase(source: string, destination: string, task?: Task): Promise<void> {
    const temporary = path.join(path.dirname(source), `.viewer-rename-${randomUUID()}`);
    await this.publish(source, temporary, task);
    try {
      await this.publish(temporary, destination, task);
    } catch (error) {
      // Restore only when the old name is still available; preserve the intermediate otherwise.
      await this.publish(temporary, source).catch(() => undefined);
      throw error;
    }
  }
  private async unique(destination: string): Promise<string> {
    const ext = path.extname(destination);
    const stem = destination.slice(0, destination.length - ext.length);
    let suffix = 1;
    let candidate = `${stem} copy${ext}`;
    while (await exists(candidate)) candidate = `${stem} copy ${++suffix}${ext}`;
    return candidate;
  }
  private async target(task: Task, source: string, destination: string): Promise<string | null> {
    if (!(await exists(destination))) return destination;
    let decision = task.policy;
    if (!decision) {
      task.job.status = 'collision';
      task.job.collision = { source, destination };
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
    if (decision === 'keep-both') return this.unique(destination);
    await this.trashItem(task, destination);
    return destination;
  }
  private async copy(
    task: Task,
    source: string,
    target: string,
    fingerprints: CopyFingerprint[],
  ): Promise<void> {
    this.check(task);
    // Content coordination can hydrate a placeholder. Capture its fingerprint
    // after acquisition, before copying, rather than retaining placeholder size.
    if ((await lstat(source)).isFile()) {
      return fileCoordination.run(
        [
          { path: source, mode: 'read' },
          { path: target, mode: 'write' },
        ],
        async (signal) => {
          await this.access([source, target]);
          signal?.throwIfAborted();
          this.check(task);
          const info = await lstat(source);
          if (!info.isFile())
            throw new Error('Source changed while waiting for its file provider.');
          fingerprints.push({ file: source, info });
          await this.copyFile(source, target, info, task, signal);
        },
        task.abort.signal,
      );
    }
    const info = await lstat(source);
    if (info.isSymbolicLink()) {
      return fileCoordination.run(
        [
          { path: source, mode: 'metadata' },
          { path: target, mode: 'write' },
        ],
        async (signal) => {
          signal?.throwIfAborted();
          this.check(task);
          const from = fileCoordination.path(source),
            to = fileCoordination.path(target);
          await this.access([from, to]);
          const current = await lstat(from);
          if (!current.isSymbolicLink())
            throw new Error('The symbolic link changed while waiting for its file provider.');
          fingerprints.push({ file: source, info: current });
          await symlink(await readlink(from), to);
          if (process.platform === 'darwin') await macFiles().copyLinkMetadata(from, to);
          signal?.throwIfAborted();
        },
        task.abort.signal,
      );
    }
    const children = info.isDirectory() ? (await readdir(source)).sort() : undefined;
    fingerprints.push({ file: source, info, children });
    if (info.isDirectory()) {
      await mkdir(target, { mode: info.mode | 0o700 });
      for (const name of children!)
        await this.copy(task, path.join(source, name), path.join(target, name), fingerprints);
      if (process.platform === 'darwin') {
        await fileCoordination.run(
          [
            { path: source, mode: 'metadata' },
            { path: target, mode: 'write' },
          ],
          async (signal) => {
            signal?.throwIfAborted();
            await this.access([fileCoordination.path(source), fileCoordination.path(target)]);
            const input = await open(
              fileCoordination.path(source),
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            let output: Awaited<ReturnType<typeof open>> | undefined;
            try {
              const opened = await input.stat();
              if (opened.dev !== info.dev || opened.ino !== info.ino)
                throw new Error('Source folder changed during the copy.');
              output = await open(
                fileCoordination.path(target),
                constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
              );
              await macFiles().copyMetadata(input.fd, output.fd);
              signal?.throwIfAborted();
              this.check(task);
            } finally {
              await input.close();
              await output?.close();
            }
          },
          task.abort.signal,
        );
      } else await chmod(target, info.mode);
    } else if (info.isFile()) {
      throw new Error('Source changed while starting the copy.');
    } else {
      throw new Error('Special devices and sockets cannot be transferred.');
    }
    if (process.platform !== 'darwin') await utimes(target, info.atime, info.mtime);
  }
  private async copyFile(
    source: string,
    target: string,
    info: Stats,
    task?: Task,
    signal?: AbortSignal,
  ): Promise<void> {
    source = fileCoordination.path(source);
    target = fileCoordination.path(target);
    signal?.throwIfAborted();
    if (task) {
      task.job.current = source;
      task.job.bytesTotal += info.size;
    }
    const input = await open(
      source,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    );
    let output: Awaited<ReturnType<typeof open>> | undefined, owned: Stats | undefined;
    try {
      const opened = await input.stat();
      if (
        !opened.isFile() ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino ||
        opened.size !== info.size ||
        opened.mtimeMs !== info.mtimeMs ||
        opened.ctimeMs !== info.ctimeMs
      )
        throw new Error('Source changed before copying; it has been left untouched.');
      output = await open(target, 'wx', info.mode);
      owned = await output.stat();
      const buffer = Buffer.allocUnsafe(256 * 1024);
      let total = 0;
      while (total < info.size) {
        signal?.throwIfAborted();
        if (task) this.check(task);
        const { bytesRead } = await input.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - total),
          null,
        );
        if (!bytesRead)
          throw new Error('Source became shorter while copying; it has been left untouched.');
        total += bytesRead;
        let written = 0;
        while (written < bytesRead) {
          signal?.throwIfAborted();
          const result = await output.write(buffer, written, bytesRead - written, null);
          if (!result.bytesWritten) throw new Error('The destination stopped accepting data.');
          written += result.bytesWritten;
        }
        if (task) {
          task.job.bytesDone += bytesRead;
          this.progress(task);
        }
      }
      signal?.throwIfAborted();
      if (process.platform === 'darwin') await macFiles().copyMetadata(input.fd, output.fd);
      await output.sync();
      const after = await lstat(source);
      if (
        after.dev !== info.dev ||
        after.ino !== info.ino ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs ||
        after.size !== info.size
      )
        throw new Error('Source changed while copying; it has been left untouched.');
      if (task) this.check(task);
      if (process.platform !== 'darwin') await utimes(target, info.atime, info.mtime);
    } catch (error) {
      const current = owned && (await lstat(target).catch(() => null));
      if (current && owned && current.dev === owned.dev && current.ino === owned.ino)
        await unlink(target).catch(() => undefined);
      throw error;
    } finally {
      await input.close();
      await output?.close();
    }
  }
  private async transfer(
    task: Task,
    source: string,
    destination: string,
    move: boolean,
  ): Promise<boolean> {
    if (move) {
      try {
        await this.publish(source, destination, task);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      }
    }
    const stage = await privateStage(path.dirname(destination), '.viewer-transfer-');
    const staging = stage.file;
    task.intent = { source, destination, staging };
    const fingerprints: CopyFingerprint[] = [];
    try {
      await this.checkpoint();
      await this.copy(task, source, staging, fingerprints);
      this.check(task);
      // Do not clobber a file created while the transfer was in flight.
      if (await exists(destination))
        throw new Error(
          'A file appeared at the destination during the transfer. Retry to choose a collision action.',
        );
      await this.publish(staging, destination, task);
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
              if (current.isDirectory()) await rmdir(file);
              else await unlink(file);
            },
            task.abort.signal,
          );
        }
      }
      return false;
    } finally {
      await stage.dispose();
    }
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
        const items = ['mkdir', 'compress'].includes(request.kind) ? [''] : request.sources;
        for (const source of items) {
          try {
            this.check(task);
            await this.access(
              [source, request.destination].filter((file): file is string => !!file),
            );
            job.current = source || request.destination;
            task.intent = { source, destination: request.destination };
            await this.checkpoint();
            this.progress(task);
            let destination: string | undefined;
            const move =
              request.kind === 'move' ||
              request.kind === 'rename' ||
              (request.kind === 'transfer' &&
                (await lstat(source)).dev === (await lstat(request.destination!)).dev);
            let undoable = false,
              caseOnly = false;
            if (request.kind === 'trash') await this.trashItem(task, source);
            else {
              destination = ['mkdir', 'compress'].includes(request.kind)
                ? path.join(request.destination!, validName(request.name!))
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
                      ? await this.unique(source)
                      : path.join(request.destination!, path.basename(source));
              if (source === destination) throw new Error('Source and destination are the same.');
              await this.access([destination]);
              task.intent = { source, destination };
              await this.checkpoint();
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
                destination = resolved;
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
                else if (request.kind === 'compress' || request.kind === 'extract') {
                  const stage = await privateStage(path.dirname(destination), '.viewer-archive-');
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
                    await this.publish(staging, destination, task);
                  } finally {
                    await stage.dispose();
                  }
                } else undoable = await this.transfer(task, source, destination, move);
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
                ['copy', 'transfer', 'duplicate', 'mkdir', 'compress', 'extract'].includes(
                  request.kind,
                )
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
