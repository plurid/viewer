export type AppIconSize = 'small' | 'large';
type Render = (file: string, size: AppIconSize, signal: AbortSignal) => Promise<string>;

/**
 * Finder's icons for application bundles, as data URLs. Entries are keyed by path, size
 * and modification time, so an updated app shows its new icon; the cache is bounded.
 */
export class AppIcons {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private tail: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();
  private closed = false;
  constructor(
    private render: Render,
    private limit = 512,
  ) {}
  get(file: string, size: AppIconSize, modified: number): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Bundle icons have closed.'));
    const key = `${size}\0${modified}\0${file}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Recently used icons stay; the oldest are evicted first.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 64)
      return Promise.reject(new Error('Too many bundle icons are loading.'));
    const work = this.tail
      .catch(() => {})
      .then(() => {
        this.abort.signal.throwIfAborted();
        return this.render(file, size, this.abort.signal);
      })
      .then((icon) => {
        this.abort.signal.throwIfAborted();
        this.cache.set(key, icon);
        let bytes = [...this.cache.values()].reduce((total, value) => total + value.length, 0);
        for (const [key, value] of this.cache) {
          if (this.cache.size <= this.limit && bytes <= 16000000) break;
          this.cache.delete(key);
          bytes -= value.length;
        }
        return icon;
      })
      .finally(() => this.pending.delete(key));
    this.tail = work;
    this.pending.set(key, work);
    return work;
  }
  clear(): void {
    this.cache.clear();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort(new Error('Bundle icons have closed.'));
    this.cache.clear();
    await Promise.allSettled([...this.pending.values()]);
  }
  /** A bundle that changed: its icons are rendered again, and the others kept. */
  forget(file: string): void {
    for (const key of [...this.cache.keys()]) if (key.endsWith('\0' + file)) this.cache.delete(key);
  }
}
