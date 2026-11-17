import type { SFTPClient, SFTPRequestOptions } from './client';
import { remoteLimits } from '../../../domain/remote/limits';
import { protocolAssert, sftpBounds } from './codec';
import { sftpAbortError, SFTPError } from './errors';

export interface SFTPStreamOptions {
  offset?: bigint;
  signal?: AbortSignal;
  concurrency?: number;
  chunkBytes?: number;
  stallTimeoutMs?: number;
  onProgress?: (bytes: bigint) => void;
  onInFlight?: (bytes: number) => void;
}

export interface SFTPReadOptions extends SFTPStreamOptions {
  length?: bigint;
}

type ReadResult = { kind: 'data'; data: Buffer | undefined } | { kind: 'error'; error: unknown };
type WriteResult = { kind: 'done' } | { kind: 'error'; error: unknown };

export interface SFTPStreamActivity {
  sent: () => void;
  replied: () => void;
}

// Only a stream lifetime can mint request options that name a stream flow, so no other caller
// can leave the metadata flow and its queue budget.
const streamActivity: unique symbol = Symbol('SFTP stream activity');

type SFTPStreamRequestOptions = SFTPRequestOptions & {
  readonly [streamActivity]: SFTPStreamActivity;
};

/** The stream behind request options, when a stream lifetime made them. */
export function sftpStreamActivity(options: SFTPRequestOptions): SFTPStreamActivity | undefined {
  return (options as Partial<SFTPStreamRequestOptions>)[streamActivity];
}

/** Every stream on one channel, and the bytes they hold between them. */
interface ChannelStreams {
  streams: number;
  reserved: number;
}

const channels = new WeakMap<SFTPClient, ChannelStreams>();

/**
 * Streams on one channel split its byte budget evenly, each within its own window. A stream that
 * holds nothing may always take one block, so no stream waits on another and none is refused.
 */
class StreamBudget {
  private held = 0;
  private left = false;
  private readonly channel: ChannelStreams;

  constructor(client: SFTPClient) {
    let channel = channels.get(client);
    if (!channel) {
      channel = { streams: 0, reserved: 0 };
      channels.set(client, channel);
    }
    channel.streams++;
    this.channel = channel;
  }

  get reserved(): number {
    return this.held;
  }

  fits(bytes: number): boolean {
    if (this.held === 0) return true;
    const share = Math.min(
      remoteLimits.readBytesPerStream,
      Math.floor(sftpBounds.streamBytesPerChannel / this.channel.streams),
    );
    return (
      this.held + bytes <= share &&
      this.channel.reserved + bytes <= sftpBounds.streamBytesPerChannel
    );
  }

  take(bytes: number): void {
    this.held += bytes;
    this.channel.reserved += bytes;
  }

  give(bytes: number): void {
    this.held -= bytes;
    this.channel.reserved -= bytes;
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.channel.reserved -= this.held;
    this.held = 0;
    this.channel.streams--;
  }
}

/** One clock covers the stream, so active transfers have no total or per-block deadline. */
export class SFTPStreamLifetime {
  readonly controller = new AbortController();
  readonly request: SFTPStreamRequestOptions = {
    signal: this.controller.signal,
    timeoutMs: null,
    [streamActivity]: { sent: () => this.sent(), replied: () => this.replied() },
  };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failure: Error | undefined;
  private bytes = 0n;
  private waiting = 0;
  private outstanding = 0;
  private finished = false;
  private readonly stallMs: number;
  private readonly stopped: Promise<never>;
  private stop!: (error: Error) => void;

  constructor(
    private readonly client: SFTPClient,
    private readonly options: SFTPStreamOptions,
  ) {
    this.stallMs = options.stallTimeoutMs ?? remoteLimits.transferStallTimeoutMs;
    protocolAssert(
      Number.isFinite(this.stallMs) && this.stallMs > 0,
      'Invalid SFTP stall timeout.',
    );
    this.stopped = new Promise<never>((_resolve, reject) => {
      this.stop = reject;
    });
    // Rejections may happen while a consumer is between generator pulls.
    void this.stopped.catch(() => {});
    options.signal?.addEventListener('abort', this.abort, { once: true });
    if (options.signal?.aborted) this.abort();
  }

