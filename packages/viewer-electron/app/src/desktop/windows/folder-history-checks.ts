import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
import type { ActiveFolderScope, FileAccess } from '../files/file-access';
import { launchWorker } from '../workers/utility-client';
import type { OwnedWorker } from '../workers/utility-client';
import type { CheckedFolder } from '../../domain/files/folder-checks';
import {
  FolderCheckPool,
  FolderCheckTimeout,
  folderVolume,
  folderCheckOutstandingLimit,
} from '../../domain/files/folder-checks';

interface Slot {
  worker: OwnedWorker<{ value: CheckedFolder }>;
  resolve?: (value: CheckedFolder) => void;
}

/** All windows and launch share two lanes and at most six raw reads, outside libuv's pool. */
export class FolderHistoryChecks {
  private pool = new FolderCheckPool();
  private slots: Slot[] = [];
  private closed = false;
  private epoch = 0;
  private blocked = new Map<string, number>();
  private checked = new Map<string, CheckedFolder>();

  constructor(
    private workerPath: string,
    private access?: (path: string) => ActiveFolderScope | undefined,
  ) {}

  get paths(): string[] {
    return [...this.checked]
      .filter(([, value]) => value.directory)
      .map(([path, value]) => value.path ?? path);
  }

  clear(paths?: readonly string[]): void {
    this.epoch++;
    const forgotten = paths && new Set(paths);
    for (const [path, value] of this.checked) {
      if (!forgotten || forgotten.has(path) || (value.path && forgotten.has(value.path)))
        this.checked.delete(path);
    }
    if (!paths) this.blocked.clear();
    else
      for (const path of paths) {
        const volume = folderVolume(path);
        if (volume) this.blocked.delete(volume);
      }
    this.pool.clear();
  }

  remap(changes: FileChange[]): void {
    this.epoch++;
    this.pool.clear();
    const map = pathMapper(changes);
    this.checked = new Map(
      [...this.checked].map(([path, value]) => [
        map(path),
        value.path ? { ...value, path: map(value.path) } : value,
      ]),
    );
  }

  check = async (path: string): Promise<CheckedFolder> => {
    if (this.closed) return { directory: false, unavailable: true };
    const epoch = this.epoch;
    const volume = folderVolume(path);
    if (volume && (this.blocked.get(volume) ?? 0) > Date.now())
      return { directory: false, unavailable: true, timedOut: true };
    const scope = this.access?.(path);
    if (this.access && !scope)
      return this.checked.get(path) ?? { directory: false, unchecked: true };
    let value: CheckedFolder;
    try {
      value = await this.metadata(path);
    } catch (error) {
      if (this.closed || epoch !== this.epoch) return { directory: false, unavailable: true };
      if (!(error instanceof FolderCheckTimeout)) return { directory: false, unavailable: true };
      if (volume) this.blocked.set(volume, Date.now() + 30_000);
      return { directory: false, unavailable: true, timedOut: true };
    }
    // Completed absence must stay hidden when Store access later becomes dormant.
    const missing = value.missing && !value.directory;
    if (
      this.closed ||
      epoch !== this.epoch ||
      (scope && !missing && (!value.path || !scope.allows(value.path)))
    )
      return { directory: false, unavailable: true };
    if (epoch === this.epoch) {
      this.checked.set(path, value);
      while (this.checked.size > 500) this.checked.delete(this.checked.keys().next().value!);
    }
    return value;
  };

  private metadata(path: string): Promise<CheckedFolder> {
    return this.pool.run(path, (file) => this.read(file), new AbortController().signal);
  }

  private retire(slot: Slot, terminate: boolean): void {
    const resolve = slot.resolve;
    slot.resolve = undefined;
    this.slots = this.slots.filter((item) => item !== slot);
    resolve?.({ directory: false, unavailable: true });
    if (terminate) void slot.worker.thread?.terminate();
  }

  private read(path: string): Promise<CheckedFolder> {
    if (this.closed) return Promise.resolve({ directory: false, unavailable: true });
    let slot = this.slots.find((item) => !item.resolve);
    if (!slot) {
      if (this.slots.length >= folderCheckOutstandingLimit)
        return Promise.reject(new Error('Some folders couldn’t be checked. Try again.'));
      const created: Slot = {
        worker: launchWorker(this.workerPath, 'Viewer folder history', 'thread'),
      };
      created.worker.message(({ value }) => {
        const resolve = created.resolve;
        created.resolve = undefined;
        resolve?.(value);
      });
      created.worker.thread?.on('error', () => {
        this.retire(created, true);
      });
      created.worker.exit(() => {
        this.retire(created, false);
      });
      this.slots.push(created);
      slot = created;
    }
    const target = slot;
    return new Promise((resolve) => {
      target.resolve = resolve;
      try {
        target.worker.postMessage(path);
      } catch {
        this.retire(target, true);
      }
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.clear();
    const slots = this.slots;
    this.slots = [];
    for (const slot of slots) {
      const resolve = slot.resolve;
      slot.resolve = undefined;
      resolve?.({ directory: false, unavailable: true });
    }
    return Promise.allSettled(
      slots.map((slot) => Promise.resolve(slot.worker.thread?.terminate())),
    ).then(() => undefined);
  }
}

export function createFolderHistoryChecks(
  workerPath: string,
  access: Pick<FileAccess, 'historyScope'>,
): FolderHistoryChecks {
  return new FolderHistoryChecks(workerPath, (path) => access.historyScope(path));
}
