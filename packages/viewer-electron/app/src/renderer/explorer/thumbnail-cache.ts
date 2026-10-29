import type { FileEntry } from '../../domain/contracts';
import { pathContains } from '../../domain/files/paths';

/**
 * Thumbnails this window has received, so a tile scrolled back into view shows its picture at
 * once instead of asking the desktop again. Keyed by the file's version and the size shown.
 */
const cache = new Map<string, { path: string; url: string }>();
const pending = new Map<string, Promise<string>>();
let bytes = 0;
const limits = { entries: 512, bytes: 24_000_000 };

const keyOf = (entry: FileEntry, size: number) =>
  [entry.path, entry.identity, entry.modified, entry.size, size].join('\0');

function forget(key: string): void {
  const cached = cache.get(key);
  if (!cached) return;
  cache.delete(key);
  bytes -= cached.url.length;
}

export function cachedThumbnail(entry: FileEntry, size: number): string | undefined {
  const key = keyOf(entry, size);
  const cached = cache.get(key);
  if (!cached) return undefined;
  // most recently used last, so eviction takes the oldest
  cache.delete(key);
  cache.set(key, cached);
  return cached.url;
}

/** The thumbnail's data URL, asked of the desktop once however many tiles show it. */
export function thumbnail(entry: FileEntry, size: number): Promise<string> {
  const key = keyOf(entry, size);
  const cached = cachedThumbnail(entry, size);
  if (cached !== undefined) return Promise.resolve(cached);
  let request = pending.get(key);
  if (!request) {
    request = window.viewer.thumbnail(entry.path, size).then((url) => {
      forget(key);
      if (url) {
        cache.set(key, { path: entry.path, url });
        bytes += url.length;
        for (const old of cache.keys()) {
          if (cache.size <= limits.entries && bytes <= limits.bytes) break;
          forget(old);
        }
      }
      return url;
    });
    const settled = () => pending.delete(key);
    request.then(settled, settled);
    pending.set(key, request);
  }
  return request;
}

/** Drops what a revoked or changed folder showed; without a path, everything. */
export function invalidateThumbnails(root?: string): void {
  for (const [key, cached] of cache) if (!root || pathContains(root, cached.path)) forget(key);
}
