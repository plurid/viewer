export type AppIconSize = 'small' | 'large';
type Render = (file: string, size: AppIconSize) => Promise<string>;

/**
 * Finder's icons for application bundles, as data URLs. Entries are keyed by path, size
 * and modification time, so an updated app shows its new icon; the cache is bounded.
 */
export class AppIcons {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  constructor(
    private render: Render,
    private limit = 512,
  ) {}
  get(file: string, size: AppIconSize, modified: number): Promise<string> {
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
    const work = this.render(file, size)
      .then((icon) => {
        this.cache.set(key, icon);
        while (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value!);
        return icon;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  clear(): void {
    this.cache.clear();
  }
  /** A bundle that changed: its icons are rendered again, and the others kept. */
  forget(file: string): void {
    for (const key of [...this.cache.keys()]) if (key.endsWith('\0' + file)) this.cache.delete(key);
  }
}
