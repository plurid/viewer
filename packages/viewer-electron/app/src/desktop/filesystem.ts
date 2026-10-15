import { lstat, stat, readlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'mime-types';
import type { FileEntry, FolderListing } from '../domain/contracts';

import { errorMessage as message } from '../domain/errors';
export { message };
export function absolute(input: string): string {
  if (!input || input.includes('\0') || !path.isAbsolute(input))
    throw new Error('An absolute local path is required.');
  return path.normalize(input);
}
export function validName(name: string): string {
  if (
    !name.trim() ||
    name === '.' ||
    name === '..' ||
    /[\0/]/.test(name) ||
    (process.platform === 'win32' && /[<>:"\\|?*]/.test(name))
  )
    throw new Error('Choose a valid file name without path separators.');
  return name;
}
export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export async function entry(file: string): Promise<FileEntry> {
  const normalized = absolute(file);
  const info = await lstat(normalized);
  let directory = info.isDirectory();
  let linkTarget: string | undefined;
  let error: string | undefined;
  if (info.isSymbolicLink()) {
    linkTarget = await readlink(normalized);
    try {
      directory = (await stat(normalized)).isDirectory();
    } catch (cause) {
      error = message(cause);
    }
  }
  const name = path.basename(normalized) || normalized;
  const extension = path.extname(name).slice(1).toLowerCase();
  return {
    path: normalized,
    name,
    parent: path.dirname(normalized),
    extension,
    directory,
    kind: info.isSymbolicLink()
      ? 'symlink'
      : info.isDirectory()
        ? 'directory'
        : info.isFile()
          ? 'file'
          : 'other',
    size: info.size,
    modified: info.mtimeMs,
    created: info.birthtimeMs,
    hidden: name.startsWith('.'),
    mime: lookup(name) || 'application/octet-stream',
    identity: `${info.dev}:${info.ino}`,
    linkTarget,
    error,
  };
}
export async function list(folder: string): Promise<FolderListing> {
  const normalized = absolute(folder);
  const names = await readdir(normalized);
  const entries: FileEntry[] = [];
  // Bound metadata fan-out, including on mounted network folders.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(24, names.length) }, async () => {
      while (cursor < names.length) {
        const name = names[cursor++];
        try {
          entries.push(await entry(path.join(normalized, name)));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            entries.push({
              path: path.join(normalized, name),
              name,
              parent: normalized,
              extension: '',
              kind: 'other',
              directory: false,
              size: 0,
              modified: 0,
              created: 0,
              hidden: name.startsWith('.'),
              mime: 'application/octet-stream',
              identity: '',
              error: message(error),
            });
        }
      }
    }),
  );
  return { path: normalized, parent: path.dirname(normalized), entries };
}
