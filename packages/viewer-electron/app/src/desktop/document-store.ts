import { mkdir, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { discardOwnTemporaryFile } from './removal';
/** Writes application-owned metadata only. Failed writes leave the old document intact. */
export class DocumentStore<T> {
  private writes: Promise<void> = Promise.resolve();
  constructor(
    readonly file: string,
    private validate: (value: unknown) => T,
  ) {}
  async load(): Promise<T | null> {
    await this.writes;
    try {
      const handle = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > 16000000)
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
        return this.validate(JSON.parse(buffer.toString('utf8')));
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  save(input: T): Promise<void> {
    const text = JSON.stringify(this.validate(input));
    if (Buffer.byteLength(text, 'utf8') > 16000000)
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
          await rename(temporary, this.file);
          // The journal's directory entry must be durable before a queued file
          // mutation begins. Syncing only the temporary file is insufficient
          // for a crash immediately after its atomic rename.
          if (process.platform !== 'win32') {
            const directory = await open(
              path.dirname(this.file),
              constants.O_RDONLY | (constants.O_DIRECTORY || 0),
            );
            try {
              await directory.sync();
            } finally {
              await directory.close();
            }
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
