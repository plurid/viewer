import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { z } from 'zod';
import type { TrashOrigin } from '../../domain/files/trash';
import { readItemIdentity, readTemporalIdentity } from '../../domain/files/item-identity';
import { DocumentStore } from '../persistence/document-store';
import { lstat } from '../files/stats';

/** The most Trash original locations kept across history rollovers; the oldest give way first. */
export const trashOriginLimit = 5000;
/** Hard ceiling on the serialized private store size. */
export const trashOriginMaxBytes = 8 * 1024 * 1024;
export const trashOriginFileName = 'trash-origins-v1.json';

const localFilePath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));

const originSchema = z
  .object({
    file: localFilePath,
    originalPath: localFilePath,
    identity: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          readTemporalIdentity(value) !== undefined || readItemIdentity(value) !== undefined,
      ),
    modified: z.number().finite().optional(),
    size: z.number().finite().nonnegative().optional(),
  })
  .strict();

const documentSchema = z
  .object({
    version: z.literal(1),
    origins: z.array(originSchema).max(trashOriginLimit),
  })
  .strict();

type TrashOriginsDocument = z.infer<typeof documentSchema>;

const originKey = (file: string) => file.normalize('NFC');

/**
 * Private bounded store of original locations for items Viewer moved to the Trash.
 * Kept separate from the 100-job operation history so Put Back still works after later
 * jobs roll out of memory, never written to editable config.jsonc or personal backups.
 */
export class TrashOrigins {
  readonly store?: DocumentStore<TrashOriginsDocument>;
  private origins: TrashOrigin[] = [];
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  /** True when a newer-format or unmovable unreadable file stays protected in place. */
  private retained = false;

  constructor(
    dataPath?: string,
    private notice: (message: string) => void = () => {},
  ) {
    if (dataPath) {
      this.store = new DocumentStore(
        path.join(dataPath, trashOriginFileName),
        (value) => documentSchema.parse(value),
        trashOriginMaxBytes,
      );
    }
  }

  load(): Promise<void> {
    return (this.loaded ??= this.loadOnce());
  }

  private async loadOnce(): Promise<void> {
    if (!this.store) return;
    try {
      const value = await this.store.load();
      if (value) this.origins = value.origins;
    } catch {
      await this.recoverUnreadable(this.store.file);
    }
  }

  private async recoverUnreadable(file: string): Promise<void> {
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      return null;
    });
    if (info === undefined) return;
    if (!info || !info.isFile() || info.isSymbolicLink()) {
      this.retained = true;
      this.notice(
        `Trash original locations couldn’t be read or kept aside, so Viewer left ${file} unchanged. Older trashed items may need Put Back To….`,
      );
      return;
    }
    if (info.size <= trashOriginMaxBytes) {
      const parsed = await readFile(file, 'utf8')
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => undefined);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'version' in parsed &&
        typeof parsed.version === 'number' &&
        parsed.version > 1
      ) {
        this.retained = true;
        this.notice(
          'Trash original locations were saved by a newer Viewer and were left unchanged. Older trashed items may need Put Back To….',
        );
        return;
      }
    }
    const kept = `${file}.unreadable-${randomUUID()}`;
    try {
      await rename(file, kept);
      this.notice(
        `Trash original locations couldn’t be read, so Viewer kept the file at ${kept}. Older trashed items may need Put Back To….`,
      );
    } catch {
      this.retained = true;
      this.notice(
        `Trash original locations couldn’t be read or kept aside, so Viewer left ${file} unchanged. Older trashed items may need Put Back To….`,
      );
    }
  }

  async list(): Promise<TrashOrigin[]> {
    await this.queue.catch(() => {});
    await this.load();
    return this.origins.map((origin) => ({ ...origin }));
  }

  record(entries: readonly TrashOrigin[]): Promise<void> {
    if (!entries.length) return Promise.resolve();
    const parsed = entries.map((entry) => originSchema.parse(entry));
    return this.mutate((current) => {
      const incoming = new Set(parsed.map((entry) => originKey(entry.file)));
      const next = [
        ...current.filter((entry) => !incoming.has(originKey(entry.file))),
        ...parsed,
      ].slice(-trashOriginLimit);
      let bytes = Buffer.byteLength(JSON.stringify({ version: 1, origins: next }), 'utf8');
      while (next.length > 1 && bytes > trashOriginMaxBytes) {
        const removed = next.shift()!;
        bytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8') + 1;
      }
      return next;
    });
  }

  remove(files: readonly string[]): Promise<void> {
    if (!files.length) return Promise.resolve();
    const targets = new Set(files.map(originKey));
    return this.mutate((current) => {
      const next = current.filter((entry) => !targets.has(originKey(entry.file)));
      return next.length === current.length ? undefined : next;
    });
  }

  private mutate(
    compute: (current: readonly TrashOrigin[]) => TrashOrigin[] | undefined,
  ): Promise<void> {
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        const next = compute(this.origins);
        if (!next) return;
        if (this.store && !this.retained) {
          await this.store.save({ version: 1, origins: next });
        }
        this.origins = next;
      });
    this.queue = work;
    return work;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => {});
    await this.store?.flush().catch(() => {});
  }
}
