import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DocumentStore } from '../persistence/document-store';
import { assertTestRemovalAllowed } from '../operations/removal';
import { inspectReviewedFile, type ReviewedFile } from '../native/reviewed-file';
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

interface KnownRevision {
  revision: number;
  durable: boolean;
}

/**
 * Unsaved text is kept. Scratch planes and unsaved edits to files, one private document
 * per buffer in the profile's `text-buffers/`, so one buffer's write never rewrites another's. A
 * buffer is removed only when it is explicitly discarded, never because no plane refers to it: at
 * launch, a buffer no plane holds comes back as a recovered plane. An unreadable buffer file is kept
 * where it is and reported.
 */
export class TextBuffers {
  private stores = new Map<string, DocumentStore<TextBuffer>>();
  private revisions = new Map<string, KnownRevision>();
  private mutations = new Map<string, Promise<void>>();
  private retired = new Set<string>();
  private unreadable: string[] = [];
  private closed = false;
  readonly directory: string;
  constructor(
    private dataPath: string,
    private trash?: (file: ReviewedFile) => Promise<void>,
  ) {
    this.directory = path.join(dataPath, 'text-buffers');
  }
  private store(id: string) {
    z.uuid().parse(id);
    let store = this.stores.get(id);
    if (!store) {
      store = new DocumentStore(path.join(this.directory, id + '.json'), (value) => {
        const buffer = textBufferSchema.parse(value);
        if (buffer.id !== id)
          throw new Error('The draft identity does not match its saved record.');
        return buffer;
      });
      this.stores.set(id, store);
    }
    return store;
  }
  /** Writes and retirement share one queue, so a delayed write cannot recreate a discarded draft. */
  private mutate(id: string, action: () => Promise<void>): Promise<void> {
    z.uuid().parse(id);
    const work = (this.mutations.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    this.mutations.set(id, work);
    return work.finally(() => {
      if (this.mutations.get(id) === work) this.mutations.delete(id);
    });
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
      if (!z.uuid().safeParse(id).success || this.retired.has(id)) continue;
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
  async read(id: string): Promise<TextBuffer | null> {
    await this.mutations.get(id);
    if (this.retired.has(id)) return null;
    return this.store(id).load();
  }
  /** Keeps `buffer`, unless a later revision of it is already kept. */
  async write(input: TextBuffer): Promise<void> {
    if (this.closed) throw new Error('Unsaved text can no longer be kept: Viewer is closing.');
    const buffer = textBufferSchema.parse(input);
    await this.mutate(buffer.id, async () => {
      if (this.retired.has(buffer.id)) throw new Error('This draft was moved to Trash.');
      const store = this.store(buffer.id);
      const known = this.revisions.get(buffer.id) ?? {
        revision: (await store.load())?.revision ?? -1,
        durable: true,
      };
      if (buffer.revision < known.revision || (buffer.revision === known.revision && known.durable))
        return;
      // An unacknowledged revision may retry through save's recoverable queue. Older writes
      // still cannot replace it, even when publication failed after the rename.
      const pending = { revision: buffer.revision, durable: false };
      this.revisions.set(buffer.id, pending);
      await store.save(buffer);
      pending.durable = true;
    });
  }
  /** A saved or explicitly discarded draft stays recoverable in the OS Trash. */
  async discard(id: string): Promise<void> {
    await this.mutate(id, async () => {
      if (this.retired.has(id)) return;
      const store = this.store(id);
      await store.flush();
      const info = await lstat(store.file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (info) {
        const parent = await lstat(this.directory);
        if (
          parent.isSymbolicLink() ||
          !parent.isDirectory() ||
          (await realpath(this.directory)) !==
            path.join(await realpath(this.dataPath), 'text-buffers')
        )
          throw new Error('The private drafts folder changed. The draft was preserved.');
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
          throw new Error('The draft is not an ordinary private document. It was preserved.');
        const { reviewed, bytes } = await inspectReviewedFile(store.file, 16_000_000);
        if (textBufferSchema.parse(JSON.parse(bytes.toString('utf8'))).id !== id)
          throw new Error('The draft identity changed. The draft was preserved.');
        if (!this.trash) {
          assertTestRemovalAllowed(store.file);
          throw new Error('Moving drafts to Trash is unavailable. The draft was preserved.');
        }
        await this.trash(reviewed);
      }
      this.retired.add(id);
      this.revisions.delete(id);
      this.stores.delete(id);
    });
  }
  async flush(): Promise<void> {
    await Promise.all(this.mutations.values());
    await Promise.all([...this.stores.values()].map((store) => store.flush()));
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
