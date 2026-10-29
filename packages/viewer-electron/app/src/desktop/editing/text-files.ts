import { constants } from 'node:fs';
import { access as permitted, lstat, open, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  MAX_TEXT_BYTES,
  sameTextVersion,
  textChangedCode,
  type TextOpening,
  type TextVersion,
} from '../../domain/editing/documents';
import { fileCoordination } from '../files/file-coordination';
import { keepMetadata } from '../files/file-metadata';
import { discardOwnTemporaryFile } from '../operations/removal';
import type { Operations } from '../operations/operations';
import { errorMessage } from '../../domain/errors';

/** Why a file is not edited where it is: shown beside the preview, never as a failure. */
class NotEditable extends Error {}
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const BOM = '﻿';
const changed = () =>
  Object.assign(
    new Error('The file changed on disk since it was opened. Reload it, or save over it.'),
    { code: textChangedCode },
  );

/**
 * A text file's whole contents and version, from one handle: its date and size before and after the
 * read must agree, so the hash is of the version the date and size name. Only text a save writes
 * back unchanged is accepted: valid UTF-8 with no NUL, from a file with no other hard link.
 */
export async function readText(file: string): Promise<{ text: string; version: TextVersion }> {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ELOOP')
      throw new NotEditable('This is a symbolic link. Edit the file it points to.');
    throw error;
  });
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new NotEditable('Only regular files can be edited.');
    if (before.size > MAX_TEXT_BYTES)
      throw new NotEditable(
        'Viewer edits text files up to 4 MiB. Open larger ones in another app.',
      );
    // A save puts a new file in its place, which would separate it from its other names.
    if (before.nlink > 1)
      throw new NotEditable(
        'This file has another hard link, which a save would separate from it.',
      );
    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) throw changed();
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw changed();
    let text: string;
    try {
      // fatal: a byte that is not UTF-8 would be saved back as U+FFFD
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      throw new NotEditable('Viewer edits UTF-8 text. This file uses another encoding.');
    }
    if (text.includes('\0')) throw new NotEditable('Viewer edits UTF-8 text. This file is binary.');
    return {
      text,
      version: {
        identity: `${after.dev}:${after.ino}`,
        modified: after.mtimeMs,
        size: after.size,
        sha256: sha256(data),
      },
    };
  } finally {
    await handle.close();
  }
}

/**
 * Editing text files. Opens previewed text for editing and saves it. The first save of an
 * editor session goes through the operation queue, which sends the version it replaces to the Trash
 * with an Undo step; later saves of that session overwrite their own. What a session wrote is held
 * here only, in memory, so after a relaunch or a new editor session the first save trashes again.
 * Every save is checked against the version its editor read.
 */
