import fs from 'node:fs/promises';
import { watchFile, unwatchFile, type Stats } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { documentConfiguration } from './configuration-comments';
import { discardOwnTemporaryFile } from './removal';
import { errorMessage } from '../domain/errors';

export interface ConfigChange {
  keys: string[];
  value: unknown;
}
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function configChanges(
  before: unknown,
  after: unknown,
  keys: string[] = [],
): ConfigChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (plain(before) && plain(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      configChanges(before[key], after[key], [...keys, key]),
    );
  return [{ keys, value: after }];
}
export function overlaps(a: string[], b: string[]): boolean {
  return a.slice(0, Math.min(a.length, b.length)).every((key, index) => key === b[index]);
}
export class JsoncConfiguration<T> {
  readonly file: string;
  private text = '';
  private listener?: (current: Stats, previous: Stats) => void;
  diagnostics: string[] = [];
  changes: string[] = [];
  constructor(
    directory: string,
    private validate: (value: unknown) => T,
  ) {
    this.file = path.join(directory, 'config.jsonc');
  }
  private decode(text: string): T {
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Configuration exceeds 16 MB.');
    const errors: ParseError[] = [];
    const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    const [error] = errors;
    if (error) {
      const lines = text.slice(0, error.offset).split('\n');
      throw new Error(
        `${printParseErrorCode(error.error)} at line ${lines.length}, column ${(lines.at(-1) ?? '').length + 1}.`,
      );
    }
    return this.validate(value);
  }
  async read(): Promise<T | undefined> {
    try {
      const text = await fs.readFile(this.file, 'utf8');
      const value = this.decode(text);
      const changes = this.text
        ? configChanges(this.decode(this.text), value).map((change) => change.keys.join('.'))
        : [];
      if (changes.length) this.changes = changes;
      if (text !== this.text) await this.atomic(this.file + '.last-valid', JSON.stringify(value));
      this.text = text;
      this.diagnostics = [];
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.text) return;
      this.diagnostics = [errorMessage(error)];
      return;
    }
  }
  async recovery(): Promise<T | undefined> {
    try {
      return this.validate(JSON.parse(await fs.readFile(this.file + '.last-valid', 'utf8')));
    } catch {
      return;
    }
  }
  async write(value: T): Promise<void> {
    if (this.diagnostics.length)
      throw new Error('Fix config.jsonc before saving Settings: ' + this.diagnostics[0]);
    let text = this.text || JSON.stringify(value, null, 2) + '\n';
    if (this.text) {
      for (const change of configChanges(this.decode(this.text), value))
        text = applyEdits(
          text,
          modify(text, change.keys, change.value, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          }),
        );
    }
    text = documentConfiguration(text);
    this.decode(text);
    const disk = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (disk !== this.text)
      throw new Error('config.jsonc changed during this edit. Validate the file and retry.');
    await this.atomic(this.file, text, this.text);
    await this.atomic(this.file + '.last-valid', JSON.stringify(value));
    this.text = text;
  }
  async schema(value: unknown): Promise<void> {
    await this.atomic(
      path.join(path.dirname(this.file), 'config.schema.json'),
      JSON.stringify(value, null, 2) + '\n',
    );
  }
  private async atomic(link: string, text: string, expected?: string): Promise<void> {
    // A symbolic link, for example into a dotfiles repository, stays a link: replace its target.
    const file = await fs.realpath(link).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return link;
      throw error;
    });
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.' + randomUUID() + '.tmp';
    const mode = ((await fs.stat(file).catch(() => null))?.mode ?? 0o600) & 0o777;
    try {
      const handle = await fs.open(temporary, 'wx', mode);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (expected !== undefined) {
        const current = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
        if (current !== expected)
          throw new Error('config.jsonc changed during this edit. Validate the file and retry.');
      }
      await fs.rename(temporary, file);
    } finally {
      await discardOwnTemporaryFile(temporary);
    }
  }
  watch(reload: () => void): void {
    if (this.listener) return;
    this.listener = (current, previous) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.ino !== previous.ino ||
        current.size !== previous.size
      )
        reload();
    };
    watchFile(this.file, { persistent: false, interval: 500 }, this.listener);
  }
  close(): void {
    if (this.listener) unwatchFile(this.file, this.listener);
    this.listener = undefined;
  }
}
