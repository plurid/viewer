import type { QuerySnapshot } from '../domain/collections';
import type { DrawingGeometryOptions, DrawingGeometryPage } from '../domain/drawing-geometry';
import path from 'node:path';
import { UtilityClient } from './utility-client';
import { entry } from './filesystem';
import { sameSourceVersion, sourceVersion, type InspectionResult } from '../domain/inspection';
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
  private lifecycle: Promise<void> = Promise.resolve();
  private revision = 0;
  private accessRevision = 0;
  private createIndex: () => UtilityClient;
  private createMeasurement: () => UtilityClient;
  constructor(
    private dataPath: string,
    worker: string,
    ocr: string,
    emit: (status: IndexStatus) => void,
    sizeChanged: (task: FolderSizeTask) => void = () => {},
    private options: {
      backend?: 'process' | 'thread';
      access?(paths: readonly string[]): Promise<void>;
    } = {},
  ) {
    this.createIndex = () =>
      new UtilityClient(worker, {
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
    this.index = this.createIndex();
    this.createMeasurement = () =>
      new UtilityClient(path.join(path.dirname(worker), 'folder-size-worker.cjs'), {
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
      });
    this.measurement = this.createMeasurement();
  }
  configure(value: ApplicationSettings['search']): Promise<void> {
    this.revision++;
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
        const effective = {
          ...value,
          roots: allowed,
          contentRoots,
          exclusions: [...new Set([...value.exclusions, this.dataPath])],
        };
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
    const revision = this.revision;
    if (value.root) await this.options.access?.([value.root]);
    const result = await this.index.call<IndexedResult>('query', [value]);
    if (revision !== this.revision) throw new Error('Search configuration changed. Search again.');
    if (value.root) await this.options.access?.([value.root]);
    await this.options.access?.(result.entries.map((entry) => entry.path));
    return { ...result, status: this.withUnavailable(result.status) };
  }
  async snapshot(value: IndexedQuery) {
    const revision = this.revision;
    if (value.root) await this.options.access?.([value.root]);
    const snapshot = await this.index.call<QuerySnapshot>('query-snapshot', [value]);
    await this.options.access?.(snapshot.entries.map((item) => item.path));
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, snapshot.entries.length) }, async () => {
        while (cursor < snapshot.entries.length) {
          const item = snapshot.entries[cursor++];
          if (!item) break;
          if (!sameSourceVersion(sourceVersion(item), sourceVersion(await entry(item.path))))
            throw new Error(
              'A matching file changed since indexing. Refresh the index and take a new snapshot.',
            );
        }
      }),
    );
    if (revision !== this.revision)
      throw new Error('Search permissions changed. Take another selection snapshot.');
    await this.options.access?.(snapshot.entries.map((item) => item.path));
    return snapshot;
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
    const result = await this.index.call<DocumentData>(
      'extract',
      [file, undefined, chapters],
      signal,
    );
    await this.options.access?.([file]);
    return result;
  }
  async inspect(file: string, content = false, ocr = false, signal?: AbortSignal) {
    await this.options.access?.([file]);
    // Explicit inspection is independent of index preferences. Reset/revocation
    // still retires its results, and the native grant is checked again below.
    const revision = this.accessRevision;
    const result = await this.index.call<InspectionResult>('inspect', [file, content, ocr], signal);
    if (revision !== this.accessRevision) throw new Error('File access changed. Inspect again.');
    await this.options.access?.([file]);
    return result;
  }
  async drawingGeometry(file: string, options: DrawingGeometryOptions = {}, signal?: AbortSignal) {
    await this.options.access?.([file]);
    const revision = this.accessRevision;
    const result = await this.index.call<DrawingGeometryPage>(
      'drawing-geometry',
      [file, options],
      signal,
    );
    if (revision !== this.accessRevision)
      throw new Error('File access changed. Read the geometry again.');
    await this.options.access?.([file]);
    return result;
  }
  reset(): Promise<void> {
    this.revision++;
    this.accessRevision++;
    const work = this.lifecycle
      .catch(() => {})
      .then(async () => {
        if (this.closing) throw new Error('File services have closed.');
        await this.configurations.catch(() => {});
        await Promise.all([this.index.close(), this.measurement.close()]);
        this.configuration = undefined;
        this.index = this.createIndex();
        this.measurement = this.createMeasurement();
      });
    this.lifecycle = work;
    return work;
  }
  close(): Promise<void> {
    return (this.closing ??= this.lifecycle
      .catch(() => {})
      .then(() => Promise.allSettled([this.index.close(), this.measurement.close()]))
      .then((results) => {
        const errors = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, 'Read-only workers failed to stop.');
      }));
  }
}
