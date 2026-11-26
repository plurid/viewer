import { mkdir, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { discardOwnTemporaryFile } from '../operations/removal';
import {
  coordinateMetadata,
  publishMetadata,
  requireNoInterruptedPublication,
} from './metadata-publication';
import { syncParentDirectory } from './directory-sync';
/** Publishes complete application-owned documents. Revision-bound writers retain displaced
 * bytes until the replacement directory entry is durable. */
export class DocumentStore<T> {
  private writes: Promise<void> = Promise.resolve();
  constructor(
    readonly file: string,
    private validate: (value: unknown) => T,
    private maxBytes = 16000000,
  ) {}
  async load(): Promise<T | null> {
    await this.writes.catch(() => undefined);
    const bytes = await this.readBytes();
    return bytes && this.validate(JSON.parse(bytes.toString('utf8')));
  }
  async loadSnapshot(): Promise<{ value: T | null; revision: string | null }> {
    await this.writes.catch(() => undefined);
    return coordinateMetadata(path.dirname(this.file), async () => {
      const bytes = await this.readBytes();
      if (!bytes) return { value: null, revision: null };
      return {
        value: this.validate(JSON.parse(bytes.toString('utf8'))),
        revision: createHash('sha256').update(bytes).digest('hex'),
      };
    });
  }
  private async readBytes(): Promise<Buffer | null> {
    try {
      const handle = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > this.maxBytes)
          throw new Error('Application metadata exceeds its limit or is not a regular file.');
        const buffer = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) throw new Error('Application metadata changed while reading.');
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.ctimeMs !== after.ctimeMs ||
          before.mtimeMs !== after.mtimeMs
        )
          throw new Error('Application metadata changed while reading.');
        return buffer;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await requireNoInterruptedPublication(this.file);
        return null;
      }
      throw error;
    }
  }
  save(input: T, expected?: string | null, published?: (revision: string) => void): Promise<void> {
    const text = JSON.stringify(this.validate(input));
    if (Buffer.byteLength(text, 'utf8') > this.maxBytes)
      throw new Error('Application metadata exceeds its limit.');
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const temporary = this.file + '.' + randomUUID() + '.tmp';
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(text);
            await handle.sync();
          } finally {
            await handle.close();
          }
          if (expected === undefined) {
            await rename(temporary, this.file);
            published?.(createHash('sha256').update(text).digest('hex'));
            await syncParentDirectory(this.file);
          } else {
            await coordinateMetadata(path.dirname(this.file), () =>
              publishMetadata(this.file, temporary, expected, this.maxBytes, () =>
                published?.(createHash('sha256').update(text).digest('hex')),
              ),
            );
          }
        } finally {
          await discardOwnTemporaryFile(temporary);
        }
      });
    this.writes = task;
    return task;
  }
  flush(): Promise<void> {
    return this.writes;
  }
}
