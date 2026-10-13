import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

interface Reply {
  id?: string;
  value?: unknown;
  error?: string;
  code?: string;
  event?: string;
}
export interface OwnedWorker {
  process?: UtilityProcess;
  thread?: Worker;
  postMessage(value: unknown): void;
  message(listener: (reply: Reply) => void): void;
  exit(listener: () => void, once?: boolean): void;
}
export function launchWorker(
  worker: string,
  name: string,
  backend?: 'process' | 'thread',
): OwnedWorker {
  if (backend === 'thread') {
    const child = new Worker(worker, { name, stdout: true, stderr: true });
    if (process.env.VIEWER_RENDER_TEST === '1') child.stderr?.pipe(process.stderr);
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
export class UtilityClient {
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
      backend?: 'process' | 'thread';
      timeout?: number;
      initialize?(client: UtilityClient): Promise<unknown>;
      event?(reply: Reply): void;
      stopped?(): void;
    },
  ) {}

  private start(): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error('Background file services are shutting down.'));
    if (this.ready) return this.ready;
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
    child.exit(() => {
      if (this.child !== child) return;
      this.rejectPending('Background file services stopped. Retry the operation.');
      this.child = undefined;
      this.ready = undefined;
      this.options.stopped?.();
    });
    child.thread?.on('error', () =>
      this.rejectPending('Background file services stopped. Retry the operation.'),
    );
    return (this.ready = this.options.initialize?.(this) ?? Promise.resolve());
  }
  async call<T>(method: string, args: unknown[] = [], signal?: AbortSignal): Promise<T> {
    await this.start();
    return (await this.post(method, args, signal)) as T;
  }
  post(
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
      await this.post('close', [], undefined, 2000).catch(() => {});
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
