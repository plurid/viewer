import { Stats } from 'node:fs';
import { lstat as nodeLstat, stat as nodeStat } from 'node:fs/promises';
import type { BigIntStats, PathLike } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { exactIdentityParts } from '../../domain/files/item-identity';

export type FileStats = Omit<Stats, 'dev' | 'ino'> & { dev: bigint; ino: bigint };
type NodeStats = Stats | BigIntStats;

/** Identity must come from the same syscall as metadata. Keep sizes and timestamps in the
 * existing numeric API, but never pass device or inode through a JavaScript number. */
export function fileStats(info: NodeStats): FileStats {
  const identity = exactIdentityParts(info);
  const result = Object.create(Stats.prototype) as FileStats;
  for (const [key, value] of Object.entries(info)) {
    if (key === 'dev' || key === 'ino') continue;
    Object.defineProperty(result, key, {
      value: typeof value === 'bigint' ? Number(value) : value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  result.dev = identity.dev;
  result.ino = identity.ino;
  if ('mtimeNs' in info) {
    for (const name of ['atime', 'mtime', 'ctime', 'birthtime'] as const) {
      const ns = info[`${name}Ns`];
      const milliseconds = Number(ns / 1000000000n) * 1000 + Number(ns % 1000000000n) / 1e6;
      result[`${name}Ms`] = milliseconds;
      result[name] = new Date(milliseconds);
    }
  }
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
