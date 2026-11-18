import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { z } from 'zod';
import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
import { DocumentStore } from '../persistence/document-store';
import { lstat } from '../files/stats';

/** The most dismissed roots kept; the oldest give way first. */
export const offerDismissalLimit = 500;
/** The longest root a dismissal keeps, as the IPC accepts it. */
export const offerRootLength = 4096;
const root = z
  .string()
  .min(1)
  .max(offerRootLength)
  .refine((value) => value.startsWith('/') && !value.includes('\0'));
const documentSchema = z
  .object({
    version: z.literal(1),
    dismissed: z.array(root).max(offerDismissalLimit),
  })
  .strict();
type OfferDismissalDocument = z.infer<typeof documentSchema>;

/**
 * The definition roots whose workspace offer the person dismissed, latest last. They name the
 * person's projects, found ones included, so they live in this private file, never in config.jsonc:
 * configuration reads, exports, backups and agents never see them. Viewer's own moves carry its
 * roots. Nothing is written until something is dismissed. A change takes effect only once it is
 * saved, so what the card shows is what the next launch reads; an unreadable file is moved aside
 * on the person's next change.
 */
export class OfferDismissals {
  readonly store: DocumentStore<OfferDismissalDocument>;
  private dismissed: string[] = [];
  private loading?: Promise<void>;
  private written = false;
  private unreadable = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(directory: string) {
    this.store = new DocumentStore(
      path.join(directory, 'workspace-offers-v1.json'),
      (value) => documentSchema.parse(value),
      // the most roots at the longest path, with room for the JSON around them
      offerDismissalLimit * (offerRootLength + 8),
    );
  }
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      try {
        const value = await this.store.load();
        if (value) {
          this.dismissed = value.dismissed;
          this.written = true;
        }
      } catch {
        this.unreadable = true;
      }
    })());
  }
  roots(): readonly string[] {
    return this.dismissed;
  }
  /** Adds roots, latest last. False when nothing changed. */
  dismiss(roots: readonly string[]): Promise<boolean> {
    return this.change((current) => {
      const added = new Set(roots);
      return [...current.filter((item) => !added.has(item)), ...added].slice(-offerDismissalLimit);
    });
  }
  /** Removes the roots `keep` refuses, and gives them, so Clear's Undo can put them back. */
  async clear(keep: (root: string) => boolean = () => false): Promise<string[]> {
    let removed: string[] = [];
    await this.change((current) => {
      removed = current.filter((item) => !keep(item));
      return current.filter(keep);
    });
    return removed;
  }
  /** Viewer's own moves and renames carry the roots they touch. */
  remap(changes: readonly FileChange[]): Promise<boolean> {
    const map = pathMapper(changes);
    return this.change((current) => [...new Set(current.map(map))]);
  }
  /**
   * One change at a time, from what is saved. The list changes only once the file holds it, so a
   * failed write leaves it as it was and the caller hears why.
   */
  private change(next: (current: readonly string[]) => string[]): Promise<boolean> {
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        const value = next(this.dismissed);
        if (
          value.length === this.dismissed.length &&
          value.every((item, index) => item === this.dismissed[index])
        )
          return false;
        if (this.written || value.length || this.unreadable) {
          // validated before anything moves: an unwritable root changes nothing
          documentSchema.parse({ version: 1, dismissed: value });
          await this.keepUnreadableAside();
          await this.store.save({ version: 1, dismissed: value });
          this.written = true;
        }
        this.dismissed = value;
        return true;
      });
    this.queue = work;
    return work;
  }
  /** A file Viewer could not read is kept beside, never overwritten, for recovery. */
  private async keepUnreadableAside(): Promise<void> {
    if (!this.unreadable) return;
    const kind = await lstat(this.store.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (kind && !kind.isFile())
      throw new Error('Dismissed workspace offers could not be saved: their file is not a file.');
    if (kind) await rename(this.store.file, this.store.file + '.unreadable-' + randomUUID());
    this.unreadable = false;
  }
  async close(): Promise<void> {
    await this.queue.catch(() => {});
    await this.store.flush().catch(() => {});
  }
}
