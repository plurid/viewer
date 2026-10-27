/**
 * The only module that removes filesystem entries without the native Trash;
 * ESLint rejects `rm`, `rmdir` and `unlink` elsewhere. Each function names the
 * one narrow case it serves. Anything a person could want back goes to the
 * Trash instead (AGENTS.md). One exception runs outside Viewer: a terminal
 * launcher script removes itself with `/bin/rm` as Terminal runs it
 * (`terminal-launch.ts`); those never run are removed at startup.
 */
import { rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

function ignoreMissing(error: NodeJS.ErrnoException): void {
  if (error.code !== 'ENOENT') throw error;
}

export function assertTestRemovalAllowed(file: string): void {
  if (process.env.VIEWER_TEST_NO_REMOVAL !== '1') return;
  throw Object.assign(new Error('Validation must preserve this filesystem entry: ' + file), {
    code: 'TEST_REMOVAL_BLOCKED',
  });
}

/** A temporary file this process created exclusively and has finished with, such
 * as an atomic-write source after a failed rename. Directories are refused. */
export async function discardOwnTemporaryFile(file: string): Promise<void> {
  // Atomic publication usually consumed this path already. Retaining a leftover temporary
  // file must not turn an otherwise successful write into a validation failure.
  if (process.env.VIEWER_TEST_NO_REMOVAL === '1' || process.env.VIEWER_TEST_PRESERVE === '1')
    return;
  await unlink(file).catch(ignoreMissing);
}

/** An empty directory. Fails instead of removing any contents. */
export async function removeEmptyDirectory(directory: string): Promise<void> {
  assertTestRemovalAllowed(directory);
  await rmdir(directory);
}

/** A file whose identity the caller has just verified: an output this process
 * created exclusively, or a fully copied and re-verified move source. */
export async function unlinkVerified(file: string): Promise<void> {
  assertTestRemovalAllowed(file);
  await unlink(file);
}

/** An entry inside the application's private data directory, such as a removed
 * checkpoint copy or workflow receipt. Paths outside that directory are refused. */
export async function removePrivateData(privateRoot: string, entry: string): Promise<void> {
  const relative = path.relative(path.resolve(privateRoot), path.resolve(entry));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Only private application data can be removed without the Trash.');
  assertTestRemovalAllowed(entry);
  await rm(entry, { recursive: true, force: true });
}