export class TextFiles {
  /** Per file, the editor session that last saved it and the hash of what it wrote. */
  private own = new Map<string, { session: string; sha256: string }>();
  constructor(
    private operations: Pick<Operations, 'writeText' | 'exclusive'>,
    private access: (files: readonly string[]) => Promise<void>,
  ) {}
  async open(file: string): Promise<TextOpening> {
    const folder = path.dirname(file);
    try {
      await this.access([file]);
      if ((await lstat(file)).isSymbolicLink())
        throw new NotEditable('This is a symbolic link. Edit the file it points to.');
      try {
        await this.access([folder]);
      } catch (error) {
        if ((error as { code?: string }).code !== 'FILE_ACCESS_REQUIRED') throw error;
        return {
          editable: false,
          reason: 'Allow access to its folder to save edits beside it.',
          folder,
        };
      }
      await permitted(file, constants.W_OK).catch(() => {
        throw new NotEditable('This file is read-only.');
      });
      await permitted(folder, constants.W_OK).catch(() => {
        throw new NotEditable('Its folder is read-only, so a save cannot be written beside it.');
      });
      const read = await fileCoordination.run([{ path: file, mode: 'read' }], async (signal) => {
        signal?.throwIfAborted();
        const actual = fileCoordination.path(file);
        await this.access([actual]);
        return readText(actual);
      });
      const bom = read.text.startsWith(BOM);
      return {
        editable: true,
        document: { file, text: bom ? read.text.slice(1) : read.text, bom, version: read.version },
      };
    } catch (error) {
      if (error instanceof NotEditable) return { editable: false, reason: error.message };
      return { editable: false, reason: errorMessage(error) };
    }
  }
  /** Saves over the version `expected` names, as editor `session`; resolves with the new version. */
  async save(
    file: string,
    text: string,
    expected: TextVersion,
    session: string,
    bom: boolean,
  ): Promise<TextVersion> {
    const data = Buffer.from((bom ? BOM : '') + text, 'utf8');
    const own = this.own.get(file);
    const version =
      own?.session === session && own.sha256 === expected.sha256
        ? await this.overwrite(file, data, expected)
        : await this.replace(file, data, expected);
    this.own.set(file, { session, sha256: version.sha256 });
    return version;
  }
  /** A new file holding `text`, created exclusively (Save As); Undo moves it to the Trash. */
  async create(file: string, text: string, session: string): Promise<TextVersion> {
    const data = Buffer.from(text, 'utf8');
    await this.operations.writeText(file, data.toString('utf8'));
    const version = await this.written(file, data);
    this.own.set(file, { session, sha256: version.sha256 });
    return version;
  }
  /**
   * Save As: a new file, or the one chosen in the save panel, which its Replace confirmed. That file
   * goes to the Trash, as a save's replaced version does, whatever it holds.
   */
  async saveAs(file: string, text: string, session: string): Promise<TextVersion> {
    const existing = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!existing) return this.create(file, text, session);
    const data = Buffer.from(text, 'utf8');
    await this.operations.writeText(file, text, {
      version: {
        identity: `${existing.dev}:${existing.ino}`,
        modified: existing.mtimeMs,
        size: existing.size,
      },
    });
    const version = await this.written(file, data);
    this.own.set(file, { session, sha256: version.sha256 });
    return version;
  }
  /** An editor closed: its saves are no longer its own to overwrite. */
  end(session: string): void {
    for (const [file, own] of this.own) if (own.session === session) this.own.delete(file);
  }
  private async replace(file: string, data: Buffer, expected: TextVersion): Promise<TextVersion> {
    const { sha256: hash, ...version } = expected;
    await this.operations.writeText(file, data.toString('utf8'), { version, sha256: hash });
    return this.written(file, data);
  }
  /** Replaces the session's own last save, atomically and with its metadata, if it is still there. */
  private overwrite(file: string, data: Buffer, expected: TextVersion): Promise<TextVersion> {
    if (data.length > MAX_TEXT_BYTES)
      return Promise.reject(
        new Error('Text over 4 MiB is saved from another app; Viewer edits up to 4 MiB.'),
      );
    return this.operations.exclusive(
      () =>
        fileCoordination.run([{ path: file, mode: 'write' }], async (signal) => {
          const actual = fileCoordination.path(file);
          const folder = path.dirname(actual);
          await this.access([actual, folder]);
          const current = async () => {
            const read = await readText(actual).catch((error: unknown) => {
              throw error instanceof NotEditable ? changed() : error;
            });
            if (!sameTextVersion(read.version, expected)) throw changed();
          };
          await current();
          const temporary = path.join(
            folder,
            '.' + path.basename(actual) + '.' + randomUUID() + '.viewer-save',
          );
          try {
            const output = await open(temporary, 'wx', 0o600);
            try {
              await output.writeFile(data);
              await keepMetadata(actual, output);
              await output.sync();
            } finally {
              await output.close();
            }
            signal?.throwIfAborted();
            await current();
            await rename(temporary, actual);
          } finally {
            await discardOwnTemporaryFile(temporary);
          }
          return this.written(actual, data);
        }),
      () => [file],
    );
  }
  /** The version of what was just written: its item now, and the hash of the bytes written. */
  private async written(file: string, data: Buffer): Promise<TextVersion> {
    const info = await lstat(file);
    return {
      identity: `${info.dev}:${info.ino}`,
      modified: info.mtimeMs,
      size: info.size,
      sha256: sha256(data),
    };
  }
}
