import { constants, type Stats } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  symlink,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { exists, message } from './filesystem';
import { macFiles } from './macos-files';
import { fileCoordination } from './file-coordination';
import { removeEmptyDirectory, unlinkVerified } from './removal';

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
  children?: string[];
}
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
/** macOS uses a coordinated exclusive rename; other platforms use exclusive publication.
 * A concurrent writer can make publication fail, but its file is never overwritten. */
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
        await macFiles().renameExclusive(from, to, fileCoordination.purpose());
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
        await copyFile(source, destination, info, job);
      }
    }
    try {
      // The destination now holds the same inode or a verified copy.
      await unlinkVerified(source);
    } catch (error) {
      throw new Error(
        `The destination is complete, but the original could not be removed: ${message(error)}`,
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
    if (current?.dev === reserved.dev && current.ino === reserved.ino)
      await removeEmptyDirectory(destination).catch(() => undefined);
    throw error;
  }
}
/** The Finder-style "copy" name that is free next to `destination`. */
export async function keepBothName(destination: string): Promise<string> {
  const ext = path.extname(destination);
  const stem = destination.slice(0, destination.length - ext.length);
  let suffix = 1;
  let candidate = `${stem} copy${ext}`;
  while (await exists(candidate)) candidate = `${stem} copy ${++suffix}${ext}`;
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
        fingerprints.push({ file: source, info });
        await copyFile(source, target, info, job, signal);
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
        fingerprints.push({ file: source, info: current });
        await symlink(await readlink(from), to);
        if (process.platform === 'darwin') await macFiles().copyLinkMetadata(from, to);
        signal?.throwIfAborted();
      },
      job.signal,
    );
  }
  const children = info.isDirectory() ? (await readdir(source)).sort() : undefined;
  fingerprints.push({ file: source, info, children });
  if (info.isDirectory()) {
    await mkdir(target, { mode: info.mode | 0o700 });
    for (const name of children!)
      await copyTree(job, path.join(source, name), path.join(target, name), fingerprints, access);
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
          try {
            const opened = await input.stat();
            if (opened.dev !== info.dev || opened.ino !== info.ino)
              throw new Error('Source folder changed during the copy.');
            output = await open(
              fileCoordination.path(target),
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            await macFiles().copyMetadata(input.fd, output.fd);
            signal?.throwIfAborted();
            job.check();
          } finally {
            await input.close();
            await output?.close();
          }
        },
        job.signal,
      );
    } else await chmod(target, info.mode);
  } else if (info.isFile()) {
    throw new Error('Source changed while starting the copy.');
  } else {
    throw new Error('Special devices and sockets cannot be transferred.');
  }
  if (process.platform !== 'darwin') await utimes(target, info.atime, info.mtime);
}
/** Streams one regular file into a new, exclusively created `target`, verifying
 * that the source did not change; a failed copy removes only its own output. */
export async function copyFile(
  source: string,
  target: string,
  info: Stats,
  job?: TransferJob,
  signal?: AbortSignal,
): Promise<void> {
  source = fileCoordination.path(source);
  target = fileCoordination.path(target);
  signal?.throwIfAborted();
  job?.started(source, info.size);
  const input = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  let output: Awaited<ReturnType<typeof open>> | undefined, owned: Stats | undefined;
  try {
    const opened = await input.stat();
    if (
      !opened.isFile() ||
      opened.dev !== info.dev ||
      opened.ino !== info.ino ||
      opened.size !== info.size ||
      opened.mtimeMs !== info.mtimeMs ||
      opened.ctimeMs !== info.ctimeMs
    )
      throw new Error('Source changed before copying; it has been left untouched.');
    output = await open(target, 'wx', info.mode);
    owned = await output.stat();
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
    if (process.platform === 'darwin') await macFiles().copyMetadata(input.fd, output.fd);
    await output.sync();
    const after = await lstat(source);
    if (
      after.dev !== info.dev ||
      after.ino !== info.ino ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs ||
      after.size !== info.size
    )
      throw new Error('Source changed while copying; it has been left untouched.');
    job?.check();
    if (process.platform !== 'darwin') await utimes(target, info.atime, info.mtime);
  } catch (error) {
    const current = owned && (await lstat(target).catch(() => null));
    if (current && owned && current.dev === owned.dev && current.ino === owned.ino)
      await unlinkVerified(target).catch(() => undefined);
    throw error;
  } finally {
    await input.close();
    await output?.close();
  }
}
