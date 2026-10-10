import chokidar, { type FSWatcher } from 'chokidar';
import { absolute, message } from './filesystem';
import type { DesktopEvent } from '../domain/contracts';

interface SharedWatch {
  watcher: FSWatcher;
  subscribers: Set<string>;
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
    if (this.subscribers.get(subscriber) === normalized) return;
    // Update ownership before awaiting a slow watcher close, so overlapping requests
    // from the same plane cannot resurrect an obsolete subscription.
    const cleanup = this.remove(subscriber);
    let shared = this.watches.get(normalized);
    if (!shared) {
      const watcher = chokidar.watch(normalized, {
        depth: 0,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 60 },
      });
      shared = { watcher, subscribers: new Set() };
      this.watches.set(normalized, shared);
      const owned = shared;
      watcher.on('all', () => {
        clearTimeout(owned.timer);
        owned.timer = setTimeout(() => {
          if (owned.subscribers.size) this.emit({ type: 'folder-changed', path: normalized });
        }, 100);
      });
      watcher.on('error', (error) =>
        this.emit({ type: 'watch-error', path: normalized, message: message(error) }),
      );
    }
    shared.subscribers.add(subscriber);
    this.subscribers.set(subscriber, normalized);
    await cleanup;
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
  get count(): number {
    return this.watches.size;
  }
}