  private readonly abort = (): void => {
    this.fail(sftpAbortError());
  };

  private arm(): void {
    this.pause();
    if (this.waiting === 0 || this.outstanding === 0 || this.finished || this.failure) return;
    this.timer = setTimeout(() => {
      const error = new SFTPError('VIEWER_REMOTE_TIMEOUT', 'The server transfer made no progress.');
      this.fail(error);
      this.client.disconnect(error);
    }, this.stallMs);
  }

  private pause(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private sent(): void {
    this.outstanding++;
    if (this.waiting > 0 && this.timer === undefined) this.arm();
  }

  private replied(): void {
    this.outstanding--;
    if (this.outstanding === 0) {
      this.pause();
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.pause();
    this.controller.abort();
    this.stop(error);
  }

  check(): void {
    if (this.failure) throw this.failure;
  }

  async wait<T>(promise: Promise<T>, server = true): Promise<T> {
    if (server) {
      this.waiting++;
      this.arm();
    }
    try {
      return await Promise.race([promise, this.stopped]);
    } finally {
      if (server && --this.waiting === 0) this.pause();
    }
  }

  progress(bytes: number): void {
    if (this.failure || this.finished || bytes === 0) return;
    this.bytes += BigInt(bytes);
    if (this.waiting > 0) this.arm();
    this.options.onProgress?.(this.bytes);
  }

  finish(): void {
    this.finished = true;
    this.pause();
    this.options.signal?.removeEventListener('abort', this.abort);
    this.controller.abort();
  }
}

function streamShape(
  options: SFTPStreamOptions,
  maximumChunk: number,
): { chunk: number; concurrency: number } {
  const chunk = options.chunkBytes ?? Math.min(sftpBounds.defaultDataBytes, maximumChunk);
  const concurrency = options.concurrency ?? remoteLimits.requestsPerChannel;
  protocolAssert(
    Number.isInteger(chunk) && chunk > 0 && chunk <= maximumChunk,
    'Invalid SFTP stream chunk size.',
  );
  protocolAssert(
    Number.isSafeInteger(concurrency) && concurrency > 0,
    'Invalid SFTP stream concurrency.',
  );
  protocolAssert(
    options.offset === undefined || (options.offset >= 0n && options.offset <= 0xffffffffffffffffn),
    'Invalid SFTP stream offset.',
  );
  return {
    chunk,
    concurrency: Math.min(concurrency, remoteLimits.requestsPerChannel),
  };
}

interface ReadBlock {
  offset: bigint;
  length: number;
  result: Promise<ReadResult>;
}

/** Reordered replies are held in a bounded window and yielded in file order. Handles stay caller-owned. */
export async function* pread(
  client: SFTPClient,
  handle: Buffer,
  options: SFTPReadOptions = {},
): AsyncGenerator<Buffer> {
  const { chunk, concurrency } = streamShape(options, client.readChunkBytes);
  protocolAssert(
    options.length === undefined || (options.length >= 0n && options.length <= 0xffffffffffffffffn),
    'Invalid SFTP stream length.',
  );
  let next = options.offset ?? 0n;
  const end = options.length === undefined ? undefined : next + options.length;
  protocolAssert(end === undefined || end <= 0xffffffffffffffffn, 'Invalid SFTP stream range.');
  const lifetime = new SFTPStreamLifetime(client, options);
  const budget = new StreamBudget(client);
  const blocks: ReadBlock[] = [];
  let eof = false;
  const launch = (offset: bigint, length: number): ReadBlock => {
    budget.take(length);
    options.onInFlight?.(budget.reserved);
    return {
      offset,
      length,
      result: client
        .read(handle, offset, length, lifetime.request)
        .then((data): ReadResult => {
          lifetime.progress(data?.length ?? 0);
          return { kind: 'data', data };
        })
        .catch((error: unknown): ReadResult => ({ kind: 'error', error })),
    };
  };
  try {
    while (!eof) {
      lifetime.check();
      while (blocks.length < concurrency && (end === undefined || next < end)) {
        const length =
          end === undefined
            ? chunk
            : Number(end - next < BigInt(chunk) ? end - next : BigInt(chunk));
        if (!budget.fits(length)) break;
        blocks.push(launch(next, length));
        next += BigInt(length);
      }
      const block = blocks.shift();
      if (!block) break;
      let consumed = 0;
      try {
        let result = await lifetime.wait(block.result);
        while (true) {
          if (result.kind === 'error') throw result.error;
          if (result.data === undefined) {
            eof = true;
            break;
          }
          const data = result.data;
          consumed += data.length;
          yield data;
          lifetime.check();
          if (consumed === block.length) break;
          // A short DATA packet is not EOF; fill its gap before later offsets are yielded.
          result = await lifetime.wait(
            client
              .read(
                handle,
                block.offset + BigInt(consumed),
                block.length - consumed,
                lifetime.request,
              )
              .then((bytes): ReadResult => {
                lifetime.progress(bytes?.length ?? 0);
                return { kind: 'data', data: bytes };
              })
              .catch((error: unknown): ReadResult => ({ kind: 'error', error })),
          );
        }
      } finally {
        budget.give(block.length);
        options.onInFlight?.(budget.reserved);
      }
    }
  } finally {
    lifetime.finish();
    budget.leave();
    options.onInFlight?.(0);
  }
}

interface WriteBlock {
  length: number;
  result: Promise<WriteResult>;
}

/** Input backpressure and the same byte window bound uploads as well as reads. */
export async function pwrite(
  client: SFTPClient,
  handle: Buffer,
  source: AsyncIterable<Buffer> | Iterable<Buffer>,
  options: SFTPStreamOptions = {},
): Promise<bigint> {
  const { chunk, concurrency } = streamShape(options, client.writeChunkBytes(handle));
  const iterator =
    Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  const lifetime = new SFTPStreamLifetime(client, options);
  const budget = new StreamBudget(client);
  const blocks: WriteBlock[] = [];
  let offset = options.offset ?? 0n;
  const start = offset;
  let sourceDone = false;
  const retire = async (): Promise<void> => {
    const block = blocks.shift()!;
    const result = await lifetime.wait(block.result);
    budget.give(block.length);
    options.onInFlight?.(budget.reserved);
    if (result.kind === 'error') throw result.error;
  };
  try {
    while (true) {
      const item = await lifetime.wait(Promise.resolve(iterator.next()), false);
      if (item.done) {
        sourceDone = true;
        break;
      }
      protocolAssert(Buffer.isBuffer(item.value), 'SFTP uploads require byte buffers.');
      for (let index = 0; index < item.value.length; index += chunk) {
        lifetime.check();
        const length = Math.min(chunk, item.value.length - index);
        while (blocks.length >= concurrency || !budget.fits(length)) await retire();
        protocolAssert(
          offset + BigInt(length) <= 0xffffffffffffffffn,
          'Invalid SFTP write range.',
        );
        // Copied only once the block has room, so a waiting upload holds no second copy.
        const data = Buffer.from(item.value.subarray(index, index + length));
        budget.take(length);
        options.onInFlight?.(budget.reserved);
        blocks.push({
          length: data.length,
          result: client
            .write(handle, offset, data, lifetime.request)
            .then((): WriteResult => {
              lifetime.progress(data.length);
              return { kind: 'done' };
            })
            .catch((error: unknown): WriteResult => ({ kind: 'error', error })),
        });
        offset += BigInt(data.length);
      }
    }
    while (blocks.length) await retire();
    return offset - start;
  } finally {
    lifetime.finish();
    budget.leave();
    // A blocked producer must not keep cancellation waiting for another source value.
    if (!sourceDone && iterator.return) {
      try {
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        // Iterator cleanup must preserve the original transfer failure.
      }
    }
    options.onInFlight?.(0);
  }
}
