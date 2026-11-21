import { versionIdentity } from '../../domain/files/item-identity';
import type { TemporalIdentity } from '../../domain/files/item-identity';
import { lstat, fileStat } from '../files/stats';
import type { FileStats as Stats } from '../files/stats';

import { sameItem, sameVersionItem } from '../files/item-identity';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  chmod,
  link,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  symlink,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { exists } from '../files/filesystem';
import { macFiles } from '../native/macos-files';
import { renameExclusive } from './rename-exclusive';
import { fileCoordination } from '../files/file-coordination';
import { removeEmptyDirectory, unlinkVerified } from './removal';
import { errorMessage } from '../../domain/errors';

export type Access = (files: readonly string[]) => Promise<void>;
/** What a transfer needs from the job that runs it. */
export interface TransferJob {
  /** Throws once the job is cancelled. */
  check(): void;
  signal: AbortSignal;
  /** A file started copying; its size counts toward the job's total. */
  started(file: string, bytes: number): void;
  copied(bytes: number): void;
}
export interface CopyFingerprint {
  file: string;
  info: Stats;
  identity: TemporalIdentity;
  children?: string[];
}
/**
 * How far a copied file is written before it counts as copied. `flushed` waits until its data is
 * on permanent storage (FileHandle.sync, which is F_FULLFSYNC on macOS): a move across volumes
 * removes its sources only after that. `written` leaves the bytes to the system, as Finder does: a
 * plain copy keeps its sources, so one lost to a power failure can be made again.
 */
export type CopyDurability = 'flushed' | 'written';
/**
 * Metadata held back from a staged root item until publication succeeds: immutable flags, read-only
 * folder modes and deny-delete ACLs otherwise stop macOS from renaming the item out of its stage.
 */
export interface DeferredMetadata {
  set(apply: (destination: string) => Promise<void>, release?: () => Promise<void>): void;
  apply(destination: string): Promise<void>;
  close(): Promise<void>;
}
export function createDeferredMetadata(): DeferredMetadata {
  let pending:
    { apply: (destination: string) => Promise<void>; release?: () => Promise<void> } | undefined;
  return {
    set(apply, release) {
      pending = { apply, release };
    },
    async apply(destination) {
      const work = pending;
      if (!work) return;
      await work.apply(destination);
    },
    async close() {
      const work = pending;
      pending = undefined;
      await work?.release?.();
    },
  };
}
/** Where a volume cannot clone a file, and its bytes are streamed instead. */
const cannotClone = ['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EINVAL', 'ENOSYS'];
/** Make a published tree's directory entries durable before its sources on another
 * volume are removed. File contents were already synced as they were copied. */
export async function syncDirectories(root: string): Promise<void> {
  if (process.platform === 'win32') return;
  const parent = path.dirname(root);
  const pending = [parent, root];
  while (pending.length) {
    const directory = pending.pop()!;
    if (!(await lstat(directory)).isDirectory()) continue;
    if (directory !== parent)
      for (const child of await readdir(directory, { withFileTypes: true }))
        if (child.isDirectory()) pending.push(path.join(directory, child.name));
    const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY || 0));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
/** macOS coordinates publication, with a verified reservation only where exclusive rename is
 * unsupported. Other platforms use exclusive publication. */
