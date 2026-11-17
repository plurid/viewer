import { Stats } from 'node:fs';
import { lstat as nodeLstat, stat as nodeStat } from 'node:fs/promises';
import type { BigIntStats, PathLike } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { exactIdentityParts } from '../../domain/files/item-identity';
import { assertLocalPath } from './local-path';

export type FileStats = Omit<Stats, 'dev' | 'ino' | 'rdev' | 'blksize' | 'gid'> & {
  dev: bigint;
  ino: bigint;
};
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
class StatSnapshot {
  declare dev: bigint;
  declare ino: bigint;
  declare mode: number;
  declare nlink: number;
  declare uid: number;
  declare size: number;
  declare blocks: number;
  declare atimeMs: number;
  declare mtimeMs: number;
  declare ctimeMs: number;
  declare birthtimeMs: number;

  constructor(info: NodeStats) {
    const identity = exactIdentityParts(info);
    this.dev = identity.dev;
    this.ino = identity.ino;
    this.mode = Number(info.mode);
    this.nlink = Number(info.nlink);
    this.uid = Number(info.uid);
    this.size = Number(info.size);
    this.blocks = Number(info.blocks);
    this.atimeMs = 'atimeNs' in info ? milliseconds(info.atimeNs) : info.atimeMs;
    this.mtimeMs = 'mtimeNs' in info ? milliseconds(info.mtimeNs) : info.mtimeMs;
    this.ctimeMs = 'ctimeNs' in info ? milliseconds(info.ctimeNs) : info.ctimeMs;
    this.birthtimeMs = 'birthtimeNs' in info ? milliseconds(info.birthtimeNs) : info.birthtimeMs;
  }
}
// A fixed constructor avoids dictionary storage and eager Dates. Node supplies its type checks
// and lazy Date getters, including the same Math.round behavior as ordinary stats.
Object.setPrototypeOf(StatSnapshot.prototype, Stats.prototype);

export function fileStats(info: NodeStats): FileStats {
  return new StatSnapshot(info) as FileStats;
}

export async function lstat(file: PathLike): Promise<FileStats> {
  if (typeof file === 'string') assertLocalPath(file);
  return fileStats(await nodeLstat(file, { bigint: true }));
}

export async function stat(file: PathLike): Promise<FileStats> {
  if (typeof file === 'string') assertLocalPath(file);
  return fileStats(await nodeStat(file, { bigint: true }));
}

export async function fileStat(handle: FileHandle): Promise<FileStats> {
  return fileStats(await handle.stat({ bigint: true }));
}
