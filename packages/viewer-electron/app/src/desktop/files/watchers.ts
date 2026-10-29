import { watchDirectory, type DirectoryWatch } from './directory-watch';
import { absolute } from './filesystem';
import type { DesktopEvent } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';

interface SharedWatch {
  watcher: DirectoryWatch;
  subscribers: Set<string>;
  failed?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
export class Watchers {
  private watches = new Map<string, SharedWatch>();
  private subscribers = new Map<string, string>();
  private closed = false;
  constructor(private emit: (event: DesktopEvent) => void) {}
  async add(folder: string, subscriber: string): Promise<void> {
    const normalized = absolute(folder);
    if (this.closed) throw new Error('Folder watching has closed.');
    if (this.subscribers.get(subscriber) === normalized && !this.watches.get(normalized)?.failed)
      return;
    // Update ownership before awaiting a slow watcher close, so overlapping requests
    // from the same plane cannot resurrect an obsolete subscription.
    const cleanup = this.remove(subscriber);
    let shared = this.watches.get(normalized);
    let retired: Promise<void> | undefined;
    if (shared?.failed) {
      clearTimeout(shared.timer);
      retired = shared.watcher.close();
      shared = this.create(normalized, shared.subscribers);
    }
    if (!shared) {
      shared = this.create(normalized);
    }
    shared.subscribers.add(subscriber);
    this.subscribers.set(subscriber, normalized);
    await Promise.all([cleanup, retired]);
  }
  private create(folder: string, subscribers = new Set<string>()): SharedWatch {
    const owned = { subscribers } as SharedWatch;
    owned.watcher = watchDirectory(folder, {
      changed: () => {
        if (this.watches.get(folder) !== owned || owned.failed) return;
        clearTimeout(owned.timer);
        owned.timer = setTimeout(() => {
          if (this.watches.get(folder) === owned && owned.subscribers.size && !owned.failed)
            this.emit({ type: 'folder-changed', path: folder });
        }, 100);
      },
      failed: (error) => {
        if (this.watches.get(folder) !== owned) return;
        owned.failed = true;
        clearTimeout(owned.timer);
        this.emit({
          type: 'watch-error',
          path: folder,
          message: errorMessage(error),
          code: (error as NodeJS.ErrnoException).code,
        });
      },
    });
    this.watches.set(folder, owned);
    return owned;
  }
  async remove(subscriber: string): Promise<void> {
    const folder = this.subscribers.get(subscriber);
    this.subscribers.delete(subscriber);
    if (!folder) return;
    const shared = this.watches.get(folder);
    if (!shared) return;
    shared.subscribers.delete(subscriber);
    if (!shared.subscribers.size) {
      this.watches.delete(folder);
      clearTimeout(shared.timer);
      await shared.watcher.close();
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    const watches = [...this.watches.values()];
    this.watches.clear();
    this.subscribers.clear();
    await Promise.all(
      watches.map(async (shared) => {
        clearTimeout(shared.timer);
        await shared.watcher.close();
      }),
    );
  }
  async revoke(root: string): Promise<void> {
    const prefix = root.replace(/[\\/]$/, '') + '/';
    const paths = [...this.watches.keys()].filter(
      (folder) => folder === root || folder.startsWith(prefix),
    );
    await Promise.all(
      paths.map(async (folder) => {
        const watch = this.watches.get(folder);
        if (!watch) return;
        for (const subscriber of [...watch.subscribers]) await this.remove(subscriber);
        this.emit({
          type: 'watch-error',
          path: folder,
          code: 'FILE_ACCESS_REQUIRED',
          message: 'Folder access was revoked. Choose the folder again to allow access.',
        });
      }),
    );
  }
  get count(): number {
    return this.watches.size;
  }
}