export async function publish(
  source: string,
  destination: string,
  access: Access,
  job?: TransferJob,
  guard?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (process.platform === 'darwin') {
    return fileCoordination.run(
      [
        { path: source, mode: 'move' },
        { path: destination, mode: 'write' },
      ],
      async (signal) => {
        signal?.throwIfAborted();
        job?.check();
        const from = fileCoordination.path(source),
          to = fileCoordination.path(destination);
        await access([from, to]);
        await guard?.();
        signal?.throwIfAborted();
        const info = await lstat(from);
        if (!info.isDirectory() && !info.isFile() && !info.isSymbolicLink())
          throw new Error('Special devices and sockets cannot be transferred.');
        await renameExclusive(from, to, fileCoordination.purpose(), signal);
      },
      job?.signal ?? signal,
    );
  }
  await access([source, destination]);
  await guard?.();
  signal?.throwIfAborted();
  const info = await lstat(source);
  if (!info.isDirectory()) {
    if (!info.isFile() && !info.isSymbolicLink())
      throw new Error('Special devices and sockets cannot be transferred.');
    if (info.isSymbolicLink()) {
      await symlink(await readlink(source), destination);
    } else {
      try {
        await link(source, destination);
      } catch (error) {
        // exFAT and some network mounts cannot create hard links. Keep the same
        // exclusive destination and cancellable streaming semantics there.
        if (
          !['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS'].includes(
            (error as NodeJS.ErrnoException).code || '',
          )
        )
          throw error;
        // the original is removed next
        await copyFile(source, destination, info, job, undefined, 'flushed');
      }
    }
    try {
      // The destination now holds the same inode or a verified copy.
      await unlinkVerified(source);
    } catch (error) {
      throw new Error(
        `The destination is complete, but the original could not be removed: ${errorMessage(error)}`,
      );
    }
    return;
  }
  await mkdir(destination, { mode: info.mode });
  const reserved = await lstat(destination);
  try {
    await rename(source, destination);
  } catch (error) {
    const current = await lstat(destination).catch(() => null);
    if (current && sameItem(current, reserved))
      await removeEmptyDirectory(destination).catch(() => undefined);
    throw error;
  }
}
/** Only a short tail without spaces after a leading name is an extension (DESIGN.md). */
const extensionTail = /\.[A-Za-z0-9]{1,8}$/;
/** Splits a path into stem and extension; folders and non-extension dotted names stay whole. */
function splitName(destination: string, directory: boolean): { stem: string; ext: string } {
  if (directory) return { stem: destination, ext: '' };
  const base = path.basename(destination);
  const tail = extensionTail.exec(base);
  const ext = tail && tail.index > 0 ? tail[0] : '';
  return { stem: destination.slice(0, destination.length - ext.length), ext };
}
/** The Finder-style "copy" name that is free next to `destination`. */
export async function keepBothName(destination: string, directory = false): Promise<string> {
  const { stem, ext } = splitName(destination, directory);
  let suffix = 1;
  let candidate = `${stem} copy${ext}`;
  while (await exists(candidate)) candidate = `${stem} copy ${++suffix}${ext}`;
  return candidate;
}
/**
 * The free name for something newly created beside an existing one: "Pasted image 2.png", then
 * "Pasted image 3.png". A copy keeps "copy" in its name; a new item only counts.
 */
export async function numberedName(destination: string, directory = false): Promise<string> {
  const { stem, ext } = splitName(destination, directory);
  let suffix = 2;
  let candidate = `${stem} ${suffix}${ext}`;
  while (await exists(candidate)) candidate = `${stem} ${++suffix}${ext}`;
  return candidate;
}
/** Where a replaced item is kept on a volume without a Trash: "Notes (previous).md", then
 * "Notes (previous 2).md". */
export async function previousName(destination: string, directory = false): Promise<string> {
  const { stem, ext } = splitName(destination, directory);
  let suffix = 1;
  let candidate = `${stem} (previous)${ext}`;
  while (await exists(candidate)) candidate = `${stem} (previous ${++suffix})${ext}`;
  return candidate;
}
/** The Finder-style alias name that is free next to `source`: "Report.pdf alias", then "… alias 2". */
export async function aliasName(source: string): Promise<string> {
  let suffix = 1;
  let candidate = `${source} alias`;
  while (await exists(candidate)) candidate = `${source} alias ${++suffix}`;
  return candidate;
}
/** Copies `source` to the new path `target`, recording a fingerprint of every
 * copied item so a move can verify its sources before removing them. */
