import { setTimeout as wait } from 'node:timers/promises';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { versionIdentity } from '../../domain/files/item-identity';
import { fileStat } from '../files/stats';
import type { FileStats } from '../files/stats';
import { discardOwnTemporaryFile } from '../operations/removal';
import { inspectReviewedFile, sameReviewedFile, verifyReviewedFile } from '../native/reviewed-file';
import type { InspectedFile, ReviewedFile } from '../native/reviewed-file';
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

export function coordinateMetadata<T>(
  directory: string,
  work: (locked: boolean) => Promise<T>,
): Promise<T> {
  const key = path.resolve(directory);
  const previous = pending.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const lock = await lockDirectory(directory);
      try {
        return await work(!!lock);
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

function historyDirectory(file: string, name: string) {
  const generation = name.slice(previousPrefix(file).length).replace(/\.verifying$/, '');
  return file + '.history-' + generation;
}

async function requireHistoryDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077)
    throw new Error(`Expected a private metadata history directory at ${directory}.`);
}

async function verifyArchiveEntry(
  source: string,
  destination: string,
  limit: number,
  locked: boolean,
  linkedFrom?: ReviewedFile,
) {
  const directory = path.dirname(destination);
  const prefix = source.endsWith('.verifying') ? 'verification.sha256-' : 'predecessor.sha256-';
  const markers = (await readdir(directory)).filter((name) => name.startsWith(prefix));
  const archived = await inspectReviewedFile(destination, limit).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    },
  );
  if (!archived) {
    if (markers.length) throw interrupted(path.basename(source));
    return false;
  }
  const current = await inspectReviewedFile(source, limit);
  const marker = prefix + archived.reviewed.sha256;
  if (
    current.reviewed.sha256 !== archived.reviewed.sha256 ||
    (linkedFrom &&
      (!sameReviewedFile(linkedFrom, current.reviewed) ||
        !sameReviewedFile(linkedFrom, archived.reviewed))) ||
    markers.some((name) => name !== marker)
  )
    throw interrupted(path.basename(source));
  // A directory copy can give each hard link its own inode. Keep the verified digest in
  // an empty file's name so recording it cannot leave a partially written digest.
  if (markers.length) await inspectReviewedFile(path.join(directory, marker), 0);
  else if (locked)
    await writeFile(path.join(directory, marker), '', { flag: 'wx', mode: 0o600, flush: true });
  return true;
}

/** An interrupted replacement must never look like a new empty permission or update store. */
async function publicationLeftovers(file: string, limit: number, locked: boolean) {
  const entries = await readdir(path.dirname(file)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const prefix = previousPrefix(file);
  const publication =
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?:\.verifying)?$/;
  const present = new Set(entries);
  const pending: string[] = [];
  for (const name of entries) {
    if (!name.startsWith(prefix) || !publication.test(name.slice(prefix.length))) continue;
    const archive = historyDirectory(file, name);
    if (present.has(path.basename(archive))) {
      await requireHistoryDirectory(archive);
      const archived = path.join(archive, name);
      if (await verifyArchiveEntry(path.join(path.dirname(file), name), archived, limit, locked)) {
        // Finish any directory sync interrupted after the archival link was created.
        await syncParentDirectory(archived);
        await syncParentDirectory(file);
        continue;
      }
    }
    pending.push(name);
  }
  return pending;
}

function interrupted(previous: string, cause?: unknown) {
  return new Error('An interrupted metadata save retained the previous file as ' + previous + '.', {
    cause,
  });
}

function allowExisting(error: NodeJS.ErrnoException) {
  if (error.code !== 'EEXIST') throw error;
}

type RecoveryCopyState = 'staging' | 'complete' | 'witnessed';

function privateRecoveryFile(info: Pick<FileStats, 'isFile' | 'mode' | 'uid'>) {
  return info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid?.();
}

function isPartialCopy(bytes: Buffer, complete: Buffer) {
  return bytes.length < complete.length && bytes.equals(complete.subarray(0, bytes.length));
}

async function syncRecoveryCopy(copy: string, kept: InspectedFile, state: RecoveryCopyState) {
  const access =
    state === 'staging'
      ? constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
      : constants.O_RDONLY;
  const handle = await open(copy, access | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await fileStat(handle);
    const identity = versionIdentity(info);
    if (
      !privateRecoveryFile(info) ||
      identity === kept.reviewed.version.identity ||
      (state === 'witnessed' ? info.nlink < 2 : info.nlink !== 1)
    )
      throw new Error('Expected an independent private recovery file.');
    const { reviewed, bytes } = await inspectReviewedFile(copy, kept.bytes.length);
    if (reviewed.version.identity !== identity) throw new Error('The recovery copy changed.');
    if (state === 'staging' && isPartialCopy(bytes, kept.bytes)) {
      await handle.writeFile(kept.bytes.subarray(bytes.length));
    } else if (reviewed.sha256 !== kept.reviewed.sha256) {
      throw new Error('The recovery copy changed.');
    }
    await handle.sync();
    return identity;
  } finally {
    await handle.close();
  }
}

