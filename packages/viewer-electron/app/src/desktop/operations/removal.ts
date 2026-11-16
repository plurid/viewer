import { lstat } from '../files/stats';
import { itemIdentity, nativeItemIdentity } from '../../domain/files/item-identity';
/**
 * The only module that removes filesystem entries without the native Trash;
 * ESLint rejects `rm`, `rmdir` and `unlink` elsewhere. Each function names the
 * one narrow case it serves. Anything a person could want back goes to the
 * Trash instead (AGENTS.md). One exception runs outside Viewer: a terminal
 * launcher script removes its own file with `/bin/rm`, guarded, as the terminal
 * app runs it (`launcherScript`); those never run go at startup through
 * `removePrivateFile`. Failed native publication uses the Trash or keeps its
 * recovered reservations; that path never permanently deletes an entry.
 */
import { readdir, rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  NativeRenameContainer,
  NativeRenameRecovery,
  NativeRenameReservation,
  TrashReceipt,
} from '../native/macos-files';
import { errorMessage } from '../../domain/errors';

type ReservationTrash = (file: string) => Promise<TrashReceipt>;

const identity = itemIdentity;

async function ownedContainer(container: NativeRenameContainer): Promise<boolean> {
  if (!/^\.viewer-rename-[a-f0-9]{32}$/.test(path.basename(container.path))) return false;
  const info = await lstat(container.path);
  return (
    info.isDirectory() &&
    !info.isSymbolicLink() &&
    identity(info) === nativeItemIdentity(container.identity)
  );
}

async function ownedReservation(
  entry: NativeRenameReservation,
  containers: readonly NativeRenameContainer[],
): Promise<boolean> {
  const container = containers.find((item) => item.path === path.dirname(entry.path));
  if (!container || !(await ownedContainer(container))) return false;
  const info = await lstat(entry.path);
  if (identity(info) !== nativeItemIdentity(entry.identity) || info.isSymbolicLink()) return false;
  return entry.directory
    ? info.isDirectory() && (await readdir(entry.path)).length === 0
    : info.isFile() && info.size === 0 && info.nlink === 1;
}

/** Recovery paths are private claims, never final names. Foreign or changed entries stay out of
 * the Trash; permanent-removal helpers below are deliberately unavailable to this path. */
export async function disposeRenameRecovery(
  recovery: NativeRenameRecovery,
  trash: ReservationTrash,
): Promise<string[]> {
  const notes: string[] = [];
  const dispose = async (file: string): Promise<void> => {
    if (process.env.VIEWER_TEST_NO_REMOVAL === '1' || process.env.VIEWER_TEST_PRESERVE === '1') {
      notes.push(`An empty Viewer reservation was kept at ${file}.`);
      return;
    }
    try {
      const receipt = await trash(file);
      const remaining = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      notes.push(
        remaining
          ? `An empty Viewer reservation was kept at ${file}.`
          : `An empty Viewer reservation was moved to the Trash at ${receipt.path}.`,
      );
    } catch (error) {
      notes.push(`An empty Viewer reservation was kept at ${file}: ${errorMessage(error)}`);
    }
  };
  for (const entry of recovery.entries) {
    if (entry.kind === 'restored') {
      notes.push(`The other item was restored at ${entry.path}.`);
      continue;
    }
    if (entry.kind === 'kept') {
      notes.push(`An item was kept at ${entry.path}.`);
      continue;
    }
    try {
      if (await ownedReservation(entry, recovery.containers)) await dispose(entry.path);
      else notes.push(`The recovery item changed and was kept at ${entry.path}.`);
    } catch (error) {
      notes.push(`The recovery item was kept at ${entry.path}: ${errorMessage(error)}`);
    }
  }
  for (const container of recovery.containers) {
    try {
      if (!(await ownedContainer(container))) {
        notes.push(`The recovery folder changed and was kept at ${container.path}.`);
      } else if ((await readdir(container.path)).length === 0) {
        await dispose(container.path);
      } else if (!recovery.entries.some((entry) => path.dirname(entry.path) === container.path)) {
        notes.push(`Recovery content was kept at ${container.path}.`);
      }
    } catch (error) {
      notes.push(`The recovery folder was kept at ${container.path}: ${errorMessage(error)}`);
    }
  }
  return notes;
}

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

function assertPrivateData(privateRoot: string, entry: string): void {
  const relative = path.relative(path.resolve(privateRoot), path.resolve(entry));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Only private application data can be removed without the Trash.');
}

/** An entry inside the application's private data directory, such as a removed
 * checkpoint copy or workflow receipt. Paths outside that directory are refused. */
export async function removePrivateData(privateRoot: string, entry: string): Promise<void> {
  assertPrivateData(privateRoot, entry);
  assertTestRemovalAllowed(entry);
  await rm(entry, { recursive: true, force: true });
}

/** One file inside the application's private data directory, such as a terminal
 * launcher that never ran. A folder or a path outside that directory is refused. */
export async function removePrivateFile(privateRoot: string, file: string): Promise<void> {
  assertPrivateData(privateRoot, file);
  assertTestRemovalAllowed(file);
  await unlink(file);
}
