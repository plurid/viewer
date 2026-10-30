import type { WorksheetWindow } from '../../domain/previews/documents/office';
import type { SQLiteReply, SQLiteRequest } from '../../domain/previews/data/sqlite';
import type { DrawingGeometryOptions } from '../../domain/previews/drawings/geometry';
import type { SavedPage } from '../../domain/previews/saved-page';
import path from 'node:path';
import { UtilityClient } from '../workers/utility-client';
import type { IndexMethods } from '../workers/index-protocol';
import type { FolderSizeMethods } from './folder-size-worker';
import type { PreviewMethods } from '../workers/preview-worker';
import { entry } from './filesystem';
import { spotlightTagged } from '../search/spotlight';
import { parseFileQuery } from '../../domain/search/query';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import type { FolderSizeTask } from '../../domain/files/metadata';
import type {
  ApplicationSettings,
  DocumentData,
  IndexedQuery,
  IndexStatus,
} from '../../domain/services';
import type { WorkerBackend } from '../workers/utility-client';

/** How often windows hear of indexing progress; a start or finish is sent at once. */
const indexStatusInterval = 250;

/**
 * Index status changes with every file the index reads: copying 2,000 files sent 828 status
 * events. Windows show progress, so they get the latest status a few times a second.
 */
export function coalescedIndexStatus(
  emit: (status: IndexStatus) => void,
  interval = indexStatusInterval,
): (status: IndexStatus) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: IndexStatus | undefined;
  let running: boolean | undefined;
  return (status) => {
    if (status.running !== running) {
      running = status.running;
      clearTimeout(timer);
      timer = undefined;
      latest = undefined;
      emit(status);
      return;
    }
    latest = status;
    timer ??= setTimeout(() => {
      timer = undefined;
      if (latest) emit(latest);
      latest = undefined;
    }, interval);
  };
}

