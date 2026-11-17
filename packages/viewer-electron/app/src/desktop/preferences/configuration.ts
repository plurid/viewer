import fs from 'node:fs/promises';
import { stat } from '../files/stats';
import { watchFileChanges } from '../persistence/watch-file';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { documentConfiguration } from './configuration-comments';
import { applyConfigEdits, configEdits } from './configuration-edits';
import { discardOwnTemporaryFile } from '../operations/removal';
import { errorMessage } from '../../domain/errors';
import { syncParentDirectory } from '../persistence/directory-sync';

export interface ConfigChange {
  keys: string[];
  value: unknown;
}
export interface JsoncConfigurationOptions {
  name: string;
  schemaName: string;
  document?: (text: string, added?: Set<string>) => string;
  limit?: number;
  watchCtime?: boolean;
  objectValues?: boolean;
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
/** The properties `after` has and `before` lacks, as dotted paths. */
function addedPaths(before: unknown, after: unknown, keys: string[] = []): string[] {
  if (!plain(after)) return [];
  return Object.keys(after).flatMap((key) =>
    !plain(before) || !(key in before)
      ? [[...keys, key].join('.')]
      : addedPaths(before[key], after[key], [...keys, key]),
  );
}
export function overlaps(a: string[], b: string[]): boolean {
  return a.slice(0, Math.min(a.length, b.length)).every((key, index) => key === b[index]);
}
export class JsoncConfiguration<T> {
  readonly file: string;
  private text = '';
  private stopWatching?: () => void;
  diagnostics: string[] = [];
  changes: string[] = [];
  /** Read, then removed: the settings in effect stay, and the next write puts the file back. */
  missing = false;
  constructor(
    directory: string,
    private validate: (value: unknown, text?: string) => T,
    /** An earlier format's value as this one's; `validate` applies it too. */
    private upgrade?: (value: unknown) => unknown,
    private options: JsoncConfigurationOptions = {
      name: 'config.jsonc',
      schemaName: 'config.schema.json',
      document: documentConfiguration,
    },
  ) {
    this.file = path.join(directory, options.name);
  }
  get sourceText(): string {
    return this.text;
  }
  private document(text: string, added?: Set<string>): string {
    return this.options.document?.(text, added) ?? text;
  }
  private decode(text: string): T {
    if (Buffer.byteLength(text) > (this.options.limit ?? 16_000_000))
      throw new Error(
        this.options.name === 'config.jsonc'
          ? 'Configuration exceeds 16 MB.'
          : `${this.options.name} exceeds its size limit.`,
      );
    const errors: ParseError[] = [];
    const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    const [error] = errors;
    if (error) {
      const lines = text.slice(0, error.offset).split('\n');
      throw new Error(
        `${printParseErrorCode(error.error)} at line ${lines.length}, column ${(lines.at(-1) ?? '').length + 1}.`,
      );
    }
    return this.validate(value, text);
  }
  /**
   * A file of an earlier format, rewritten with its upgrade: only what the upgrade changes, its
   * comments kept. Left as it was, it would be upgraded again at each read, over the choices made
   * since. A file that cannot be written stays as it is, upgraded in memory.
   */
  private async upgraded(text: string): Promise<string> {
    if (!this.upgrade) return text;
    const before: unknown = parse(text, [], { allowTrailingComma: true, disallowComments: false });
    const after = this.upgrade(before);
    const edits = configEdits(before, after, [], { objectValues: this.options.objectValues });
    if (!edits.length) return text;
    try {
      const upgraded = this.document(
        applyConfigEdits(text, edits, { insertSpaces: true, tabSize: 2 }),
        new Set(addedPaths(before, after)),
      );
      this.decode(upgraded);
      await this.atomic(this.file, upgraded, text);
      return upgraded;
    } catch {
      return text;
    }
  }
  async read(): Promise<T | undefined> {
    try {
      const original = await fs.readFile(this.file, 'utf8');
      const value = this.decode(original);
      const text = await this.upgraded(original);
      const changes = this.text
        ? configChanges(this.decode(this.text), value).map((change) => change.keys.join('.'))
        : [];
      if (changes.length) this.changes = changes;
      if (text !== this.text) await this.atomic(this.file + '.last-valid', JSON.stringify(value));
      this.text = text;
      this.diagnostics = [];
      this.missing = false;
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Removed after it was read, the file is missing, not broken: the settings in effect stay,
        // and the next write puts it back from its last text, comments and all. As an error, it
        // refused every save, and the next launch started from the defaults.
        if (this.text) {
          this.missing = true;
          this.diagnostics = [];
        }
        return;
      }
      this.diagnostics = [errorMessage(error)];
      return;
    }
  }
  async recovery(): Promise<T | undefined> {
    return (await this.lastValid()).value;
  }
  /** The last valid copy: its value, nothing when there is none, or `unreadable` when it is there
   * and cannot be used. */
  async lastValid(): Promise<{ value?: T; unreadable?: true }> {
    let text: string;
    try {
      text = await fs.readFile(this.file + '.last-valid', 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      return { unreadable: true };
    }
    try {
      return { value: this.validate(JSON.parse(text)) };
    } catch {
      return { unreadable: true };
    }
  }
  /** Keeps an unreadable last valid copy under a name of its own before anything replaces it. */
  async keepUnreadableLastValid(): Promise<string> {
    const kept = `${this.file}.last-valid.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.rename(this.file + '.last-valid', kept);
    return kept;
  }
  async write(value: T): Promise<void> {
    if (this.diagnostics.length)
      throw new Error(
        `Fix ${this.options.name} before saving${this.options.name === 'config.jsonc' ? ' Settings' : ''}: ` +
          this.diagnostics[0],
      );
    let text = this.text || JSON.stringify(value, null, 2) + '\n';
    const before = this.text ? this.decode(this.text) : undefined;
    // item by item, so the comments of what did not change stay
    if (before)
      text = applyConfigEdits(
        text,
        configEdits(before, value, [], { objectValues: this.options.objectValues }),
        { insertSpaces: true, tabSize: 2 },
      );
    text = this.document(text, before ? new Set(addedPaths(before, value)) : undefined);
    this.decode(text);
    // a removed file is written back only if no editor has recreated it in the meantime
    const expected = this.missing ? '' : this.text;
    const disk = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (disk !== expected) throw this.conflict();
    await this.atomic(this.file, text, expected);
    await this.atomic(this.file + '.last-valid', JSON.stringify(value));
    this.text = text;
    this.missing = false;
  }
  private conflict(): Error {
    return new Error(`${this.options.name} changed during this edit. Validate the file and retry.`);
  }
  async update(change: (current: T | undefined) => T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const current = await this.read();
      if (this.diagnostics.length)
        throw new Error(`Fix ${this.options.name} before saving: ${this.diagnostics[0]}`);
      const next = this.validate(change(current));
      try {
        await this.write(next);
        return next;
      } catch (error) {
        if (attempt || errorMessage(error) !== this.conflict().message) throw error;
      }
    }
  }
  /**
   * Replaces config.jsonc with another configuration, its comments and all (2026-10-20: an Import
   * patched the values into the current text, dropping the imported file's comments, and was refused
   * while the current file was broken or missing). The text it replaces is kept beside it.
   */
  async replace(text: string): Promise<T> {
    const value = this.decode(text);
    // an imported guide is left as it is; an undocumented file is documented like a new one
    text = this.document(text, new Set());
    const disk = await fs.readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (disk)
      await fs.writeFile(
        `${this.file}.before-import-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        disk,
        { flag: 'wx', mode: 0o600 },
      );
    await this.atomic(this.file, text, disk);
    await this.atomic(this.file + '.last-valid', JSON.stringify(value));
    this.text = text;
    this.diagnostics = [];
    this.missing = false;
    return value;
  }
  async schema(value: unknown): Promise<void> {
    await this.atomic(
      path.join(path.dirname(this.file), this.options.schemaName),
      JSON.stringify(value, null, 2) + '\n',
    );
  }
  private async atomic(link: string, text: string, expected?: string): Promise<void> {
    // A symbolic link, for example into a dotfiles repository, stays a link: replace its target.
    let file = link;
    let linked = false;
    for (let depth = 0; ; depth++) {
      if (depth > 40) throw new Error(`Too many symbolic links for ${this.options.name}.`);
      try {
        file = await fs.realpath(file);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const target = await fs.readlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'EINVAL') return undefined;
        throw error;
      });
      if (target === undefined) break;
      linked = true;
      file = path.resolve(path.dirname(file), target);
    }
    if (linked) {
      if (!(await stat(path.dirname(file)).catch(() => null))?.isDirectory())
        throw new Error(`The folder for ${this.options.name} is missing: ${path.dirname(file)}.`);
    } else await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.' + randomUUID() + '.tmp';
    const mode = ((await stat(file).catch(() => null))?.mode ?? 0o600) & 0o777;
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
        if (current !== expected) throw this.conflict();
      }
      await fs.rename(temporary, file);
      await syncParentDirectory(file);
    } finally {
      await discardOwnTemporaryFile(temporary);
    }
  }
  watch(reload: () => void): void {
    this.stopWatching ??= watchFileChanges(this.file, reload, 500, {
      ctime: this.options.watchCtime ?? this.options.name !== 'config.jsonc',
    });
  }
  close(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }
}
