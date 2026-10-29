import { constants, type Stats } from 'node:fs';
import { open, realpath, lstat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { fileCoordination } from '../files/file-coordination';
import { previewContains } from './preview-work';
import { runProcessor } from '../transforms/process';
import { imageDimensions } from './image-dimensions';
import { PreviewDerivation, type PreviewDerivationKind } from '../../domain/previews/derivations';
import type { OfficeLayoutMetadata } from '../../domain/previews/documents/layout';
import { Slots } from './slots';

export type DerivedMode = PreviewDerivationKind;
export interface DerivedRendition {
  data: Buffer;
  extension: 'jpg' | 'mp4' | 'm4a' | 'png' | 'pdf';
  kind: DerivedMode;
  decoder: string;
  office?: OfficeLayoutMetadata;
}
export interface DerivedLease {
  value: DerivedRendition;
  release(): void;
}
export interface Source {
  file: string;
  handle: FileHandle;
  info: Stats;
  /** The extension the file is read as when its bytes, not its name, confirmed it. */
  format?: string;
}
export type Decoder = (
  source: Source,
  mode: DerivedMode,
  signal: AbortSignal,
  size?: number,
  variant?: string,
) => Promise<DerivedRendition>;
interface Cached {
  file: string;
  value: DerivedRendition;
  pins: number;
  retired: boolean;
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
  private readonly slots: Slots;
  /** `decoders` run at once: one for RAW and video, a few for small image renditions. */
  constructor(
    private access: (files: readonly string[]) => Promise<void>,
    private decode: Decoder,
    private budget = 128 * 1024 * 1024,
    decoders = 1,
  ) {
    this.slots = new Slots(decoders);
  }
  private unpin(entry: Cached): void {
    entry.pins--;
    if (!entry.pins && entry.retired) this.bytes -= entry.value.data.length;
  }
  private retire(key: string, entry: Cached): void {
    this.cached.delete(key);
    entry.retired = true;
    // Existing leases keep their allocation accounted until their final release.
    if (!entry.pins) this.bytes -= entry.value.data.length;
  }
  private wait(item: Pending, signal: AbortSignal): Promise<Cached> {
    item.users++;
    return new Promise<Cached>((resolve, reject) => {
      let done = false;
      const finish = (settle: () => void) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', cancel);
        item.users--;
        if (!item.users) item.abort.abort();
        settle();
      };
      const cancel = () => finish(() => reject(signal.reason ?? new Error('Preview cancelled.')));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      item.work.then(
        (value) =>
          finish(() => {
            if (value.retired) reject(new Error('Preview source invalidated.'));
            else {
              value.pins++;
              resolve(value);
            }
          }),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }
  async read(
    file: string,
    mode: DerivedMode,
    signal: AbortSignal,
    size = 4096,
    variant = '',
    format?: string,
  ): Promise<DerivedLease> {
    signal.throwIfAborted();
    if (variant.length > 200 || variant.includes('\0')) throw new Error('Invalid preview variant.');
    if (!Number.isInteger(size) || size < 1 || size > 4096)
      throw new Error('Choose a preview size between 1 and 4096 pixels.');
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
    const key = JSON.stringify([
      actual,
      version(before),
      'libraw-0.22.2/ffmpeg-9.0.2/imageio-v1',
      mode,
      size,
      variant,
      format ?? path.extname(actual).slice(1).toLowerCase(),
    ]);
    let entry = this.cached.get(key);
    if (entry) entry.pins++;
    if (!entry) {
      let pending = this.pending.get(key);
      if (pending?.abort.signal.aborted) pending = undefined;
      if (!pending) {
        if (this.pending.size >= 8)
          throw new Error('Too many local previews are opening. Close a preview and try again.');
        const abort = new AbortController();
        // A bounded number of active decoders. A cancelled queued job never starts.
        const work = this.slots
          .run(async () => {
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
                    { file: actual, handle, info: before, format },
                    mode,
                    abort.signal,
                    size,
                    variant,
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
              this.retire(oldKey, old);
            }
            if (this.bytes + value.data.length > this.budget)
              throw new Error(
                'The local preview cache is full. Close a rendered preview and try again.',
              );
            const saved: Cached = { file: actual, value, pins: 0, retired: false };
            this.cached.set(key, saved);
            this.bytes += value.data.length;
            return saved;
          })
          .finally(() => {
            if (this.pending.get(key) === item) this.pending.delete(key);
          });
        const item: Pending = { file: actual, abort, users: 0, work };
        this.pending.set(key, item);
        pending = item;
      }
      entry = await this.wait(pending, signal);
    }
    // Even cache hits recheck authority and exact source identity.
    try {
      signal.throwIfAborted();
      await this.access([file, actual]);
      if (!same(before, await lstat(actual)) || actual !== (await realpath(file)))
        throw new Error('This source changed. Reopen its preview.');
      signal.throwIfAborted();
      if (entry.retired) throw new Error('Preview source invalidated.');
    } catch (error) {
      this.unpin(entry);
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
          this.unpin(entry!);
        }
      },
    };
  }
  invalidate(root?: string) {
    for (const [key, item] of this.cached)
      if (!root || previewContains(root, item.file)) {
        this.retire(key, item);
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
    const metadata: unknown = JSON.parse(bytes.subarray(0, line).toString());
    const kind =
      metadata && typeof metadata === 'object' && 'kind' in metadata ? metadata.kind : undefined;
    const data = bytes.subarray(line + 1),
      dimensions = imageDimensions(data);
    if (
      (kind !== PreviewDerivation.Camera && kind !== PreviewDerivation.Raw) ||
      !dimensions ||
      data[0] !== 255 ||
      data[1] !== 216 ||
      Math.max(dimensions.width, dimensions.height) > 4096
    )
      throw new Error('The RAW helper returned an invalid image.');
    return {
      data,
      extension: 'jpg',
      kind,
      decoder: 'LibRaw 0.22.2',
    };
  };
}
