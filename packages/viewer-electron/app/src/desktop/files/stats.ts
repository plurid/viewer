import { Stats } from 'node:fs';
import { lstat as nodeLstat, stat as nodeStat } from 'node:fs/promises';
import type { BigIntStats, PathLike } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { exactIdentityParts } from '../../domain/files/item-identity';

export type FileStats = Omit<Stats, 'dev' | 'ino' | 'rdev' | 'blksize'> & { dev: bigint; ino: bigint };
type NodeStats = Stats | BigIntStats;

/** Kernel timespec nanoseconds are nonnegative even before the epoch. Reconstruct that pair
 * before floating-point conversion, matching Node's seconds * 1000 + nanoseconds / 1e6 exactly. */
function milliseconds(ns: bigint): number {
  let seconds = ns / 1000000000n;
  let nanos = ns % 1000000000n;
  if (nanos < 0) {
    seconds -= 1n;
    nanos += 1000000000n;
  }
  return Number(seconds) * 1000 + Number(nanos) / 1e6;
}

/** Identity must come from the same syscall as metadata. Keep sizes and timestamps in the
 * existing numeric API, but never pass device or inode through a JavaScript number. */
export function fileStats(info: NodeStats): FileStats {
  const identity = exactIdentityParts(info);
  const result = Object.create(Stats.prototype) as FileStats;
  result.dev = identity.dev;
  result.ino = identity.ino;
  result.mode = Number(info.mode);
  result.nlink = Number(info.nlink);
  result.uid = Number(info.uid);
  result.gid = Number(info.gid);
  result.size = Number(info.size);
  result.blocks = Number(info.blocks);
  result.atimeMs = 'atimeNs' in info ? milliseconds(info.atimeNs) : info.atimeMs;
  result.mtimeMs = 'mtimeNs' in info ? milliseconds(info.mtimeNs) : info.mtimeMs;
  result.ctimeMs = 'ctimeNs' in info ? milliseconds(info.ctimeNs) : info.ctimeMs;
  result.birthtimeMs = 'birthtimeNs' in info ? milliseconds(info.birthtimeNs) : info.birthtimeMs;
  // Stats.prototype owns Node's lazy Date getters, including its Math.round behavior.
  return result;
}

export async function lstat(file: PathLike): Promise<FileStats> {
  return fileStats(await nodeLstat(file, { bigint: true }));
}

export async function stat(file: PathLike): Promise<FileStats> {
  return fileStats(await nodeStat(file, { bigint: true }));
}

export async function fileStat(handle: FileHandle): Promise<FileStats> {
  return fileStats(await handle.stat({ bigint: true }));
}
