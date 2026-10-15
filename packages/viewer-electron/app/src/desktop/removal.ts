/**
 * The only module that removes filesystem entries without the native Trash;
 * ESLint rejects `rm`, `rmdir` and `unlink` elsewhere. Each function names the
 * one narrow case it serves. Anything a person could want back goes to the
 * Trash instead (AGENTS.md).
 */
import { rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

function ignoreMissing(error: NodeJS.ErrnoException): void {
  if (error.code !== 'ENOENT') throw error;
}

/** A temporary file this process created exclusively and has finished with, such
 * as an atomic-write source after a failed rename. Directories are refused. */
export async function discardOwnTemporaryFile(file: string): Promise<void> {
  await unlink(file).catch(ignoreMissing);
}

/** An empty directory. Fails instead of removing any contents. */
export function removeEmptyDirectory(directory: string): Promise<void> {
  return rmdir(directory);
}

/** A file whose identity the caller has just verified: an output this process
 * created exclusively, or a fully copied and re-verified move source. */
export function unlinkVerified(file: string): Promise<void> {
  return unlink(file);
}

/** An entry inside the application's private data directory, such as a removed
 * checkpoint copy or workflow receipt. Paths outside that directory are refused. */
export async function removePrivateData(privateRoot: string, entry: string): Promise<void> {
  const relative = path.relative(path.resolve(privateRoot), path.resolve(entry));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Only private application data can be removed without the Trash.');
  await rm(entry, { recursive: true, force: true });
}
