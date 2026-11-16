import { launchWorker } from '../workers/utility-client';
import type { OwnedWorker } from '../workers/utility-client';
import type { CheckedFolder } from '../../domain/files/folder-checks';
import { FolderCheckPool, folderCheckConcurrency, folderCheckAbandonedLimit } from '../../domain/files/folder-checks';

interface Slot {
  worker: OwnedWorker<{ value: CheckedFolder }>;
  resolve?: (value: CheckedFolder) => void;
}

/** All windows and launch share two lanes and two abandoned reads, outside libuv's four threads. */
export class FolderHistoryChecks {
  private pool = new FolderCheckPool();
  private slots: Slot[] = [];
  private epoch = 0;
  private checked = new Map<string, CheckedFolder>();

  constructor(private workerPath: string) {}

  get paths(): string[] {
    return [...this.checked].filter(([, value]) => value.directory).map(([path]) => path);
  }

  clear(): void {
    this.epoch++;
    this.checked.clear();
    this.pool.clear();
  }

  check = async (path: string): Promise<CheckedFolder> => {
    const epoch = this.epoch;
    const value = await this.pool.run(path, (file) => this.read(file), new AbortController().signal);
    if (epoch === this.epoch) {
      this.checked.set(path, value);
      while (this.checked.size > 500) this.checked.delete(this.checked.keys().next().value!);
    }
    return value;
  };

  private read(path: string): Promise<CheckedFolder> {
    let slot = this.slots.find((item) => !item.resolve);
    if (!slot) {
      if (this.slots.length >= folderCheckConcurrency + folderCheckAbandonedLimit)
        return Promise.reject(new Error('Some folders could not be checked. Try again.'));
      const created: Slot = { worker: launchWorker(this.workerPath, 'Viewer folder history', 'thread') };
      created.worker.message(({ value }) => {
        const resolve = created.resolve;
        created.resolve = undefined;
        resolve?.(value);
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
