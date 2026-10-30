import path from 'node:path';
import { entry } from '../files/filesystem';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import { extractDocument } from './formats';
import { previewContains } from './preview-work';
import type { DocumentData } from '../../domain/services';
import { worksheetPageSchema, type WorksheetWindow } from '../../domain/previews/documents/office';

interface Pending {
  file: string;
  work: Promise<DocumentData>;
  abort: AbortController;
  consumers: number;
}
/** Shared derived data, never authority: callers authorize the source before and after.
 * Cancelling one view does not cancel another consumer of the same source version. */
export class DocumentCache {
  private saved = new Map<string, { file: string; value: DocumentData; size: number }>();
  private loading = new Map<string, Pending>();
  private size = 0;
  constructor(
    private decode = extractDocument,
    private inspect = entry,
  ) {}

  async read(
    file: string,
    pages?: number,
    signal?: AbortSignal,
    requested?: WorksheetWindow,
    format = path.extname(file).slice(1).toLowerCase(),
    message?: number,
  ): Promise<DocumentData> {
    signal?.throwIfAborted();
    const worksheet = requested ? worksheetPageSchema.parse(requested) : undefined;
    const info = await this.inspect(file);
    signal?.throwIfAborted();
    const key = JSON.stringify([
      file,
      sourceVersion(info),
      pages ?? null,
      worksheet ?? null,
      format,
      message ?? null,
    ]);
    const cached = this.saved.get(key);
    if (cached) {
      this.saved.delete(key);
      this.saved.set(key, cached);
      return cached.value;
    }
    let pending = this.loading.get(key);
    if (pending?.abort.signal.aborted) pending = undefined;
    if (!pending) {
      if (this.loading.size >= 16)
        throw new Error('Too many documents are opening. Close a preview and try again.');
      const abort = new AbortController();
      const item: Pending = {
        file,
        abort,
        consumers: 0,
        work: Promise.resolve(undefined as never),
      };
      item.work = Promise.resolve()
        .then(async () => {
          abort.signal.throwIfAborted();
          const value = await this.decode(file, {
            pages,
            worksheet,
            signal: abort.signal,
            format,
            message,
          });
          if (!sameSourceVersion(sourceVersion(info), sourceVersion(await this.inspect(file))))
            throw new Error('The document changed while being read. Open it again.');
          abort.signal.throwIfAborted();
          const size = JSON.stringify(value).length * 2;
          if (size <= 32_000_000) {
            this.saved.set(key, { file, value, size });
            this.size += size;
            while (this.saved.size > 8 || this.size > 32_000_000) {
              const oldest = this.saved.keys().next().value!;
              this.size -= this.saved.get(oldest)!.size;
              this.saved.delete(oldest);
            }
          }
          return value;
        })
        .finally(() => {
          if (this.loading.get(key) === item) this.loading.delete(key);
        });
      this.loading.set(key, item);
      pending = item;
    }
    const item = pending;
    item.consumers++;
    return new Promise<DocumentData>((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, value?: DocumentData) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', cancel);
        item.consumers--;
        if (!item.consumers) item.abort.abort();
        if (error) reject(error);
        else resolve(value!);
      };
      const cancel = () => finish(signal?.reason ?? new Error('Document preview cancelled.'));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      item.work.then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
    });
  }
  invalidate(root?: string): void {
    for (const [key, item] of this.saved)
      if (!root || previewContains(root, item.file)) {
        this.saved.delete(key);
        this.size -= item.size;
      }
    for (const item of this.loading.values())
      if (!root || previewContains(root, item.file)) item.abort.abort();
  }
}