async function recoverySnapshot(
  backup: string,
  witness: string,
  kept: InspectedFile,
  witnessed: boolean,
) {
  const directory = path.dirname(backup);
  const entries = await readdir(directory);
  const generationKey = createHash('sha256').update(path.basename(backup)).digest('hex');
  const prefix = '.recovery-' + generationKey + '.writing-';
  const stagingName = prefix + kept.reviewed.sha256;
  // A short write can leave even an empty file. Its name binds all retries to the first
  // verified contents, and only the missing suffix may be appended.
  if (entries.some((entry) => entry.startsWith(prefix) && entry !== stagingName))
    throw new Error('The predecessor changed during recovery.');
  let snapshot = backup;
  if (entries.includes(path.basename(backup))) {
    // A fixed-name backup written directly can already hold a short write. Preserve its
    // bytes and use a separate name only when the entire fragment matches the predecessor.
    const info = await lstat(backup);
    if (privateRecoveryFile(info) && info.nlink === 1 && info.size < kept.bytes.length) {
      const fragment = await inspectReviewedFile(backup, kept.bytes.length);
      if (isPartialCopy(fragment.bytes, kept.bytes))
        snapshot = path.join(directory, '.recovery-' + generationKey + '.complete.bak');
    }
  }
  if (!witnessed) {
    const complete = entries.includes(path.basename(snapshot));
    const source = complete ? snapshot : path.join(directory, stagingName);
    await syncRecoveryCopy(source, kept, complete ? 'complete' : 'staging');
    await link(source, witness);
  }
  const identity = await syncRecoveryCopy(witness, kept, 'witnessed');
  // A recovery started with a randomly named backup can resume from its verifying link.
  await link(witness, snapshot).catch(allowExisting);
  if ((await syncRecoveryCopy(snapshot, kept, 'witnessed')) !== identity)
    throw new Error('The recovery copy no longer matches its verification file.');
  await syncParentDirectory(snapshot);
  return snapshot;
}

/** Only a directory lock held across the missing-name check rules out another live publisher. */
export async function recoverMetadata(
  file: string,
  limit: number,
  locked: boolean,
  validate: (bytes: Buffer) => void,
) {
  const pending = await publicationLeftovers(file, limit, locked);
  const generations = new Set(pending.map((entry) => entry.replace(/\.verifying$/, '')));
  const [name] = generations;
  if (!name) return null;
  if (!locked || generations.size !== 1) throw interrupted(name);
  const directory = path.dirname(file);
  const previous = path.join(directory, name);
  const witness = previous + '.verifying';
  try {
    const kept = await inspectReviewedFile(previous, limit);
    validate(kept.bytes);
    const witnessed = pending.includes(name + '.verifying');
    const generation = name.slice(previousPrefix(file).length);
    const snapshot = await recoverySnapshot(
      file + '.recovery-' + generation + '.bak',
      witness,
      kept,
      witnessed,
    );
    await verifyReviewedFile(kept.reviewed, limit);
    // Publish the private snapshot. Replacing the predecessor's name after verification
    // cannot substitute different bytes at the current name.
    try {
      await link(snapshot, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return (await inspectReviewedFile(file, limit)).bytes;
    }
    await syncParentDirectory(file);
    try {
      await archivePredecessors(file, [name, name + '.verifying'], limit);
    } catch (error) {
      console.warn(
        'Restored the metadata. Its recovery history will be retried at the next save.',
        error,
      );
    }
    return kept.bytes;
  } catch (error) {
    throw interrupted(name, error);
  }
}

/** While the verified current name still exists, retire any preceding interrupted publication.
 * Sync both directories before opening another gap, including after a crash during recovery. */
async function archivePredecessors(file: string, pending: string[], limit: number) {
  for (const name of pending) {
    const source = path.join(path.dirname(file), name);
    const archive = historyDirectory(file, name);
    const destination = path.join(archive, name);
    try {
      const { reviewed } = await inspectReviewedFile(source, limit);
      await mkdir(archive, { mode: 0o700 }).catch(allowExisting);
      await requireHistoryDirectory(archive);
      // An external writer can replace the source after inspection. Linking leaves that
      // path in place even when a directory or symlink appears in the meantime.
      await link(source, destination);
      if (!(await verifyArchiveEntry(source, destination, limit, true, reviewed)))
        throw interrupted(name);
      await syncParentDirectory(destination);
      await syncParentDirectory(file);
    } catch (error) {
      throw interrupted(name, error);
    }
  }
}

/** A writer outside the lock can replace the entry after inspection. Claim the actual entry,
 * check the displaced bytes, and use an exclusive link for both publication and rollback. */
export async function publishMetadata(
  file: string,
  temporary: string,
  expected: string | null,
  limit: number,
  locked: boolean,
  published: () => void,
) {
  if (expected === null) {
    const [previous] = await publicationLeftovers(file, limit, locked);
    if (previous) throw interrupted(previous);
    await link(temporary, file);
    published();
    await syncParentDirectory(file);
    return;
  }
  const changed = () => new Error('Application metadata changed on disk. Reopen it before saving.');
  if ((await inspectReviewedFile(file, limit)).reviewed.sha256 !== expected) throw changed();
  if (locked)
    await archivePredecessors(file, await publicationLeftovers(file, limit, locked), limit);
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
