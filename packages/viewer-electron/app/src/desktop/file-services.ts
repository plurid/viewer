import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  ApplicationSettings,
  DocumentData,
  IndexedQuery,
  IndexedResult,
  IndexStatus,
} from '../domain/services';
export class FileServices {
  private child?: UtilityProcess;
  private ready?: Promise<unknown>;
  private configuration?: ApplicationSettings['search'];
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      cleanup?: () => void;
    }
  >();
  constructor(
    private dataPath: string,
    private worker: string,
    private ocr: string,
    private emit: (status: IndexStatus) => void,
  ) {}
  private start(): Promise<unknown> {
    if (this.ready) return this.ready;
    this.child = utilityProcess.fork(this.worker, [], {
      serviceName: 'Viewer file services',
      stdio: 'pipe',
    });
    this.child.on(
      'message',
      (reply: { id?: string; value?: unknown; error?: string; event?: string }) => {
        if (reply.event === 'index') {
          this.emit(reply.value as IndexStatus);
          return;
        }
        const pending = reply.id && this.pending.get(reply.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.cleanup?.();
        this.pending.delete(reply.id!);
        if (reply.error) pending.reject(new Error(reply.error));
        else pending.resolve(reply.value);
      },
    );
    this.child.on('exit', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.cleanup?.();
        pending.reject(new Error('Background file services stopped. Retry the operation.'));
      }
      this.pending.clear();
      this.child = undefined;
      this.ready = undefined;
    });
    this.child.stderr?.on('data', (data) => {
      if (process.env.VIEWER_RENDER_TEST === '1') process.stderr.write(data);
    });
    this.ready = this.send('init', [path.join(this.dataPath, 'files-v1.sqlite'), this.ocr]).then(
      async (value) => {
        if (this.configuration) await this.send('configure', [this.configuration]);
        return value;
      },
    );
    return this.ready;
  }
  private send(method: string, args: unknown[], signal?: AbortSignal): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Task cancelled.'));
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        this.pending.delete(id);
        this.child?.postMessage({ id: randomUUID(), method: 'cancel', args: [id] });
        reject(new Error('Background operation timed out.'));
      }, 120000);
      const cancel = () => {
        clearTimeout(timer);
        cleanup();
        this.pending.delete(id);
        this.child?.postMessage({ id: randomUUID(), method: 'cancel', args: [id] });
        reject(new Error('Task cancelled.'));
      };
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, { resolve, reject, timer, cleanup });
      this.child!.postMessage({ id, method, args });
    });
  }
  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.start();
    return (await this.send(method, args)) as T;
  }
  async configure(value: ApplicationSettings['search']) {
    await this.start();
    this.configuration = value;
    await this.send('configure', [value]);
  }
  query(value: IndexedQuery) {
    return this.call<IndexedResult>('query', value);
  }
  status() {
    return this.call<IndexStatus>('status');
  }
  update(file: string, removed = false) {
    return this.call<void>('update', file, removed);
  }
  async extract(file: string, signal?: AbortSignal, chapters = false): Promise<DocumentData> {
    await this.start();
    return (await this.send('extract', [file, undefined, chapters], signal)) as DocumentData;
  }
  async close(): Promise<void> {
    if (!this.child) return;
    await this.call('close').catch(() => {});
    this.child?.kill();
  }
}
