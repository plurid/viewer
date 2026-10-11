import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
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
import { guardMoveMetadata } from './metadata';

interface UndoStep {
  from: string;
  to: string;
  identity: string;
  modified: number;
  size: number;
  caseOnly?: boolean;
}
interface Task {
  job: OperationJob;
  request: OperationRequest;
  abort: AbortController;
  decision?: (decision: CollisionDecision) => void;
  policy?: CollisionDecision;
  undo: UndoStep[];
  lastProgress: number;
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
  constructor(
    private trash: (file: string) => Promise<void>,
    private changed: (job: OperationJob) => void,
    private progressed: (progress: OperationProgress) => void = () => {},
    private filesChanged: (changes: import('../domain/changes').FileChange[]) => void = () => {},
  ) {}
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
    if (['copy', 'move', 'mkdir'].includes(request.kind) && !request.destination)
      throw new Error('Choose a destination folder.');
    if (request.kind !== 'mkdir' && !roots.length) throw new Error('Select at least one file.');
    if (request.kind === 'rename' && (roots.length !== 1 || !request.name))
      throw new Error('Rename one file at a time.');
    if (request.kind === 'mkdir' && !request.name) throw new Error('Enter a folder name.');
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
      itemsTotal: request.kind === 'mkdir' ? 1 : roots.length,
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
  }
  async undo(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task?.job.undoable) throw new Error('This operation cannot be undone.');
    if (this.running) throw new Error('Wait for the current file operation before undoing.');
    // Validate the entire undo first, so a known conflict never produces a partial undo.
    for (const step of task.undo) {
      const info = await lstat(step.from);
      if (
        `${info.dev}:${info.ino}` !== step.identity ||
        (!info.isDirectory() && (info.mtimeMs !== step.modified || info.size !== step.size))
      )
        throw new Error(`Cannot undo: ${step.from} changed since the operation.`);
      if (await exists(step.to)) {
        const destination = await lstat(step.to);
        if (!step.caseOnly || `${destination.dev}:${destination.ino}` !== step.identity)
          throw new Error(`Cannot undo: ${step.to} already exists.`);
      }
    }
    this.running = true;
    try {
      for (const step of [...task.undo].reverse()) {
        if (step.caseOnly && (await exists(step.to))) await this.changeCase(step.from, step.to);
        else await this.publish(step.from, step.to);
        this.filesChanged([{ source: step.from, destination: step.to }]);
        task.undo.splice(task.undo.indexOf(step), 1);
      }
      task.job.undoable = false;
      this.emit(task);
    } finally {
      this.running = false;
      void this.run();
    }
  }
  exclusive<T>(
    work: (publish: (source: string, destination: string) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const task = this.exclusiveQueue
      .catch(() => {})
      .then(async () => {
        while (this.running) await new Promise<void>((resolve) => this.idle.push(resolve));
        if (this.stopped) throw new Error('The operation service is closed.');
        this.running = true;
        try {
          return await work((source, destination) => this.publish(source, destination));
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
  /** Files use an exclusive hard link; directory publication reserves an empty destination.
   * A concurrent writer can make publication fail, but its file is never overwritten. */
  private async publish(source: string, destination: string, task?: Task): Promise<void> {
    const info = await lstat(source);
    if (!info.isDirectory()) {
      if (!info.isFile() && !info.isSymbolicLink())
        throw new Error('Special devices and sockets cannot be transferred.');
      // macOS hard-link creation follows symbolic links, so recreate the link itself.
      if (info.isSymbolicLink()) await symlink(await readlink(source), destination);
      else {
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
          await guardMoveMetadata(source, task?.abort.signal ?? new AbortController().signal);
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
    await this.trash(destination);
    return destination;
  }
  private async copy(
    task: Task,
    source: string,
    target: string,
    fingerprints: UndoStep[],
  ): Promise<void> {
    this.check(task);
    const info = await lstat(source);
    fingerprints.push({
      from: source,
      to: target,
      identity: `${info.dev}:${info.ino}`,
      modified: info.mtimeMs,
      size: info.size,
    });
    if (info.isSymbolicLink()) {
      await symlink(await readlink(source), target);
      return;
    }
    if (info.isDirectory()) {
      await mkdir(target, { mode: info.mode });
      for (const name of await readdir(source))
        await this.copy(task, path.join(source, name), path.join(target, name), fingerprints);
    } else if (info.isFile()) {
      await this.copyFile(source, target, info, task);
    } else {
      throw new Error('Special devices and sockets cannot be transferred.');
    }
    await utimes(target, info.atime, info.mtime);
  }
  private async copyFile(source: string, target: string, info: Stats, task?: Task): Promise<void> {
    if (task) {
      task.job.current = source;
      task.job.bytesTotal += info.size;
    }
    const input = await open(source, 'r');
    let output: Awaited<ReturnType<typeof open>> | undefined, owned: Stats | undefined;
    try {
      output = await open(target, 'wx', info.mode);
      owned = await output.stat();
      const buffer = Buffer.allocUnsafe(256 * 1024);
      for (;;) {
        if (task) this.check(task);
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(buffer, written, bytesRead - written, null);
          written += result.bytesWritten;
        }
        if (task) {
          task.job.bytesDone += bytesRead;
          this.progress(task);
        }
      }
      await output.sync();
      const after = await lstat(source);
      if (
        after.dev !== info.dev ||
        after.ino !== info.ino ||
        after.mtimeMs !== info.mtimeMs ||
        after.size !== info.size
      )
        throw new Error('Source changed while copying; it has been left untouched.');
      if (task) this.check(task);
      await utimes(target, info.atime, info.mtime);
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
    const staging = path.join(path.dirname(destination), `.viewer-transfer-${randomUUID()}`);
    const fingerprints: UndoStep[] = [];
    try {
      await this.copy(task, source, staging, fingerprints);
      this.check(task);
      if (move) {
        for (const fingerprint of fingerprints) {
          this.check(task);
          await guardMoveMetadata(fingerprint.from, task.abort.signal);
        }
      }
      // Do not clobber a file created while the transfer was in flight.
      if (await exists(destination))
        throw new Error(
          'A file appeared at the destination during the transfer. Retry to choose a collision action.',
        );
      await this.publish(staging, destination, task);
      if (move) {
        for (const fingerprint of fingerprints) {
          const info = await lstat(fingerprint.from);
          if (
            `${info.dev}:${info.ino}` !== fingerprint.identity ||
            info.mtimeMs !== fingerprint.modified ||
            info.size !== fingerprint.size
          )
            throw new Error(
              'Source changed during the move. The completed copy and the original have both been kept.',
            );
        }
        await rm(source, { recursive: true });
      }
      return false;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const task = this.queue.shift()!;
        const { job, request } = task;
        job.status = 'running';
        this.emit(task);
        const items = request.kind === 'mkdir' ? [''] : request.sources;
        for (const source of items) {
          try {
            this.check(task);
            job.current = source || request.destination;
            this.progress(task);
            let destination: string | undefined;
            let undoable = false,
              caseOnly = false;
            if (request.kind === 'trash') await this.trash(source);
            else {
              destination =
                request.kind === 'mkdir'
                  ? path.join(request.destination!, validName(request.name!))
                  : request.kind === 'rename'
                    ? path.join(path.dirname(source), validName(request.name!))
                    : request.kind === 'duplicate'
                      ? await this.unique(source)
                      : path.join(request.destination!, path.basename(source));
              if (source === destination) throw new Error('Source and destination are the same.');
              if (source && destination.startsWith(source + path.sep))
                throw new Error('A folder cannot be placed inside itself.');
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
                if (request.kind === 'mkdir') await mkdir(destination);
                else
                  undoable = await this.transfer(
                    task,
                    source,
                    destination,
                    request.kind === 'move' || request.kind === 'rename',
                  );
              }
              if (undoable && (request.kind === 'move' || request.kind === 'rename')) {
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
            }
            job.completed.push({ source, destination });
            if (destination && ['rename', 'move'].includes(request.kind))
              this.filesChanged([{ source, destination }]);
            job.itemsDone++;
          } catch (error) {
            if (task.abort.signal.aborted) break;
            job.errors.push({ path: source || request.destination!, message: message(error) });
            job.itemsDone++;
          }
          this.progress(task);
        }
        job.status = task.abort.signal.aborted
          ? 'cancelled'
          : job.errors.length && !job.completed.length
            ? 'failed'
            : 'completed';
        job.undoable = !!task.undo.length;
        job.current = undefined;
        this.emit(task);
      }
    } finally {
      this.running = false;
      for (const resolve of this.idle.splice(0)) resolve();
    }
  }
}
