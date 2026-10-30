import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

/** Where a worker runs: a utility process, or a thread for tests that cannot spawn one. */
export type WorkerBackend = 'process' | 'thread';

/** A worker's requests by method: the arguments each takes and the value it replies. */
export type WorkerMethods = Record<string, { args: unknown[]; reply: unknown }>;
/** Sent by the client itself, so every worker answers them. */
export type ClientMethods = {
  cancel: { args: [id: string]; reply: unknown };
  close: { args: []; reply: unknown };
};
type MethodName<Methods extends WorkerMethods> = keyof Methods & string;
/** A request as the worker receives it: narrowing `method` types its `args`. */
export type WorkerRequest<Methods extends WorkerMethods> = {
  [M in MethodName<Methods>]: { id: string; method: M; args: Methods[M]['args'] };
}[MethodName<Methods>];
/** A method without arguments may be called without them. */
type CallArguments<Args extends unknown[]> = [] extends Args
  ? [args?: Args, signal?: AbortSignal]
  : [args: Args, signal?: AbortSignal];

interface Reply {
  id?: string;
  value?: unknown;
  error?: string;
  code?: string;
  event?: string;
}
/** A worker's process or thread; `Message` is what it posts back. */
export interface OwnedWorker<Message = Reply> {
  process?: UtilityProcess;
  thread?: Worker;
  postMessage(value: unknown): void;
  message(listener: (reply: Message) => void): void;
  exit(listener: (code: number) => void, once?: boolean): void;
}
/** What the app does with workers' stderr and their unexpected ends: the diagnostic log. */
export interface WorkerDiagnostics {
  output(worker: string): (chunk: Buffer) => void;
  stopped(worker: string, detail: string): void;
}
let diagnostics: WorkerDiagnostics | undefined;
/** Every worker launched from now on reports to `sink`. A stderr pipe nobody reads fills and
 * stops the worker that writes to it, so the app always reads it. */
export function reportWorkers(sink: WorkerDiagnostics): void {
  diagnostics = sink;
}
export function launchWorker<Message = Reply>(
  worker: string,
  name: string,
  backend?: WorkerBackend,
): OwnedWorker<Message> {
  if (backend === 'thread') {
    const child = new Worker(worker, { name, stdout: true, stderr: true });
    if (process.env.VIEWER_RENDER_TEST === '1') child.stderr?.pipe(process.stderr);
    const output = diagnostics?.output(name);
    if (output) child.stderr?.on('data', output);
    return {
      thread: child,
      postMessage: (value) => child.postMessage(value),
      message: (listener) => child.on('message', listener),
      exit: (listener, once) => {
        if (once) child.once('exit', listener);
        else child.on('exit', listener);
      },
    };
  }
  const child = utilityProcess.fork(worker, [], { serviceName: name, stdio: 'pipe' });
  if (process.env.VIEWER_RENDER_TEST === '1') child.stderr?.pipe(process.stderr);
  const output = diagnostics?.output(name);
  if (output) child.stderr?.on('data', output);
  return {
    process: child,
    postMessage: (value) => child.postMessage(value),
    message: (listener) => child.on('message', listener),
    exit: (listener, once) => {
      if (once) child.once('exit', listener);
      else child.on('exit', listener);
    },
  };
}

/** Owns one read-only worker. MAS threads share the main process's dynamic
 * sandbox grants; direct builds keep utility-process crash isolation. */
