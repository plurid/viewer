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

  check = async (path: string): Promise<CheckedFolder> => {
    const epoch = this.epoch;
    const volume = folderVolume(path);
    if (volume && (this.blocked.get(volume) ?? 0) > Date.now())
      return { directory: false, unavailable: true, timedOut: true };
    const scope = this.access?.(path);
    if (this.access && !scope) return { directory: false, unavailable: true };
    let value: CheckedFolder;
    try {
      value = await this.metadata(path);
    } catch (error) {
      if (epoch !== this.epoch) return { directory: false, unavailable: true };
      if (!(error instanceof FolderCheckTimeout)) return { directory: false, unavailable: true };
      if (volume) this.blocked.set(volume, Date.now() + 30_000);
      return { directory: false, unavailable: true, timedOut: true };
    }
    if (epoch !== this.epoch || (scope && (!value.path || !scope.allows(value.path))))
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

  private read(path: string): Promise<CheckedFolder> {
    let slot = this.slots.find((item) => !item.resolve);
    if (!slot) {
      if (this.slots.length >= folderCheckOutstandingLimit)
        return Promise.reject(new Error('Some folders could not be checked. Try again.'));
      const created: Slot = {
        worker: launchWorker(this.workerPath, 'Viewer folder history', 'thread'),
      };
      created.worker.message(({ value }) => {
        const resolve = created.resolve;
        created.resolve = undefined;
        resolve?.(value);
      });
      created.worker.thread?.on('error', () => {
        created.resolve?.({ directory: false, unavailable: true });
        created.resolve = undefined;
      });
      created.worker.exit(() => {
        created.resolve?.({ directory: false, unavailable: true });
        this.slots = this.slots.filter((item) => item !== created);
      });
      this.slots.push(created);
      slot = created;
    }
    const target = slot;
    return new Promise((resolve) => {
      target.resolve = resolve;
      target.worker.postMessage(path);
    });
  }

  close(): void {
    this.clear();
    for (const slot of this.slots) void slot.worker.thread?.terminate();
  }
}

export function createFolderHistoryChecks(
  workerPath: string,
  access: Pick<FileAccess, 'historyScope'>,
): FolderHistoryChecks {
  return new FolderHistoryChecks(workerPath, (path) => access.historyScope(path));
}
