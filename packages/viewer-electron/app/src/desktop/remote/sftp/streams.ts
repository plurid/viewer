import type { SFTPRequestOptions } from './client';
import { remoteLimits } from '../../../domain/remote/limits';
import { SFTPClient } from './client';
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

/** One clock covers the stream, so active transfers have no total or per-block deadline. */
class StreamLifetime {
  readonly controller = new AbortController();
  readonly request: SFTPRequestOptions = { signal: this.controller.signal, timeoutMs: null };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failure: Error | undefined;
  private bytes = 0n;
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
    else this.arm();
  }

  private readonly abort = (): void => {
    this.fail(sftpAbortError());
  };

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const error = new SFTPError('VIEWER_REMOTE_TIMEOUT', 'The server transfer made no progress.');
      this.fail(error);
      this.client.disconnect(error);
    }, this.stallMs);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    clearTimeout(this.timer);
    this.controller.abort();
    this.stop(error);
  }

  check(): void {
    if (this.failure) throw this.failure;
  }

  async wait<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.stopped]);
  }

  progress(bytes: number): void {
    if (this.failure || bytes === 0) return;
    this.bytes += BigInt(bytes);
    this.arm();
    this.options.onProgress?.(this.bytes);
  }

  finish(): void {
    clearTimeout(this.timer);
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
    Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 1024,
    'Invalid SFTP stream concurrency.',
  );
  protocolAssert(
    options.offset === undefined || (options.offset >= 0n && options.offset <= 0xffffffffffffffffn),
    'Invalid SFTP stream offset.',
  );
  return {
    chunk,
    concurrency: Math.min(concurrency, Math.floor(remoteLimits.readBytesPerStream / chunk)),
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
  const lifetime = new StreamLifetime(client, options);
  const blocks: ReadBlock[] = [];
  let reserved = 0;
  let eof = false;
  const launch = (offset: bigint, length: number): ReadBlock => {
    reserved += length;
    options.onInFlight?.(reserved);
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
        if (reserved + length > remoteLimits.readBytesPerStream) break;
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
        reserved -= block.length;
        options.onInFlight?.(reserved);
      }
    }
  } finally {
    lifetime.finish();
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
  const lifetime = new StreamLifetime(client, options);
  const blocks: WriteBlock[] = [];
  let offset = options.offset ?? 0n;
  const start = offset;
  let reserved = 0;
  let sourceDone = false;
  const retire = async (): Promise<void> => {
    const block = blocks.shift()!;
    const result = await lifetime.wait(block.result);
    reserved -= block.length;
    options.onInFlight?.(reserved);
    if (result.kind === 'error') throw result.error;
  };
  try {
    while (true) {
      const item = await lifetime.wait(Promise.resolve(iterator.next()));
      if (item.done) {
        sourceDone = true;
        break;
      }
      protocolAssert(Buffer.isBuffer(item.value), 'SFTP uploads require byte buffers.');
      for (let index = 0; index < item.value.length; index += chunk) {
        lifetime.check();
        const data = Buffer.from(item.value.subarray(index, index + chunk));
        while (
          blocks.length >= concurrency ||
          reserved + data.length > remoteLimits.readBytesPerStream
        )
          await retire();
        protocolAssert(
          offset + BigInt(data.length) <= 0xffffffffffffffffn,
          'Invalid SFTP write range.',
        );
        reserved += data.length;
        options.onInFlight?.(reserved);
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