export class UtilityClient<Methods extends WorkerMethods = WorkerMethods> {
  private child?: OwnedWorker;
  private ready?: Promise<unknown>;
  private closed = false;
  private closing?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      cleanup(): void;
    }
  >();
  constructor(
    private worker: string,
    private options: {
      name: string;
      backend?: WorkerBackend;
      timeout?: number;
      initialize?(client: UtilityClient<Methods>): Promise<unknown>;
      event?(reply: Reply): void;
      stopped?(): void;
    },
  ) {}

  private start(): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error('Background file services are shutting down.'));
    if (this.ready) return this.ready;
    if (!this.child) this.launch();
    // A failed initialization is tried again by the next call, on the same worker. Kept, it
    // failed every call until the worker exited, which an idle worker never does.
    const ready = (this.ready = this.options.initialize?.(this) ?? Promise.resolve());
    ready.catch(() => {
      if (this.ready === ready) this.ready = undefined;
    });
    return ready;
  }
  private launch(): void {
    const child = launchWorker(this.worker, this.options.name, this.options.backend);
    this.child = child;
    child.message((reply: Reply) => {
      if (reply.event) {
        this.options.event?.(reply);
        return;
      }
      const pending = reply.id && this.pending.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.cleanup();
      this.pending.delete(reply.id!);
      if (reply.error) pending.reject(Object.assign(new Error(reply.error), { code: reply.code }));
      else pending.resolve(reply.value);
    });
    let reason = 'exited';
    child.exit((code) => {
      if (this.child !== child) return;
      // a utility process's end is recorded by the app's child-process-gone, with its reason
      if (child.thread && !this.closed)
        diagnostics?.stopped(this.options.name, `${this.options.name}: ${reason} (exit ${code})`);
      this.rejectPending('Background file services stopped. Retry the operation.');
      this.child = undefined;
      this.ready = undefined;
      this.options.stopped?.();
    });
    child.thread?.on('error', (error: unknown) => {
      reason = error instanceof Error ? error.message.slice(0, 500) : 'failed';
      this.rejectPending('Background file services stopped. Retry the operation.');
    });
  }
  async call<M extends MethodName<Methods>>(
    method: M,
    ...[args, signal]: CallArguments<Methods[M]['args']>
  ): Promise<Methods[M]['reply']> {
    await this.start();
    return this.post(method, args ?? ([] as Methods[M]['args']), signal);
  }
  /** Sends without starting the worker: for its own initialization. */
  async post<M extends MethodName<Methods>>(
    method: M,
    args: Methods[M]['args'],
    signal?: AbortSignal,
  ): Promise<Methods[M]['reply']> {
    return (await this.send(method, args, signal)) as Methods[M]['reply'];
  }
  private send(
    method: string,
    args: unknown[],
    signal?: AbortSignal,
    timeout = this.options.timeout ?? 120000,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed && method !== 'close') {
        reject(new Error('Background file services are shutting down.'));
        return;
      }
      if (!this.child) {
        reject(new Error('Background file services stopped. Retry the operation.'));
        return;
      }
      if (signal?.aborted) {
        reject(new Error('Task cancelled.'));
        return;
      }
      const id = randomUUID();
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      const fail = (message: string) => {
        clearTimeout(timer);
        cleanup();
        this.pending.delete(id);
        try {
          this.child?.postMessage({ id: randomUUID(), method: 'cancel', args: [id] });
        } catch {
          /* The owned worker may have exited before the timeout. */
        }
        reject(new Error(message));
      };
      const cancel = () => fail('Task cancelled.');
      const timer = setTimeout(() => fail('Background operation timed out.'), timeout);
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, { resolve, reject, timer, cleanup });
      try {
        this.child.postMessage({ id, method, args });
      } catch (error) {
        clearTimeout(timer);
        cleanup();
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private rejectPending(message: string) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.cleanup();
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.rejectPending('Background file services are shutting down.');
    const child = this.child;
    if (!child) return (this.closing = Promise.resolve());
    return (this.closing = (async () => {
      // Workers only read source files and write derived metadata. Allow a
      // checkpoint, then stop only this owned worker if reads are stuck.
      await this.send('close', [], undefined, 2000).catch(() => {});
      if (child.thread) {
        await child.thread.terminate();
        return;
      }
      const processChild = child.process!;
      const pid = processChild.pid;
      let exited = pid === undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stopped = new Promise<void>((resolve) => {
        child.exit(() => {
          exited = true;
          clearTimeout(timer);
          resolve();
        }, true);
        timer = setTimeout(resolve, 1000);
      });
      processChild.kill();
      if (!exited) await stopped;
      clearTimeout(timer);
      if (!exited && pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
    })());
  }
}