export async function copyTree(
  job: TransferJob,
  source: string,
  target: string,
  fingerprints: CopyFingerprint[],
  access: Access,
  durability: CopyDurability = 'flushed',
  deferred?: DeferredMetadata,
): Promise<void> {
  job.check();
  // Content coordination can hydrate a placeholder. Capture its fingerprint
  // after acquisition, before copying, rather than retaining placeholder size.
  if ((await lstat(source)).isFile()) {
    return fileCoordination.run(
      [
        { path: source, mode: 'read' },
        { path: target, mode: 'write' },
      ],
      async (signal) => {
        await access([source, target]);
        signal?.throwIfAborted();
        job.check();
        const info = await lstat(source);
        if (!info.isFile()) throw new Error('Source changed while waiting for its file provider.');
        fingerprints.push({ file: source, info, identity: versionIdentity(info) });
        await copyFile(source, target, info, job, signal, durability, deferred);
      },
      job.signal,
    );
  }
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    return fileCoordination.run(
      [
        { path: source, mode: 'metadata' },
        { path: target, mode: 'write' },
      ],
      async (signal) => {
        signal?.throwIfAborted();
        job.check();
        const from = fileCoordination.path(source),
          to = fileCoordination.path(target);
        await access([from, to]);
        const current = await lstat(from);
        if (!current.isSymbolicLink())
          throw new Error('The symbolic link changed while waiting for its file provider.');
        fingerprints.push({ file: source, info: current, identity: versionIdentity(current) });
        await symlink(await readlink(from), to);
        if (process.platform === 'darwin') {
          if (deferred) {
            const owned = await lstat(to);
            deferred.set(async (destination) => {
              const published = await lstat(destination);
              if (!sameItem(published, owned))
                throw new Error('The symbolic link changed during the transfer.');
              await macFiles().copyLinkMetadata(source, destination);
            });
          } else {
            await macFiles().copyLinkMetadata(from, to);
          }
        }
        signal?.throwIfAborted();
      },
      job.signal,
    );
  }
  const children = info.isDirectory() ? (await readdir(source)).sort() : undefined;
  fingerprints.push({ file: source, info, children, identity: versionIdentity(info) });
  if (info.isDirectory()) {
    await mkdir(target, { mode: info.mode | 0o700 });
    for (const name of children!)
      await copyTree(
        job,
        path.join(source, name),
        path.join(target, name),
        fingerprints,
        access,
        durability,
      );
    if (process.platform === 'darwin') {
      await fileCoordination.run(
        [
          { path: source, mode: 'metadata' },
          { path: target, mode: 'write' },
        ],
        async (signal) => {
          signal?.throwIfAborted();
          await access([fileCoordination.path(source), fileCoordination.path(target)]);
          const input = await open(
            fileCoordination.path(source),
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
          let output: Awaited<ReturnType<typeof open>> | undefined;
          let retained = false;
          try {
            const opened = await fileStat(input);
            if (!sameVersionItem(opened, info))
              throw new Error('Source folder changed during the copy.');
            output = await open(
              fileCoordination.path(target),
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            signal?.throwIfAborted();
            job.check();
            if (deferred) {
              const sourceHandle = input;
              const targetHandle = output;
              deferred.set(
                async () => {
                  await macFiles().copyMetadata(sourceHandle.fd, targetHandle.fd);
                  if (durability === 'flushed') await targetHandle.sync();
                },
                async () => {
                  await Promise.allSettled([sourceHandle.close(), targetHandle.close()]);
                },
              );
              retained = true;
            } else {
              await macFiles().copyMetadata(input.fd, output.fd);
              signal?.throwIfAborted();
              job.check();
            }
          } finally {
            if (!retained) {
              await input.close();
              await output?.close();
            }
          }
        },
        job.signal,
      );
    } else if (deferred) {
      deferred.set(async (destination) => {
        await chmod(destination, info.mode);
        await utimes(destination, info.atime, info.mtime);
      });
    } else await chmod(target, info.mode);
  } else if (info.isFile()) {
    throw new Error('Source changed while starting the copy.');
  } else {
    throw new Error('Special devices and sockets cannot be transferred.');
  }
  if (process.platform !== 'darwin' && !deferred) await utimes(target, info.atime, info.mtime);
}
interface CloneOutcome {
  cloned: boolean;
  deferred: boolean;
}
/** Clones the open file `input` to the new path `target` where its volume can: an APFS clone
 * shares the source's blocks and attributes. False where it cannot, and the bytes are streamed. */
async function cloned(
  input: FileHandle,
  target: string,
  deferRestrictions: boolean,
): Promise<CloneOutcome> {
  if (process.platform !== 'darwin') return { cloned: false, deferred: false };
  try {
    const native = macFiles();
    const deferred =
      deferRestrictions && native.cloneStageVersion === 1
        ? Boolean(await native.clone(input.fd, target, true))
        : (await native.clone(input.fd, target), false);
    return { cloned: true, deferred };
  } catch (error) {
    if (cannotClone.includes((error as NodeJS.ErrnoException).code ?? ''))
      return { cloned: false, deferred: false };
    throw error;
  }
}
/** Copies one regular file into a new, exclusively created `target`: a clone where the volume
 * can make one, its bytes streamed otherwise. Either way the source must not have changed by the
 * end, and a failed copy removes only its own output. */
async function copyFile(
  source: string,
  target: string,
  info: Stats,
  job?: TransferJob,
  signal?: AbortSignal,
  durability: CopyDurability = 'flushed',
  deferred?: DeferredMetadata,
): Promise<void> {
  source = fileCoordination.path(source);
  target = fileCoordination.path(target);
  signal?.throwIfAborted();
  job?.started(source, info.size);
  const input = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  let output: Awaited<ReturnType<typeof open>> | undefined,
    owned: Stats | undefined,
    retained = false;
  try {
    const opened = await fileStat(input);
    if (
      !opened.isFile() ||
      !sameVersionItem(opened, info) ||
      opened.size !== info.size ||
      opened.mtimeMs !== info.mtimeMs ||
      opened.ctimeMs !== info.ctimeMs
    )
      throw new Error('Source changed before copying; it has been left untouched.');
    const outcome = await cloned(input, target, Boolean(deferred));
    let needsDeferred = false;
    if (outcome.cloned) {
      // made exclusively in the private stage: the item there now is the clone
      owned = await lstat(target);
      job?.copied(info.size);
      needsDeferred = Boolean(deferred && outcome.deferred);
      if (durability === 'flushed' || needsDeferred)
        output = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    } else {
      output = await open(target, 'wx', deferred ? 0o600 : info.mode);
      owned = await fileStat(output);
      await streamFile(input, output, info, job, signal, !deferred);
      needsDeferred = Boolean(deferred);
    }
    signal?.throwIfAborted();
    if (durability === 'flushed') await output?.sync();
    const after = await lstat(source);
    if (
      !sameVersionItem(after, info) ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs ||
      after.size !== info.size
    )
      throw new Error('Source changed while copying; it has been left untouched.');
    job?.check();
    if (deferred && needsDeferred && output) {
      const sourceHandle = input;
      const targetHandle = output;
      deferred.set(
        async () => {
          if (process.platform === 'darwin')
            await macFiles().copyMetadata(sourceHandle.fd, targetHandle.fd);
          else {
            await targetHandle.chmod(info.mode & 0o7777);
            await targetHandle.utimes(info.atime, info.mtime);
          }
          if (durability === 'flushed') await targetHandle.sync();
        },
        async () => {
          await Promise.allSettled([sourceHandle.close(), targetHandle.close()]);
        },
      );
      retained = true;
    } else if (process.platform !== 'darwin') {
      await utimes(target, info.atime, info.mtime);
    }
  } catch (error) {
    const current = owned && (await lstat(target).catch(() => null));
    if (current && owned && sameItem(current, owned))
      await unlinkVerified(target).catch(() => undefined);
    throw error;
  } finally {
    if (!retained) {
      await input.close();
      await output?.close();
    }
  }
}
/** Streams `info.size` bytes from `input` into the new file `output`, with the source's metadata. */
async function streamFile(
  input: FileHandle,
  output: FileHandle,
  info: Stats,
  job?: TransferJob,
  signal?: AbortSignal,
  applyMetadata = true,
): Promise<void> {
  const buffer = Buffer.allocUnsafe(256 * 1024);
  let total = 0;
  while (total < info.size) {
    signal?.throwIfAborted();
    job?.check();
    const { bytesRead } = await input.read(
      buffer,
      0,
      Math.min(buffer.length, info.size - total),
      null,
    );
    if (!bytesRead)
      throw new Error('Source became shorter while copying; it has been left untouched.');
    total += bytesRead;
    let written = 0;
    while (written < bytesRead) {
      signal?.throwIfAborted();
      const result = await output.write(buffer, written, bytesRead - written, null);
      if (!result.bytesWritten) throw new Error('The destination stopped accepting data.');
      written += result.bytesWritten;
    }
    job?.copied(bytesRead);
  }
  signal?.throwIfAborted();
  if (applyMetadata && process.platform === 'darwin')
    await macFiles().copyMetadata(input.fd, output.fd);
}
