import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';

interface Reply {
  id?: string;
  value?: unknown;
  error?: string;
  event?: string;
}

/** Owns one read-only worker, its pending calls, restart and bounded shutdown. */
export class UtilityClient {
  private child?: UtilityProcess;
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
    const child = utilityProcess.fork(this.worker, [], {
      serviceName: this.options.name,
      stdio: 'pipe',
    });
    this.child = child;
    child.on('message', (reply: Reply) => {
      if (reply.event) {
        this.options.event?.(reply);
        return;
      }
      const pending = reply.id && this.pending.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.cleanup();
      this.pending.delete(reply.id!);
      if (reply.error) pending.reject(new Error(reply.error));
      else pending.resolve(reply.value);
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.rejectPending('Background file services stopped. Retry the operation.');
      this.child = undefined;
      this.ready = undefined;
      this.options.stopped?.();
    });
    child.stderr?.on('data', (data) => {
      if (process.env.VIEWER_RENDER_TEST === '1') process.stderr.write(data);
    });
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
      const pid = child.pid;
      let exited = pid === undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stopped = new Promise<void>((resolve) => {
        child.once('exit', () => {
          exited = true;
          clearTimeout(timer);
          resolve();
        });
        timer = setTimeout(resolve, 1000);
      });
      child.kill();
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
