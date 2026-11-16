import { lstat, stat } from './stats';
import { itemIdentity } from '../../domain/files/item-identity';
import { readlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'mime-types';
import type { FileEntry, FolderListing } from '../../domain/contracts';

import { errorMessage } from '../../domain/errors';
import type { FileVisibility } from './visibility';
import { fileVisibility } from './visibility';
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
  return entryWithVisibility(file, fileVisibility);
}
/** A scan supplies its folder's flags in bulk instead of asking the helper for every item. */
export async function entryForScan(file: string): Promise<FileEntry> {
  return entryWithVisibility(file, fileVisibility, false);
}
export async function entryWithVisibility(
  file: string,
  visibility: FileVisibility,
  knownHidden?: boolean,
): Promise<FileEntry> {
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
      error = errorMessage(cause);
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
    hidden:
      name.startsWith('.') ||
      (knownHidden ?? (await visibility.fileHidden(normalized).catch(() => false))),
    mime: lookup(name) || 'application/octet-stream',
    identity: itemIdentity(info),
    linkTarget,
    error,
  };
}
export async function list(
  folder: string,
  visibility: FileVisibility = fileVisibility,
): Promise<FolderListing> {
  const normalized = absolute(folder);
  let hidden = new Set<string>();
  const entries: FileEntry[] = [];
  // Native bulk attributes overlap the existing metadata work instead of delaying its start.
  await Promise.all([
    visibility
      .hiddenEntries(normalized)
      .then((names) => {
        hidden = new Set(names);
      })
      .catch(() => {}),
    (async () => {
      const names = await readdir(normalized);
      // Bound metadata fan-out, including on mounted network folders.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(24, names.length) }, async () => {
          while (cursor < names.length) {
            const name = names[cursor++];
            if (name === undefined) break;
            try {
              entries.push(
                await entryWithVisibility(path.join(normalized, name), visibility, false),
              );
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
                  error: errorMessage(error),
                });
            }
          }
        }),
      );
    })(),
  ]);
  for (const item of entries) item.hidden ||= hidden.has(item.name);
  return { path: normalized, parent: path.dirname(normalized), entries };
}
