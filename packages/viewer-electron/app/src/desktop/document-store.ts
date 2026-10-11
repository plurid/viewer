import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
      const text = await readFile(this.file, 'utf8');
      if (text.length > 16000000) throw new Error('Application metadata exceeds its limit.');
      return this.validate(JSON.parse(text));
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
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writes = task;
    return task;
  }
  flush(): Promise<void> {
    return this.writes;
  }
}
