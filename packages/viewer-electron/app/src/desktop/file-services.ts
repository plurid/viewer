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
  private sizes = new Map<string, FolderSizeTask>();
  private closing?: Promise<void>;
  constructor(
    dataPath: string,
    worker: string,
    ocr: string,
    emit: (status: IndexStatus) => void,
    sizeChanged: (task: FolderSizeTask) => void = () => {},
  ) {
    this.index = new UtilityClient(worker, {
      name: 'Viewer file services',
      initialize: async (client) => {
        await client.post('init', [path.join(dataPath, 'files-v1.sqlite'), ocr]);
        if (this.configuration) await client.post('configure', [this.configuration]);
      },
      event: (reply) => {
        if (reply.event === 'index') emit(reply.value as IndexStatus);
      },
    });
    this.measurement = new UtilityClient(
      path.join(path.dirname(worker), 'folder-size-worker.cjs'),
      {
        name: 'Viewer folder sizes',
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
  async configure(value: ApplicationSettings['search']) {
    await this.index.call('configure', [value]);
    this.configuration = value;
  }
  query(value: IndexedQuery) {
    return this.index.call<IndexedResult>('query', [value]);
  }
  sizeStart(paths: string[]) {
    return this.measurement.call<FolderSizeTask>('size-start', [paths]);
  }
  sizeGet(id: string) {
    return this.measurement.call<FolderSizeTask>('size-get', [id]);
  }
  sizeCancel(id: string) {
    return this.measurement.call<void>('size-cancel', [id]);
  }
  status() {
    return this.index.call<IndexStatus>('status');
  }
  update(file: string, removed = false) {
    return this.index.call<void>('update', [file, removed]);
  }
  extract(file: string, signal?: AbortSignal, chapters = false): Promise<DocumentData> {
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
