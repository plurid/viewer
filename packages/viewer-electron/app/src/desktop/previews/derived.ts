import { constants, type Stats } from 'node:fs';
import { open, realpath, lstat, type FileHandle } from 'node:fs/promises';
import { fileCoordination } from '../files/file-coordination';
import { previewContains } from './preview-work';
import { runProcessor } from '../transforms/process';
import { imageDimensions } from './image-dimensions';

export type DerivedMode = 'camera' | 'raw' | 'video';
export interface DerivedRendition {
  data: Buffer;
  extension: 'jpg' | 'mp4';
  kind: DerivedMode;
  decoder: string;
}
export interface DerivedLease {
  value: DerivedRendition;
  release(): void;
}
export interface Source {
  file: string;
  handle: FileHandle;
  info: Stats;
}
export type Decoder = (
  source: Source,
  mode: DerivedMode,
  signal: AbortSignal,
) => Promise<DerivedRendition>;
interface Cached {
  file: string;
  value: DerivedRendition;
  pins: number;
}
interface Pending {
  file: string;
  abort: AbortController;
  work: Promise<Cached>;
  users: number;
}
const version = (info: Stats) => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs];
const same = (a: Stats, b: Stats) => JSON.stringify(version(a)) === JSON.stringify(version(b));

/** Shared bounded bytes, never filesystem authority. Views pin entries until their
 * derived resource is released. Cancellation detaches one consumer independently. */
export class DerivedPreviews {
  private cached = new Map<string, Cached>();
  private pending = new Map<string, Pending>();
  private bytes = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private access: (files: readonly string[]) => Promise<void>,
    private decode: Decoder,
    private budget = 128 * 1024 * 1024,
  ) {}
  async read(file: string, mode: DerivedMode, signal: AbortSignal): Promise<DerivedLease> {
    signal.throwIfAborted();
    await this.access([file]);
    const actual = await realpath(file);
    await this.access([actual]);
    const before = await lstat(actual);
    if (
      !before.isFile() ||
      before.size > (mode === 'video' ? 4 * 1024 * 1024 * 1024 : 256 * 1024 * 1024)
    )
      throw new Error(
        'This file exceeds the local preview input limit. Open it in its original app.',
      );
    const key = JSON.stringify([actual, version(before), 'libraw-0.22.2/ffmpeg-9.0.2-v3', mode]);
    let entry = this.cached.get(key);
    if (entry) entry.pins++;
    if (!entry) {
      let pending = this.pending.get(key);
      if (pending?.abort.signal.aborted) pending = undefined;
      if (!pending) {
        if (this.pending.size >= 8)
          throw new Error('Too many local previews are opening. Close a preview and try again.');
        const abort = new AbortController();
        const item: Pending = {
          file: actual,
          abort,
          users: 0,
          work: Promise.resolve(undefined as never),
        };
        // One active expensive decoder. A cancelled queued job never starts.
        item.work = this.tail
          .catch(() => {})
          .then(async () => {
            abort.signal.throwIfAborted();
            const value = await fileCoordination.run(
              [{ path: actual, mode: 'read' }],
              async () => {
                await this.access([file, actual]);
                const handle = await open(
                  fileCoordination.path(actual),
                  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
                );
                try {
                  if (!same(before, await handle.stat()))
                    throw new Error('The source changed before decoding. Reopen its preview.');
                  const result = await this.decode(
                    { file: actual, handle, info: before },
                    mode,
                    abort.signal,
                  );
                  abort.signal.throwIfAborted();
                  if (
                    !same(before, await handle.stat()) ||
                    !same(before, await lstat(actual)) ||
                    actual !== (await realpath(file))
                  )
                    throw new Error('The source changed during decoding. Reopen its preview.');
                  await this.access([file, actual]);
                  return result;
                } finally {
                  await handle.close();
                }
              },
              abort.signal,
            );
            abort.signal.throwIfAborted();
            const limit = mode === 'video' ? 64 * 1024 * 1024 : 32 * 1024 * 1024;
            if (!value.data.length || value.data.length > limit)
              throw new Error('The derived preview exceeds its memory limit.');
            for (const [oldKey, old] of this.cached) {
              if (this.bytes + value.data.length <= this.budget) break;
              if (old.pins) continue;
              this.cached.delete(oldKey);
              this.bytes -= old.value.data.length;
            }
            if (this.bytes + value.data.length > this.budget)
              throw new Error(
                'The local preview cache is full. Close a rendered preview and try again.',
              );
            const saved = { file: actual, value, pins: 0 };
            this.cached.set(key, saved);
            this.bytes += value.data.length;
            return saved;
          })
          .finally(() => {
            if (this.pending.get(key) === item) this.pending.delete(key);
          });
        this.tail = item.work;
        this.pending.set(key, item);
        pending = item;
      }
      const item = pending;
      item.users++;
      entry = await new Promise<Cached>((resolve, reject) => {
        let done = false;
        const finish = (error?: unknown, value?: Cached) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', cancel);
          item.users--;
          if (!item.users) item.abort.abort();
          if (error) reject(error);
          else {
            value!.pins++;
            resolve(value!);
          }
        };
        const cancel = () => finish(signal.reason ?? new Error('Preview cancelled.'));
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        item.work.then((value) => finish(undefined, value), finish);
      });
    }
    // Even cache hits recheck authority and exact source identity.
    try {
      signal.throwIfAborted();
      await this.access([file, actual]);
      if (!same(before, await lstat(actual)) || actual !== (await realpath(file)))
        throw new Error('This source changed. Reopen its preview.');
      signal.throwIfAborted();
    } catch (error) {
      entry.pins--;
      throw error;
    }
    this.cached.delete(key);
    this.cached.set(key, entry);
    let held = true;
    return {
      value: entry.value,
      release: () => {
        if (held) {
          held = false;
          entry!.pins--;
        }
      },
    };
  }
  invalidate(root?: string) {
    for (const [key, item] of this.cached)
      if (!root || previewContains(root, item.file)) {
        // Released resources normally unpin first. A still pinned lease retains its
        // budget until its final release; it cannot become an uncounted allocation.
        if (!item.pins) {
          this.cached.delete(key);
          this.bytes -= item.value.data.length;
        }
      }
    for (const item of this.pending.values())
      if (!root || previewContains(root, item.file))
        item.abort.abort(new Error('Preview source invalidated.'));
  }
  async close() {
    this.invalidate();
    await Promise.allSettled([...this.pending.values()].map((item) => item.work));
    this.invalidate();
  }
}

