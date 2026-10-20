import { nativeImage } from 'electron';
import { thumbnailByteLimit } from '../domain/thumbnails';
import { realpath } from 'node:fs/promises';
import { entry } from './filesystem';
import { PreviewWork, previewContains, type PreviewScope } from './preview-work';
import { fileCoordination } from './file-coordination';
/** Cache bounded, resized PNGs, never original decoded images. */
export class Thumbnails {
  private cache = new Map<string, { file: string; source: string; value: string }>();
  private pending = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private work = new PreviewWork();
  private closed = false;
  get(file: string, size: number): Promise<string> {
    if (this.closed) return Promise.resolve('');
    return this.work.track([file], (scope) => this.read(file, size, scope)).catch(() => '');
  }
  private async read(file: string, size: number, scope: PreviewScope): Promise<string> {
    const item = await entry(file);
    if (item.directory || item.kind !== 'file' || item.size > thumbnailByteLimit) return '';
    const actual = await realpath(file);
    scope.add(actual);
    const key = actual + ':' + item.identity + ':' + item.modified + ':' + size;
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing.value;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.closed) return '';
        scope.check();
        const value = await fileCoordination.run(
          [{ path: actual, mode: 'read' }],
          async (signal) => {
            signal?.throwIfAborted();
            scope.check();
            if ((await entry(fileCoordination.path(actual))).size > thumbnailByteLimit) return '';
            const image = await nativeImage.createThumbnailFromPath(fileCoordination.path(actual), {
              width: size,
              height: size,
            });
            signal?.throwIfAborted();
            scope.check();
            return image.toDataURL();
          },
        );
        if (this.closed) return '';
        scope.check();
        if (value.length > 1000000) return '';
        this.cache.set(key, { file: actual, source: file, value });
        let bytes = [...this.cache.values()].reduce((n, cached) => n + cached.value.length, 0);
        for (const [old, value] of this.cache) {
          if (this.cache.size <= 128 && bytes <= 16000000) break;
          this.cache.delete(old);
          bytes -= value.value.length;
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
  private clearKnown(root?: string): void {
    for (const [key, cached] of this.cache)
      if (!root || previewContains(root, cached.file) || previewContains(root, cached.source))
        this.cache.delete(key);
  }
  clear(root?: string): Promise<void> {
    const canonical = this.work.invalidate(root);
    this.clearKnown(root);
    return canonical.then((actual) => {
      if (actual && actual !== root) this.clearKnown(actual);
    });
  }
  async quiesce(root?: string): Promise<void> {
    await this.clear(root);
    await this.work.drain();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.work.stop();
    await this.quiesce();
  }
}
