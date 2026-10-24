import { z } from 'zod';
import { lstat } from 'node:fs/promises';
import { absolute } from './filesystem';
import { macFiles } from '../native/macos-files';
import { fileCoordination } from './file-coordination';
import type { FileInformation, FileInformationPatch } from '../../domain/files/information';

export const informationPatchSchema = z
  .object({
    tags: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(80)
              .refine((name) => !/[\u0000-\u001f\u007f]/.test(name)),
            color: z.number().int().min(0).max(7),
          })
          .strict(),
      )
      .max(64)
      .refine(
        (tags) => new Set(tags.map((tag) => tag.name.normalize('NFC'))).size === tags.length,
        'Each tag must have a different name.',
      )
      .optional(),
    comment: z
      .string()
      .max(8192)
      .refine((value) => !value.includes('\0'))
      .optional(),
    locked: z.boolean().optional(),
    mode: z.number().int().min(0).max(0o777).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No changes to save.');

/** One bounded metadata request at a time. The captured revision prevents stale
 * editors from replacing Finder changes. Coordination does not confer access. */
export class FileInformationService {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  constructor(
    private access: (files: readonly string[]) => Promise<void>,
    private changed: (file: string) => void,
    private native = macFiles,
  ) {}
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('File information has closed.'));
    if (this.pending >= 32)
      return Promise.reject(new Error('Too many file information requests. Try again.'));
    this.pending++;
    const task = this.queue
      .catch(() => {})
      .then(work)
      .finally(() => {
        this.pending--;
      });
    this.queue = task;
    return task;
  }
  private async check(file: string) {
    await this.access([file]);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error('Open the original item to edit its information.');
    if (!info.isFile() && !info.isDirectory())
      throw new Error('File information is available for files and folders.');
  }
  get(input: string): Promise<FileInformation> {
    const file = absolute(input);
    return this.enqueue(async () => {
      await this.check(file);
      return fileCoordination.run([{ path: file, mode: 'metadata' }], async (signal) => {
        signal?.throwIfAborted();
        const actual = fileCoordination.path(file);
        await this.check(actual);
        const value = JSON.parse(await this.native().information(actual)) as FileInformation;
        await this.access([actual]);
        return value;
      });
    });
  }
  update(
    input: string,
    revision: string,
    inputPatch: FileInformationPatch,
  ): Promise<FileInformation> {
    const file = absolute(input),
      patch = informationPatchSchema.parse(inputPatch);
    if (Buffer.byteLength(JSON.stringify(patch), 'utf8') > 32768)
      throw new Error(
        'These metadata changes are too large. Save fewer tags or a shorter comment.',
      );
    if (!revision || revision.length > 200)
      throw new Error('Reload file information before saving.');
    return this.enqueue(async () => {
      await this.check(file);
      return fileCoordination.run([{ path: file, mode: 'write' }], async (signal) => {
        signal?.throwIfAborted();
        const actual = fileCoordination.path(file);
        await this.check(actual);
        signal?.throwIfAborted();
        const value = JSON.parse(
          await this.native().updateInformation(actual, revision, JSON.stringify(patch)),
        ) as FileInformation;
        this.changed(actual);
        return value;
      });
    });
  }
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
  }
}
