import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from '../persistence/document-store';
import { removePrivateData } from '../operations/removal';
import { localPath } from '../schemas';
import { message } from '../files/filesystem';
import { MAX_TEXT_BYTES, textVersionSchema } from '../../domain/editing/documents';
import type { TextBuffer, TextBufferSummary } from '../../domain/editing/documents';

export type { TextBuffer, TextBufferSummary } from '../../domain/editing/documents';

export const textBufferSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['scratch', 'file']),
    /** A file's unsaved edits: the file, and the version they were made over. */
    file: localPath.optional(),
    base: textVersionSchema.optional(),
    bom: z.boolean().optional(),
    language: z.string().max(40).optional(),
    title: z.string().max(255).optional(),
    text: z.string().refine((text) => Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES, {
      message: 'Viewer keeps unsaved text up to 4 MiB.',
    }),
    revision: z.number().int().nonnegative(),
    updated: z.number().finite(),
  })
  .strict();

/**
 * UNSAVED TEXT IS KEPT (2026-10-23). Scratch planes and unsaved edits to files, one private document
 * per buffer in the profile's `text-buffers/`, so one buffer's write never rewrites another's. A
 * buffer is removed only when it is explicitly discarded, never because no plane refers to it: at
 * launch, a buffer no plane holds comes back as a recovered plane. An unreadable buffer file is kept
 * where it is and reported.
 */
export class TextBuffers {
  private stores = new Map<string, DocumentStore<TextBuffer>>();
  private revisions = new Map<string, number>();
  private unreadable: string[] = [];
  private closed = false;
  readonly directory: string;
  constructor(private dataPath: string) {
    this.directory = path.join(dataPath, 'text-buffers');
  }
  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(path.join(this.directory, id + '.json'), (value) =>
        textBufferSchema.parse(value),
      );
      this.stores.set(id, store);
    }
    return store;
  }
  /** Every kept buffer, without its text. */
  async list(): Promise<TextBufferSummary[]> {
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
    this.unreadable = [];
    const summaries: TextBufferSummary[] = [];
    for (const name of names.sort()) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
      if (!z.uuid().safeParse(id).success) continue;
      try {
        const buffer = await this.store(id).load();
        if (!buffer) continue;
        const { text, base: _base, bom: _bom, revision: _revision, ...summary } = buffer;
        summaries.push({ ...summary, bytes: Buffer.byteLength(text, 'utf8') });
      } catch (error) {
        this.unreadable.push(
          `Unsaved text in ${path.join(this.directory, name)} could not be read, so it was kept there: ${message(error)}`,
        );
      }
    }
    return summaries;
  }
  /** What the last listing could not read, each kept where it is. */
  problems(): string[] {
    return [...this.unreadable];
  }
  read(id: string): Promise<TextBuffer | null> {
    return this.store(id).load();
  }
  /** Keeps `buffer`, unless a later revision of it is already kept. */
  async write(input: TextBuffer): Promise<void> {
    if (this.closed) throw new Error('Unsaved text can no longer be kept: Viewer is closing.');
    const buffer = textBufferSchema.parse(input);
    const store = this.store(buffer.id);
    const known = this.revisions.get(buffer.id) ?? (await store.load().catch(() => null))?.revision;
    if (known !== undefined && buffer.revision <= known) return;
    this.revisions.set(buffer.id, buffer.revision);
    await store.save(buffer);
  }
  /** Removes a buffer the person chose to discard, from Viewer's private data only. */
  async discard(id: string): Promise<void> {
    const store = this.store(id);
    await store.flush().catch(() => {});
    await removePrivateData(this.dataPath, store.file);
    this.revisions.delete(id);
    this.stores.delete(id);
  }
  async flush(): Promise<void> {
    await Promise.all([...this.stores.values()].map((store) => store.flush().catch(() => {})));
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
