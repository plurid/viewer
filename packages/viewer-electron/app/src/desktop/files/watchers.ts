import { watchDirectory, type DirectoryWatch } from './directory-watch';
import { absolute } from './filesystem';
import type { DesktopEvent } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';
import { assertLocalPath } from './local-path';
import { watchVolumeChanges } from './sharing-volumes';

interface SharedWatch {
  watcher: DirectoryWatch;
  subscribers: Set<string>;
  failed?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
interface SubscriberRecord {
  folder: string;
  owner?: number;
}
const subscriberKey = (subscriber: string, owner?: number) =>
  owner === undefined ? subscriber : `${owner}:${subscriber}`;
const onMountedVolume = (folder: string) => folder.startsWith('/Volumes/');

export class Watchers {
  private watches = new Map<string, SharedWatch>();
  private subscribers = new Map<string, SubscriberRecord>();
  private ownerGenerations = new Map<number, number>();
  private closed = false;
  private stopVolumes?: () => void;
  private volumeTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private emit: (event: DesktopEvent) => void,
    private watchVolumes: (changed: () => void) => () => void = watchVolumeChanges,
  ) {}
  async add(folder: string, subscriber: string, owner?: number): Promise<void> {
    assertLocalPath(folder);
    const normalized = absolute(folder);
    if (this.closed) throw new Error('Folder watching has closed.');
    const key = subscriberKey(subscriber, owner);
    if (this.subscribers.get(key)?.folder === normalized && !this.watches.get(normalized)?.failed)
      return;
    // Update ownership before awaiting a slow watcher close, so overlapping requests
    // from the same plane cannot resurrect an obsolete subscription.
    const cleanup = this.removeKey(key);
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
    shared.subscribers.add(key);
    this.subscribers.set(key, { folder: normalized, owner });
    this.syncVolumeWatch();
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
  /** FSEvents drops unmount events on watched subdirectories; fan out /Volumes changes to them. */
  private syncVolumeWatch(): void {
    const needed = !this.closed && [...this.watches.keys()].some(onMountedVolume);
    if (needed && !this.stopVolumes) {
      this.stopVolumes = this.watchVolumes(() => {
        if (this.closed) return;
        clearTimeout(this.volumeTimer);
        this.volumeTimer = setTimeout(() => {
          if (this.closed) return;
          for (const [folder, shared] of this.watches)
            if (onMountedVolume(folder) && shared.subscribers.size && !shared.failed)
              this.emit({ type: 'folder-changed', path: folder });
        }, 100);
      });
    } else if (!needed && this.stopVolumes) {
      clearTimeout(this.volumeTimer);
      this.volumeTimer = undefined;
      this.stopVolumes();
      this.stopVolumes = undefined;
    }
  }
  private async removeKey(key: string): Promise<void> {
    const record = this.subscribers.get(key);
    this.subscribers.delete(key);
    if (!record) return;
    const shared = this.watches.get(record.folder);
    if (!shared) return;
    shared.subscribers.delete(key);
    if (!shared.subscribers.size) {
      this.watches.delete(record.folder);
      clearTimeout(shared.timer);
      this.syncVolumeWatch();
      await shared.watcher.close();
    }
  }
  remove(subscriber: string, owner?: number): Promise<void> {
    return this.removeKey(subscriberKey(subscriber, owner));
  }
  ownerGeneration(owner: number): number {
    return this.ownerGenerations.get(owner) ?? 0;
  }
  async stopOwner(owner: number): Promise<void> {
    this.ownerGenerations.set(owner, (this.ownerGenerations.get(owner) ?? 0) + 1);
    const keys = [...this.subscribers]
      .filter(([, record]) => record.owner === owner)
      .map(([key]) => key);
    await Promise.all(keys.map((key) => this.removeKey(key)));
  }
  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.volumeTimer);
    this.volumeTimer = undefined;
    this.stopVolumes?.();
    this.stopVolumes = undefined;
    const watches = [...this.watches.values()];
    this.watches.clear();
    this.subscribers.clear();
    this.ownerGenerations.clear();
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
        for (const subscriber of [...watch.subscribers]) await this.removeKey(subscriber);
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
