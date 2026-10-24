import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { entry } from './filesystem';
import { fileCoordination } from './file-coordination';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import type { FileEntry } from '../../domain/contracts';

/**
 * SHA-256 of a regular file's contents (or of its first `limit` bytes), read without
 * following links under file coordination. A file that changes while it is read, or
 * no longer matches `item`, is reported rather than hashed.
 */
export async function contentHash(
  item: FileEntry,
  access: (files: readonly string[]) => Promise<void>,
  signal: AbortSignal,
  limit = Infinity,
): Promise<string> {
  await access([item.path]);
  return fileCoordination.run(
    [{ path: item.path, mode: 'read' }],
    async () => {
      const handle = await open(
        fileCoordination.path(item.path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error('A regular file is required for hashing.');
        const hash = createHash('sha256'),
          buffer = Buffer.alloc(256 * 1024),
          end = Math.min(info.size, limit);
        let offset = 0;
        while (offset < end) {
          signal.throwIfAborted();
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, end - offset),
            offset,
          );
          if (!bytesRead) throw new Error('The file changed during hashing.');
          hash.update(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (
          info.mtimeMs !== after.mtimeMs ||
          info.size !== after.size ||
          info.ctimeMs !== after.ctimeMs
        )
          throw new Error('The file changed during hashing.');
        await access([item.path]);
        if (!sameSourceVersion(sourceVersion(item), sourceVersion(await entry(item.path))))
          throw new Error('The file changed since it was listed. Run the check again.');
        return hash.digest('hex');
      } finally {
        await handle.close();
      }
    },
    signal,
  );
}
