import { setTimeout as wait } from 'node:timers/promises';
import { constants } from 'node:fs';
import { link, open, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { discardOwnTemporaryFile } from '../operations/removal';
import { inspectReviewedFile } from '../native/reviewed-file';
import { syncParentDirectory } from './directory-sync';

const pending = new Map<string, Promise<unknown>>();

/** Darwin takes O_EXLOCK as part of open(2). Closing the descriptor also releases it after
 * a crash. Nonblocking attempts leave libuv threads available to the lock holder. */
async function lockDirectory(directory: string) {
  if (process.platform !== 'darwin') return;
  const darwinExclusiveLock = 0x20;
  const flags =
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK | darwinExclusiveLock;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return await open(directory, flags);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code !== 'EAGAIN' || Date.now() >= deadline) throw error;
      await wait(15);
    }
  }
}

export function coordinateMetadata<T>(directory: string, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(directory);
  const previous = pending.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const lock = await lockDirectory(directory);
      try {
        return await work();
      } finally {
        await lock?.close();
      }
    })
    .finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
  pending.set(key, task);
  return task;
}

const previousPrefix = (file: string) => path.basename(file) + '.publishing-';

/** An interrupted replacement must never look like a new empty permission or update store. */
export async function requireNoInterruptedPublication(file: string) {
  const entries = await readdir(path.dirname(file)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const prefix = previousPrefix(file);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const previous = entries.find(
    (name) => name.startsWith(prefix) && uuid.test(name.slice(prefix.length)),
  );
  if (previous)
    throw new Error('An interrupted metadata save retained the previous file as ' + previous + '.');
}

/** A writer outside the lock can replace the entry after inspection. Claim the actual entry,
 * check the displaced bytes, and use an exclusive link for both publication and rollback. */
export async function publishMetadata(
  file: string,
  temporary: string,
  expected: string | null,
  limit: number,
  published: () => void,
) {
  if (expected === null) {
    await requireNoInterruptedPublication(file);
    await link(temporary, file);
    published();
    await syncParentDirectory(file);
    return;
  }
  const changed = () => new Error('Application metadata changed on disk. Reopen it before saving.');
  if ((await inspectReviewedFile(file, limit)).reviewed.sha256 !== expected) throw changed();
  const previous = path.join(path.dirname(file), previousPrefix(file) + randomUUID());
  // Exercise exclusive linking on this volume and reserve our own recovery name before
  // displacing anything. A backend that cannot link leaves the current document in place.
  await link(temporary, previous);
  try {
    await rename(file, previous);
  } catch (error) {
    await discardOwnTemporaryFile(previous);
    throw error;
  }
  try {
    if ((await inspectReviewedFile(previous, limit)).reviewed.sha256 !== expected) throw changed();
    await link(temporary, file);
  } catch (error) {
    // Preserve a new occupant and the exact displaced entry if someone filled the name.
    try {
      await link(previous, file);
    } catch {
      throw new Error(
        'Application metadata changed. The displaced file was kept at ' + previous + '.',
        { cause: error },
      );
    }
    await syncParentDirectory(file);
    // Rollback has restored this very inode. Keep its other link for recovery.
    await rename(previous, previous + '.bak');
    throw error;
  }
  published();
  await syncParentDirectory(file);
  // The staged inode now has its final name. Only the verified predecessor goes into the
  // owned temporary slot, after the new directory entry is durable.
  await rename(previous, temporary);
}
