import { watchFile, unwatchFile } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { sameVersionItem } from '../files/item-identity';
import { fileStats } from '../files/stats';

export interface WatchFileChangesOptions {
  ctime?: boolean;
}

export function watchFileChanges(
  file: string,
  reload: () => void,
  interval = 500,
  options: WatchFileChangesOptions = {},
): () => void {
  const listener = (current: BigIntStats, previous: BigIntStats) => {
    if (
      current.mtimeMs !== previous.mtimeMs ||
      (options.ctime !== false && current.ctimeMs !== previous.ctimeMs) ||
      !sameVersionItem(fileStats(previous), fileStats(current)) ||
      current.size !== previous.size
    )
      reload();
  };
  watchFile(file, { bigint: true, persistent: false, interval }, listener);
  return () => unwatchFile(file, listener);
}
