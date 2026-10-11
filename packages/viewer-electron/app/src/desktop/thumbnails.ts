import { nativeImage } from 'electron';
import { entry } from './filesystem';
/** Cache bounded, resized PNGs, never original decoded images. */
export class Thumbnails {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  async get(file: string, size: number): Promise<string> {
    const item = await entry(file);
    if (item.directory || item.kind !== 'file' || item.size > 64000000) return '';
    const key = item.identity + ':' + item.modified + ':' + size;
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        const image = await nativeImage.createThumbnailFromPath(file, {
          width: size,
          height: size,
        });
        const value = image.toDataURL();
        if (value.length > 1000000) return '';
        this.cache.set(key, value);
        let bytes = [...this.cache.values()].reduce((n, value) => n + value.length, 0);
        for (const [old, value] of this.cache) {
          if (this.cache.size <= 128 && bytes <= 16000000) break;
          this.cache.delete(old);
          bytes -= value.length;
        }
        return value;
      })
      .catch(() => '');
    this.queue = work;
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  clear(): void {
    this.cache.clear();
  }
}