export function rawDecoder(helper: string): Decoder {
  return async (source, mode, signal) => {
    if (mode === 'video') throw new Error('Video compatibility previews are unavailable.');
    const bytes = await runProcessor(helper, [mode], [source.handle.fd], signal, {
      timeout: 30000,
      outputLimit: 32 * 1024 * 1024 + 128,
    }).catch((error: Error) => {
      if (signal.aborted) throw signal.reason ?? new Error('RAW preview cancelled.');
      throw new Error(
        error.message.includes('timed out')
          ? 'RAW decoding exceeded 30 seconds. Retry or open the file in its original app.'
          : error.message.includes('output exceeded')
            ? 'This RAW rendition exceeds the 32 MB preview limit.'
            : 'This camera file could not be decoded. It may be damaged or use an unsupported RAW encoding. Open it in its original app.',
      );
    });
    const line = bytes.indexOf(10);
    if (line < 0 || line > 100) throw new Error('The RAW helper returned an invalid preview.');
    const metadata = JSON.parse(bytes.subarray(0, line).toString()) as { kind?: string };
    const data = bytes.subarray(line + 1),
      dimensions = imageDimensions(data);
    if (
      !['camera', 'raw'].includes(metadata.kind ?? '') ||
      !dimensions ||
      data[0] !== 255 ||
      data[1] !== 216 ||
      Math.max(dimensions.width, dimensions.height) > 4096
    )
      throw new Error('The RAW helper returned an invalid image.');
    return {
      data,
      extension: 'jpg',
      kind: metadata.kind as 'camera' | 'raw',
      decoder: 'LibRaw 0.22.2',
    };
  };
}