export class FileServices {
  private index: UtilityClient<IndexMethods>;
  private measurement: UtilityClient<FolderSizeMethods>;
  /** Preview documents, apart from the index: its crawl kept a small book waiting for seconds. */
  private previews: UtilityClient<PreviewMethods>;
  private configuration?: ApplicationSettings['search'];
  private configurations: Promise<void> = Promise.resolve();
  private unavailable: string[] = [];
  private sizes = new Map<string, FolderSizeTask>();
  private closing?: Promise<void>;
  private lifecycle: Promise<void> = Promise.resolve();
  private revision = 0;
  private accessRevision = 0;
  private createIndex: () => UtilityClient<IndexMethods>;
  private createMeasurement: () => UtilityClient<FolderSizeMethods>;
  private createPreviews: () => UtilityClient<PreviewMethods>;
  constructor(
    private dataPath: string,
    worker: string,
    ocr: string,
    emit: (status: IndexStatus) => void,
    sizeChanged: (task: FolderSizeTask) => void = () => {},
    private options: {
      backend?: WorkerBackend;
      access?(paths: readonly string[]): Promise<void>;
    } = {},
  ) {
    const status = coalescedIndexStatus(emit);
    this.createIndex = () =>
      new UtilityClient<IndexMethods>(worker, {
        name: 'Viewer file services',
        backend: options.backend,
        initialize: async (client) => {
          await client.post('init', [path.join(dataPath, 'files-v1.sqlite'), ocr]);
          if (this.configuration) await client.post('configure', [this.configuration]);
        },
        event: (reply) => {
          if (reply.event === 'index') status(this.withUnavailable(reply.value as IndexStatus));
        },
      });
    this.index = this.createIndex();
    this.createMeasurement = () =>
      new UtilityClient<FolderSizeMethods>(
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
    this.measurement = this.createMeasurement();
    this.createPreviews = () =>
      new UtilityClient<PreviewMethods>(path.join(path.dirname(worker), 'preview-worker.cjs'), {
        name: 'Viewer previews',
        backend: options.backend,
      });
    this.previews = this.createPreviews();
  }
  /** Starts the preview worker while the window is idle, so the first preview finds it ready. */
  warmPreviews(): Promise<void> {
    return this.previews.call('ready').then(() => {});
  }
  /** `rebuild`: crawl every root and extract every document again, whatever is stored. */
  configure(value: ApplicationSettings['search'], rebuild = false): Promise<void> {
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
        await this.index.call('configure', rebuild ? [effective, true] : [effective]);
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
  /** The paths of each Finder tag a query names, from Spotlight, under its root or the indexed
   * roots; a query that does not read is left to the index to explain. */
  private async tagged(value: IndexedQuery): Promise<IndexedQuery> {
    let tags: string[];
    try {
      tags = parseFileQuery(value.query).tags;
    } catch {
      return value;
    }
    if (!tags.length) return value;
    const roots = value.root ? [value.root] : (this.configuration?.roots ?? []);
    const tagged: Record<string, string[]> = {};
    for (const tag of tags) {
      const paths = new Set<string>();
      for (const root of roots)
        for (const file of await spotlightTagged(root, tag)) {
          if (paths.size >= 20000) break;
          paths.add(file);
        }
      tagged[tag] = [...paths];
    }
    return { ...value, tagged };
  }
  async query(value: IndexedQuery) {
    const revision = this.revision;
    if (value.root) await this.options.access?.([value.root]);
    const result = await this.index.call('query', [await this.tagged(value)]);
    if (revision !== this.revision) throw new Error('Search configuration changed. Search again.');
    if (value.root) await this.options.access?.([value.root]);
    await this.options.access?.(result.entries.map((entry) => entry.path));
    return { ...result, status: this.withUnavailable(result.status) };
  }
  async snapshot(value: IndexedQuery) {
    const revision = this.revision;
    if (value.root) await this.options.access?.([value.root]);
    const snapshot = await this.index.call('query-snapshot', [await this.tagged(value)]);
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
    return this.measurement.call('size-start', [paths]);
  }
  sizeGet(id: string) {
    return this.measurement.call('size-get', [id]);
  }
  async sizeCancel(id: string) {
    await this.measurement.call('size-cancel', [id]);
  }
  async status() {
    return this.withUnavailable(await this.index.call('status'));
  }
  async update(file: string, removed = false) {
    await this.options.access?.([file]);
    await this.index.call('update', [file, removed]);
  }
  /** `format`, the extension a preview reads the file as; its name otherwise. `message`, one
   * message of a mailbox. */
  async extract(
    file: string,
    signal?: AbortSignal,
    chapters = false,
    worksheet?: WorksheetWindow,
    format?: string,
    message?: number,
  ): Promise<DocumentData> {
    await this.options.access?.([file]);
    const revision = this.accessRevision;
    const result = await this.previews.call(
      'extract',
      message !== undefined
        ? [file, undefined, chapters, worksheet, format, message]
        : format
          ? [file, undefined, chapters, worksheet, format]
          : worksheet
            ? [file, undefined, chapters, worksheet]
            : [file, undefined, chapters],
      signal,
    );
    if (revision !== this.accessRevision)
      throw new Error('File access changed. Read the document again.');
    await this.options.access?.([file]);
    return result;
  }
  /** An email's HTML body or a saved web page, with the parts it shows, read in the preview
   * worker. */
  async page(
    file: string,
    format: string,
    message?: number,
    signal?: AbortSignal,
  ): Promise<SavedPage> {
    await this.options.access?.([file]);
    const revision = this.accessRevision;
    const page = await this.previews.call(
      'page',
      message === undefined ? [file, format] : [file, format, message],
      signal,
    );
    if (revision !== this.accessRevision)
      throw new Error('File access changed. Open the preview again.');
    await this.options.access?.([file]);
    return page;
  }
  async sqlite(file: string, request: SQLiteRequest, signal?: AbortSignal): Promise<SQLiteReply> {
    await this.options.access?.([file]);
    const revision = this.accessRevision;
    const reply = await this.previews.call('sqlite', [file, request], signal);
    if (revision !== this.accessRevision)
      throw new Error('File access changed. Read the database again.');
    await this.options.access?.([file]);
    return reply;
  }
  async inspect(file: string, content = false, ocr = false, signal?: AbortSignal) {
    await this.options.access?.([file]);
    // Explicit inspection is independent of index preferences. Reset/revocation
    // still retires its results, and the native grant is checked again below.
    const revision = this.accessRevision;
    const result = await this.index.call('inspect', [file, content, ocr], signal);
    if (revision !== this.accessRevision) throw new Error('File access changed. Inspect again.');
    await this.options.access?.([file]);
    return result;
  }
  async drawingGeometry(file: string, options: DrawingGeometryOptions = {}, signal?: AbortSignal) {
    await this.options.access?.([file]);
    const revision = this.accessRevision;
    const result = await this.index.call('drawing-geometry', [file, options], signal);
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
        await Promise.all([this.index.close(), this.measurement.close(), this.previews.close()]);
        this.configuration = undefined;
        this.index = this.createIndex();
        this.measurement = this.createMeasurement();
        this.previews = this.createPreviews();
      });
    this.lifecycle = work;
    return work;
  }
  close(): Promise<void> {
    return (this.closing ??= this.lifecycle
      .catch(() => {})
      .then(() =>
        Promise.allSettled([this.index.close(), this.measurement.close(), this.previews.close()]),
      )
      .then((results) => {
        const errors = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, 'Read-only workers failed to stop.');
      }));
  }
}
