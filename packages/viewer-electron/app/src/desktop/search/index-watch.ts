import type { ApplicationSettings } from '../../domain/services';
import { watchDirectory, type DirectoryWatch } from '../files/directory-watch';
import { searchExclusions } from './exclusions';
import { containsPath } from '../files/containment';

/** Coalesce event bursts into bounded, serial index reconciliations. */
export class IndexWatcher {
  private watches: DirectoryWatch[] = [];
  private pending = new Map<string, Set<string>>();
  private timer?: ReturnType<typeof setTimeout>;
  private updating?: Promise<void>;
  private stopping?: Promise<void>;
  private closed = false;
  constructor(
    config: ApplicationSettings['search'],
    private changed: (file: string) => Promise<void>,
    failed: (root: string, error: Error) => void,
  ) {
    const excluded = searchExclusions(config.exclusions);
    for (const root of new Set(config.roots))
      this.watches.push(
        watchDirectory(root, {
          recursive: true,
          ignored: excluded,
          changed: (file) => this.queue(root, file),
          failed: (error) => failed(root, error),
        }),
      );
  }
  private queue(root: string, file: string) {
    if (this.closed) return;
    const files = this.pending.get(root) ?? new Set<string>();
    this.pending.set(root, files);
    if (files.has(root)) return;
    if (file === root || files.size >= 512) {
      // A bulk transfer needs one subtree reconciliation, not an unbounded
      // promise chain retaining thousands of file paths while crawling.
      files.clear();
      files.add(root);
    } else files.add(file);
    this.schedule();
  }
  private schedule() {
    if (this.closed || this.timer || this.updating || !this.pending.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const batches = [...this.pending.values()];
      this.pending.clear();
      this.updating = (async () => {
        for (const files of batches) {
          const parents: string[] = [];
          for (const file of [...files].sort((a, b) => a.length - b.length)) {
            if (this.closed) return;
            if (parents.some((parent) => containsPath(parent, file))) continue;
            parents.push(file);
            await this.changed(file);
          }
        }
      })()
        .catch(() => {})
        .finally(() => {
          this.updating = undefined;
          this.schedule();
        });
    }, 250);
  }
  /** Retire events and release handles without waiting for a queued index read.
   * Reconfiguration must be able to cancel a long crawl before draining updates. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    clearTimeout(this.timer);
    this.pending.clear();
    return (this.stopping = Promise.all(this.watches.map((watch) => watch.close())).then(() => {}));
  }
  async close(): Promise<void> {
    await this.stop();
    await this.updating;
  }
}
