import path from 'node:path';
import { UtilityClient } from './utility-client';
import type { FolderSizeTask } from '../domain/metadata';
import type {
  ApplicationSettings,
  DocumentData,
  IndexedQuery,
  IndexedResult,
  IndexStatus,
} from '../domain/services';

export class FileServices {
  private index: UtilityClient;
  private measurement: UtilityClient;
  private configuration?: ApplicationSettings['search'];
  private configurations: Promise<void> = Promise.resolve();
  private unavailable: string[] = [];
  private sizes = new Map<string, FolderSizeTask>();
  private closing?: Promise<void>;
  constructor(
    dataPath: string,
    worker: string,
    ocr: string,
    emit: (status: IndexStatus) => void,
    sizeChanged: (task: FolderSizeTask) => void = () => {},
    private options: {
      backend?: 'process' | 'thread';
      access?(paths: readonly string[]): Promise<void>;
    } = {},
  ) {
    this.index = new UtilityClient(worker, {
      name: 'Viewer file services',
      backend: options.backend,
      initialize: async (client) => {
        await client.post('init', [path.join(dataPath, 'files-v1.sqlite'), ocr]);
        if (this.configuration) await client.post('configure', [this.configuration]);
      },
      event: (reply) => {
        if (reply.event === 'index') emit(this.withUnavailable(reply.value as IndexStatus));
      },
    });
    this.measurement = new UtilityClient(
      path.join(path.dirname(worker), 'folder-size-worker.cjs'),
      {
        name: 'Viewer folder sizes',
        backend: options.backend,
        timeout: 10000,
        event: (reply) => {
          if (reply.event !== 'folder-size') return;
          const task = reply.value as FolderSizeTask;
          if (task.status === 'running') this.sizes.set(task.id, task);
          else this.sizes.delete(task.id);
          sizeChanged(task);
        },
        stopped: () => {
          for (const task of this.sizes.values())
            sizeChanged({
              ...task,
              status: 'failed',
              error: 'The size worker stopped. Calculate Size to retry.',
            });
          this.sizes.clear();
        },
      },
    );
  }
  configure(value: ApplicationSettings['search']): Promise<void> {
    const work = this.configurations
      .catch(() => {})
      .then(async () => {
        const allowed: string[] = [],
          unavailable: string[] = [];
        for (const root of value.roots) {
          try {
            await this.options.access?.([root]);
            allowed.push(root);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'FILE_ACCESS_REQUIRED') throw error;
            unavailable.push(root);
          }
        }
        const contentRoots: string[] = [];
        for (const root of value.contentRoots) {
          try {
            await this.options.access?.([root]);
            contentRoots.push(root);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'FILE_ACCESS_REQUIRED') throw error;
          }
        }
        const effective = { ...value, roots: allowed, contentRoots };
        this.unavailable = unavailable;
        await this.index.call('configure', [effective]);
        this.configuration = effective;
      });
    this.configurations = work;
    return work;
  }
  private withUnavailable(value: IndexStatus): IndexStatus {
    return this.unavailable.length
      ? {
          ...value,
          roots: [
            ...value.roots,
            ...this.unavailable.map((path) => ({
              path,
              status: 'offline' as const,
              count: 0,
              errors: 1,
            })),
          ],
        }
      : value;
  }
  async query(value: IndexedQuery) {
    if (value.root) await this.options.access?.([value.root]);
    const result = await this.index.call<IndexedResult>('query', [value]);
    return { ...result, status: this.withUnavailable(result.status) };
  }
  async sizeStart(paths: string[]) {
    await this.options.access?.(paths);
    return this.measurement.call<FolderSizeTask>('size-start', [paths]);
  }
  sizeGet(id: string) {
    return this.measurement.call<FolderSizeTask>('size-get', [id]);
  }
  sizeCancel(id: string) {
    return this.measurement.call<void>('size-cancel', [id]);
  }
  async status() {
    return this.withUnavailable(await this.index.call<IndexStatus>('status'));
  }
  async update(file: string, removed = false) {
    await this.options.access?.([file]);
    return this.index.call<void>('update', [file, removed]);
  }
  async extract(file: string, signal?: AbortSignal, chapters = false): Promise<DocumentData> {
    await this.options.access?.([file]);
    return this.index.call<DocumentData>('extract', [file, undefined, chapters], signal);
  }
  close(): Promise<void> {
    return (this.closing ??= Promise.allSettled([
      this.index.close(),
      this.measurement.close(),
    ]).then((results) => {
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length) throw new AggregateError(errors, 'Read-only workers failed to stop.');
    }));
  }
}
