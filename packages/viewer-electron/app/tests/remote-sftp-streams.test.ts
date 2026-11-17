import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteLimits } from '../src/domain/remote/limits';
import { pread, pwrite } from '../src/desktop/remote/sftp/streams';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';
import { sftpFixture, sftpTurn } from './support/sftp-fixture';

assertSafeSFTPAfterEach();
afterEach(() => vi.useRealTimers());

const b = (text: string): Buffer => Buffer.from(text);

describe('bounded pipelined SFTP streams', () => {
  it('round trips 100 MB through reordered replies with matching hashes and monotonic progress', async () => {
    const { client } = sftpFixture({ reorderReplies: true });
    await client.connect();
    const size = 100_000_000;
    const expected = createHash('sha256');
    function* source(): Generator<Buffer> {
      for (let offset = 0; offset < size; offset += 65536) {
        const chunk = Buffer.alloc(Math.min(size - offset, 65536));
        for (let index = 0; index < chunk.length; index++)
          chunk[index] = ((offset + index) * 31 + Math.floor((offset + index) / 257)) & 255;
        expected.update(chunk);
        yield chunk;
      }
    }
    const upload = await client.open(b('/home/large'), 'create');
    let writeProgress = 0n;
    let writePeak = 0;
    expect(
      await pwrite(client, upload, source(), {
        chunkBytes: 65536,
        concurrency: 128,
        onProgress: (bytes) => {
          expect(bytes > writeProgress).toBe(true);
          writeProgress = bytes;
        },
        onInFlight: (bytes) => {
          writePeak = Math.max(writePeak, bytes);
          expect(bytes).toBeLessThanOrEqual(remoteLimits.readBytesPerStream);
        },
      }),
    ).toBe(BigInt(size));
    expect(writeProgress).toBe(BigInt(size));
    await client.close(upload);
    const download = await client.open(b('/home/large'), 'read');
    const actual = createHash('sha256');
    let received = 0;
    let readProgress = 0n;
    let readPeak = 0;
    for await (const chunk of pread(client, download, {
      chunkBytes: 65536,
      concurrency: 128,
      length: BigInt(size),
      onProgress: (bytes) => {
        expect(bytes > readProgress).toBe(true);
        readProgress = bytes;
      },
      onInFlight: (bytes) => {
        readPeak = Math.max(readPeak, bytes);
        expect(bytes).toBeLessThanOrEqual(remoteLimits.readBytesPerStream);
      },
    })) {
      received += chunk.length;
      actual.update(chunk);
    }
    expect(received).toBe(size);
    expect(readProgress).toBe(BigInt(size));
    expect(actual.digest('hex')).toBe(expected.digest('hex'));
    expect(writePeak).toBe(remoteLimits.readBytesPerStream);
    expect(readPeak).toBe(remoteLimits.readBytesPerStream);
    await client.close(download);
  }, 30000);

  it('fills short reads in order, supports byte ranges and reads to EOF without a known length', async () => {
    const { client, server } = sftpFixture({ shortReadBytes: 7, reorderReplies: true });
    const content = Buffer.from(Array.from({ length: 8193 }, (_, index) => index & 255));
    server.file('/home/file', content);
    await client.connect();
    const handle = await client.open(b('/home/file'), 'read');
    const range: Buffer[] = [];
    for await (const chunk of pread(client, handle, {
      offset: 11n,
      length: 97n,
      chunkBytes: 32,
      concurrency: 4,
    }))
      range.push(chunk);
    expect(Buffer.concat(range)).toEqual(content.subarray(11, 108));
    const all: Buffer[] = [];
    for await (const chunk of pread(client, handle, {
      offset: 8000n,
      chunkBytes: 64,
      concurrency: 4,
    }))
      all.push(chunk);
    expect(Buffer.concat(all)).toEqual(content.subarray(8000));
    await client.close(handle);
  });

  it('honours negotiated read and write sizes without callers choosing a chunk size', async () => {
    const { client, server } = sftpFixture({
      limits: { packetLength: 256n, readLength: 111n, writeLength: 97n, openHandles: 0n },
    });
    await client.connect();
    const handle = await client.open(b('/home/file'), 'create');
    const content = Buffer.alloc(2001, 81);
    await pwrite(client, handle, [content]);
    await client.close(handle);
    const read = await client.open(b('/home/file'), 'read');
    const result: Buffer[] = [];
    for await (const chunk of pread(client, read, { length: BigInt(content.length) }))
      result.push(chunk);
    expect(Buffer.concat(result)).toEqual(content);
    expect(
      server.packets
        .filter((packet) => packet.request?.kind === 'write')
        .every((packet) => packet.request?.kind === 'write' && packet.request.data.length <= 97),
    ).toBe(true);
    expect(
      server.packets
        .filter((packet) => packet.request?.kind === 'read')
        .every((packet) => packet.request?.kind === 'read' && packet.request.length <= 111),
    ).toBe(true);
    await client.close(read);
  });

  it('supports empty streams and writes at an explicit offset', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const handle = await client.open(b('/home/file'), 'create');
    expect(await pwrite(client, handle, [])).toBe(0n);
    expect(await pwrite(client, handle, [b('abc'), b('def')], { offset: 3n, chunkBytes: 2 })).toBe(
      6n,
    );
    expect(server.bytes('/home/file')).toEqual(Buffer.from([0, 0, 0, 97, 98, 99, 100, 101, 102]));
    const chunks: Buffer[] = [];
    for await (const chunk of pread(client, handle, { length: 0n })) chunks.push(chunk);
    expect(chunks).toEqual([]);
    await client.close(handle);
  });

  it('owns queued upload bytes when an input iterator reuses its buffer', async () => {
    const { client, server } = sftpFixture({ reorderReplies: true });
    await client.connect();
    const handle = await client.open(b('/home/reused'), 'create');
    function* source(): Generator<Buffer> {
      const shared = Buffer.alloc(1024);
      for (let index = 0; index < 256; index++) {
        shared.fill(index);
        yield shared;
      }
    }
    await pwrite(client, handle, source(), { chunkBytes: 1024, concurrency: 128 });
    const actual = server.bytes('/home/reused');
    expect(actual.length).toBe(256 * 1024);
    for (let index = 0; index < 256; index++)
      expect(actual.subarray(index * 1024, (index + 1) * 1024)).toEqual(Buffer.alloc(1024, index));
    await client.close(handle);
  });

  it.each(['read', 'write'] as const)(
    'times out a stalled %s after exactly 60 seconds without progress',
    async (kind) => {
      const { client, server } = sftpFixture();
      server.file('/home/source', Buffer.alloc(200000));
      await client.connect();
      const handle = await client.open(
        b('/home/' + (kind === 'read' ? 'source' : 'output')),
        kind === 'read' ? 'read' : 'create',
      );
      server.holdReplies = true;
      vi.useFakeTimers();
      const transfer =
        kind === 'read'
          ? pread(client, handle).next()
          : pwrite(client, handle, [Buffer.alloc(200000)]);
      const rejected = expect(transfer).rejects.toMatchObject({ code: 'VIEWER_REMOTE_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(59999);
      expect(client.connected).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(client.connected).toBe(false);
    },
  );

  it('resets a shared stall clock on progress and permits a transfer longer than 60 seconds', async () => {
    const { client, server } = sftpFixture({ latencyMs: 1 });
    server.file('/home/source', b('abcd'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    vi.useFakeTimers();
    server.options.latencyMs = 40000;
    const stream = pread(client, handle, { length: 4n, chunkBytes: 1, concurrency: 1 });
    for (let index = 0; index < 4; index++) {
      const next = stream.next();
      await vi.advanceTimersByTimeAsync(40000);
      expect((await next).value).toEqual(b('abcd'[index]!));
    }
    expect((await stream.next()).done).toBe(true);
    expect(client.connected).toBe(true);
  });

  it.each(['read', 'write'] as const)(
    'cancels a %s in flight and drops late replies',
    async (kind) => {
      const { client, server } = sftpFixture();
      server.file('/home/source', Buffer.alloc(100000));
      await client.connect();
      const handle = await client.open(
        b('/home/' + (kind === 'read' ? 'source' : 'output')),
        kind === 'read' ? 'read' : 'create',
      );
      const controller = new AbortController();
      server.holdReplies = true;
      const result =
        kind === 'read'
          ? pread(client, handle, { signal: controller.signal }).next()
          : pwrite(client, handle, [Buffer.alloc(100000)], { signal: controller.signal });
      const cancelled = expect(result).rejects.toMatchObject({ code: 'ABORT_ERR' });
      await sftpTurn();
      controller.abort();
      await cancelled;
      expect(client.stats.abandoned).toBeGreaterThan(0);
      server.releaseReplies();
      await sftpTurn();
      expect(client.connected).toBe(true);
      expect(client.stats.inFlight).toBe(0);
      await client.close(handle);
    },
  );

  it('stops pulling uploads while the byte window is full and aborts a blocked producer', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const handle = await client.open(b('/home/output'), 'create');
    server.holdReplies = true;
    let pulled = 0;
    async function* source(): AsyncGenerator<Buffer> {
      for (let index = 0; index < 10000; index++) {
        pulled++;
        yield Buffer.alloc(65536);
      }
    }
    const controller = new AbortController();
    const cancelled = expect(
      pwrite(client, handle, source(), {
        concurrency: 128,
        chunkBytes: 65536,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await sftpTurn();
    expect(pulled).toBeLessThanOrEqual(129);
    expect(client.stats.inFlight).toBe(64);
    controller.abort();
    await cancelled;
    server.releaseReplies();
    await sftpTurn();
    expect(client.stats.queued).toBe(0);
    const blocked = new AbortController();
    const producer: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    };
    const rejection = expect(
      pwrite(client, handle, producer, { signal: blocked.signal }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    blocked.abort();
    await rejection;
  });

  it.each(['read', 'write'] as const)(
    'reports a mid-stream drop during %s without sending more work',
    async (kind) => {
      const { client, server } = sftpFixture({ dropAfterBytes: 128000 });
      server.file('/home/source', Buffer.alloc(1000000));
      await client.connect();
      const handle = await client.open(
        b('/home/' + (kind === 'read' ? 'source' : 'output')),
        kind === 'read' ? 'read' : 'create',
      );
      const result =
        kind === 'read'
          ? (async () => {
              for await (const chunk of pread(client, handle))
                expect(chunk.length).toBeGreaterThan(0);
            })()
          : pwrite(client, handle, [Buffer.alloc(1000000)]);
      await expect(result).rejects.toMatchObject({ code: 'VIEWER_REMOTE_OFFLINE' });
      expect(client.connected).toBe(false);
    },
  );

  it('aborts pending preads when the consumer stops early', async () => {
    const { client, server } = sftpFixture({ reorderReplies: true });
    server.file('/home/source', Buffer.alloc(1000000));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    for await (const chunk of pread(client, handle, { concurrency: 4 })) {
      expect(chunk.length).toBeGreaterThan(0);
      break;
    }
    await vi.waitFor(() => expect(client.stats.inFlight).toBe(0));
    expect(client.connected).toBe(true);
    await client.close(handle);
  });

  it('retires cancelled stream credits if the peer never sends late replies', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('content'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    vi.useFakeTimers();
    server.holdReplies = true;
    const controller = new AbortController();
    const stopped = expect(
      pread(client, handle, { signal: controller.signal, concurrency: 1 }).next(),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await stopped;
    expect(client.stats.abandoned).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.connected).toBe(false);
    expect(client.stats.inFlight).toBe(0);
  });

  it('propagates producer and progress-callback failures without unhandled pending rejections', async () => {
    const { client, server } = sftpFixture({ reorderReplies: true });
    server.file('/home/source', Buffer.alloc(100000));
    await client.connect();
    const handle = await client.open(b('/home/output'), 'create');
    const producer: Iterable<Buffer> = {
      [Symbol.iterator]: () => ({
        next: () => {
          throw new Error('Producer failed');
        },
      }),
    };
    await expect(pwrite(client, handle, producer)).rejects.toThrow('Producer failed');
    await expect(
      pwrite(client, handle, [Buffer.alloc(100000)], {
        onProgress: () => {
          throw new Error('Progress failed');
        },
      }),
    ).rejects.toThrow('Progress failed');
    const read = await client.open(b('/home/source'), 'read');
    await expect(
      pread(client, read, {
        onProgress: () => {
          throw new Error('Read progress failed');
        },
      }).next(),
    ).rejects.toThrow('Read progress failed');
    await vi.waitFor(() => expect(client.stats.inFlight).toBe(0));
    await client.close(handle);
    await client.close(read);
  });
});
