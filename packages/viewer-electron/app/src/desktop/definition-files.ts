import { constants } from 'node:fs';
import { open, lstat, rename, type FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import type { ZodType } from 'zod';
import { applyConfigEdits, configEdits } from './configuration-edits';
import { fileCoordination } from './file-coordination';
import { missingDefinitionCode, type DefinitionDocument } from '../domain/definitions';
import { discardOwnTemporaryFile } from './removal';
import { macFiles } from './macos-files';
const revision = (text: string) => createHash('sha256').update(text).digest('hex');
/** A saved definition keeps its Finder tags, comments, extended attributes and mode. */
async function keepMetadata(file: string, output: FileHandle): Promise<void> {
  const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!input) return;
  try {
    if (process.platform === 'darwin')
      try {
        await macFiles().copyMetadata(input.fd, output.fd);
        return;
      } catch {
        // Keep at least the permissions below.
      }
    await output.chmod((await input.stat()).mode & 0o777);
  } finally {
    await input.close();
  }
}
export function decodeDefinition<T>(
  text: string,
  schema: ZodType<T>,
  title: string,
  limit = 8 * 1024 * 1024,
): T {
  if (Buffer.byteLength(text) > limit)
    throw new Error(title + ' exceeds ' + limit / 1048576 + ' MiB.');
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const [error] = errors;
  if (error)
    throw new Error(
      printParseErrorCode(error.error) +
        ' at line ' +
        text.slice(0, error.offset).split('\n').length +
        '.',
    );
  return schema.parse(value);
}
async function source(file: string, title: string, limit: number): Promise<string | null> {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(
      'Choose a regular ' + title.toLowerCase() + ' file, rather than an alias or symbolic link.',
    );
  if (info.size > limit) throw new Error(title + ' exceeds ' + limit / 1048576 + ' MiB.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (
      before.ino !== info.ino ||
      before.dev !== info.dev ||
      !before.isFile() ||
      before.size > limit
    )
      throw new Error(title + ' changed while opening. Try again.');
    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) throw new Error(title + ' changed while reading.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error(title + ' changed while reading.');
    return data.toString('utf8');
  } finally {
    await handle.close();
  }
}
/** Public JSONC definitions use explicit, coordinated CAS saves; no execution occurs on read. */
export class DefinitionFiles<T> {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(
    private schema: ZodType<T>,
    private title: string,
    private comments: string,
    private access: (files: readonly string[]) => Promise<void>,
    private coordination: Pick<typeof fileCoordination, 'run'> = fileCoordination,
    private limit = 8 * 1024 * 1024,
    /** Writes the whole file in a fixed format, instead of editing the existing text, and
     * gives new files ordinary sharing permissions. */
    private format?: { serialize(definition: T): string; mode: number },
  ) {}
  private enqueue<R>(work: () => Promise<R>): Promise<R> {
    if (this.pending >= 32)
      return Promise.reject(
        new Error('Too many pending ' + this.title.toLowerCase() + ' requests.'),
      );
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
  read(file: string): Promise<DefinitionDocument<T>> {
    return this.enqueue(async () => {
      await this.access([file]);
      return this.coordination.run([{ path: file, mode: 'read' }], async (signal) => {
        await this.access([file]);
        signal?.throwIfAborted();
        const text = await source(fileCoordination.path(file), this.title, this.limit);
        if (text === null)
          throw Object.assign(
            new Error('No ' + this.title.toLowerCase() + ' definition was found.'),
            {
              code: missingDefinitionCode,
            },
          );
        const definition = decodeDefinition(text, this.schema, this.title, this.limit);
        await this.access([file]);
        return { file, root: path.dirname(file), revision: revision(text), definition };
      });
    });
  }
  save(file: string, expected: string, input: T): Promise<DefinitionDocument<T>> {
    const definition = this.schema.parse(input);
    return this.enqueue(async () => {
      await this.access([file, path.dirname(file)]);
      return this.coordination.run([{ path: file, mode: 'write' }], async (signal) => {
        const actual = fileCoordination.path(file);
        await this.access([actual, path.dirname(actual)]);
        const before = await source(actual, this.title, this.limit);
        if ((before ? revision(before) : '') !== expected)
          throw new Error(
            'The ' +
              this.title.toLowerCase() +
              ' changed on disk. Review Reload ' +
              this.title +
              ' before saving.',
          );
        const text = this.text(before, definition);
        await this.publish(actual, before, text, signal);
        return { file, root: path.dirname(file), revision: revision(text), definition };
      });
    });
  }
  /**
   * Reads, changes and saves the file inside one coordinated write, so an edit applies to the
   * latest version even when another window or person saved in between. A file that does not
   * parse is never overwritten. `change` returns null to leave the file as it is.
   */
  update<R>(
    file: string,
    change: (current: T | null) => { definition: T; result: R } | null,
  ): Promise<{ document: DefinitionDocument<T> | null; result?: R }> {
    return this.enqueue(async () => {
      await this.access([file, path.dirname(file)]);
      return this.coordination.run([{ path: file, mode: 'write' }], async (signal) => {
        const actual = fileCoordination.path(file);
        await this.access([actual, path.dirname(actual)]);
        const before = await source(actual, this.title, this.limit);
        const current =
          before === null ? null : decodeDefinition(before, this.schema, this.title, this.limit);
        const next = change(current);
        if (!next)
          return {
            document:
              before === null || current === null
                ? null
                : {
                    file,
                    root: path.dirname(file),
                    revision: revision(before),
                    definition: current,
                  },
          };
        const definition = this.schema.parse(next.definition);
        const text = this.text(before, definition);
        if (text !== before) await this.publish(actual, before, text, signal);
        return {
          document: { file, root: path.dirname(file), revision: revision(text), definition },
          result: next.result,
        };
      });
    });
  }
  private text(before: string | null, definition: T): string {
    let text = before;
    if (this.format) text = this.format.serialize(definition);
    // item by item, so the comments beside steps and planes that did not change stay (2026-10-20)
    else if (text)
      text = applyConfigEdits(
        text,
        configEdits(decodeDefinition(text, this.schema, this.title, this.limit), definition),
        { insertSpaces: true, tabSize: 2 },
      );
    else text = this.comments + JSON.stringify(definition, null, 2) + '\n';
    decodeDefinition(text, this.schema, this.title, this.limit);
    return text;
  }
  private async publish(
    actual: string,
    before: string | null,
    text: string,
    signal: AbortSignal | undefined,
  ) {
    const temporary = actual + '.' + randomUUID() + '.tmp';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(text);
        if (before !== null) await keepMetadata(actual, handle);
        // a new project or workflow is a document like any other: it was private (0600) (2026-10-20)
        else await handle.chmod(this.format?.mode ?? 0o644);
        await handle.sync();
      } finally {
        await handle.close();
      }
      signal?.throwIfAborted();
      await this.access([actual, path.dirname(actual)]);
      if ((await source(actual, this.title, this.limit)) !== before)
        throw new Error('The ' + this.title.toLowerCase() + ' changed during this save.');
      await rename(temporary, actual);
    } finally {
      await discardOwnTemporaryFile(temporary);
    }
  }
  async flush() {
    await this.queue.catch(() => {});
  }
}
