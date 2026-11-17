import type { SFTPRequest } from '../src/desktop/remote/sftp/codec';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeClientPacket,
  decodeListingName,
  encodeRequest,
  decodeReply,
  framed,
  sftpBounds,
  SFTPWriter,
} from '../src/desktop/remote/sftp/codec';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';
import { sftpFixture, sftpTurn } from './support/sftp-fixture';
import { pread, pwrite } from '../src/desktop/remote/sftp/streams';
import { SFTPProtocolError, sftpStatusError } from '../src/desktop/remote/sftp/errors';
import { remoteLimits } from '../src/domain/remote/limits';
import { encodeReply } from '../src/desktop/remote/sftp/codec';

assertSafeSFTPAfterEach();
afterEach(() => vi.useRealTimers());
const b = (text: string): Buffer => Buffer.from(text);

describe('OpenSSH listing compatibility', () => {
  it('skips exactly the two structural directory names at the listing boundary', () => {
    for (const name of ['.', '..']) {
      expect(decodeListingName({ filename: b(name), longname: b('directory'), attrs: {} })).toEqual(
        { kind: 'skip' },
      );
    }
    for (const name of ['', './', '../', 'a/b', 'a\0b']) {
      expect(decodeListingName({ filename: b(name), longname: b(''), attrs: {} }).kind).toBe(
        'error',
      );
    }
  });

  it('emits dot entries with directory attributes and longnames before empty-directory EOF', async () => {
    const { client } = sftpFixture();
    await client.connect();
    const handle = await client.opendir(b('/home'));
    const names = (await client.readdir(handle))!;
    expect(names.map((entry) => entry.filename)).toEqual([b('.'), b('..')]);
    for (const entry of names) {
      expect(entry.attrs.permissions! & 0o170000).toBe(0o040000);
      expect(entry.longname.length).toBeGreaterThan(0);
    }
    expect(await client.readdir(handle)).toBeUndefined();
    await client.close(handle);
  });
});

describe('bounded server-side copying', () => {
  it('splits a copy into positive bounded requests with progress and a stall deadline', async () => {
    const { client, server } = sftpFixture({}, { metadataTimeoutMs: 10 });
    const content = Buffer.alloc(2 * remoteLimits.readBytesPerStream + 3, 42);
    server.file('/home/source', content);
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    vi.useFakeTimers();
    server.options.latencyMs = 15;
    const progress: bigint[] = [];
    const result = client
      .copyData(source, 0n, BigInt(content.length), destination, 0n, {
        onProgress: (bytes: bigint) => progress.push(bytes),
      })
      .then(
        () => 'done',
        (error: unknown) => error,
      );
    // Two size reads, then each block and its destination size check: eight round trips.
    await vi.advanceTimersByTimeAsync(8 * 15);
    expect(await result).toBe('done');
    expect(progress).toEqual([
      BigInt(remoteLimits.readBytesPerStream),
      2n * BigInt(remoteLimits.readBytesPerStream),
      BigInt(content.length),
    ]);
    expect(server.packets.slice(-8).map((packet) => packet.request?.kind)).toEqual([
      'fstat',
      'fstat',
      'copyData',
      'fstat',
      'copyData',
      'fstat',
      'copyData',
      'fstat',
    ]);
    const requests = server.packets.flatMap((packet) =>
      packet.request?.kind === 'copyData' ? [packet.request] : [],
    );
    expect(requests).toHaveLength(3);
    expect(
      requests.every(
        (request) =>
          request.length > 0n && request.length <= BigInt(remoteLimits.readBytesPerStream),
      ),
    ).toBe(true);
    expect(server.bytes('/home/destination')).toEqual(content);
  });

  it('treats an explicit zero-length copy as empty instead of copying until EOF', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('must stay uncopied'));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    await client.copyData(source, 0n, 0n, destination, 0n);
    expect(server.bytes('/home/destination')).toEqual(b(''));
    expect(server.packets.some((packet) => packet.request?.kind === 'copyData')).toBe(false);
  });

  it('refuses a copy range past the source end before copying anything', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('0123456789'));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    const progress: bigint[] = [];
    for (const [offset, length] of [
      [0n, 100n],
      [5n, 6n],
    ] as const) {
      await expect(
        client.copyData(source, offset, length, destination, 0n, {
          onProgress: (bytes) => progress.push(bytes),
        }),
      ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_SHORT_SOURCE' });
    }
    expect(progress).toEqual([]);
    expect(server.packets.some((packet) => packet.request?.kind === 'copyData')).toBe(false);
    expect(server.bytes('/home/destination')).toEqual(b(''));
    await client.copyData(source, 4n, 6n, destination, 0n);
    expect(server.bytes('/home/destination')).toEqual(b('456789'));
    expect(client.connected).toBe(true);
  });

  it('fails a copy whose source shrinks while it is copied', async () => {
    const { client, server } = sftpFixture();
    const length = remoteLimits.readBytesPerStream + 3;
    const node = server.file('/home/source', Buffer.alloc(length, 42));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    server.replyOverride = (reply, request) => {
      // After the first block, the source loses the last two bytes the second block asks for.
      if (request.kind === 'copyData') node.size = remoteLimits.readBytesPerStream + 1;
      return reply;
    };
    await expect(
      client.copyData(source, 0n, BigInt(length), destination, 0n),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_SHORT_SOURCE' });
    expect(server.packets.filter((packet) => packet.request?.kind === 'copyData')).toHaveLength(2);
    expect(server.bytes('/home/destination').length).toBe(remoteLimits.readBytesPerStream + 1);
    expect(client.connected).toBe(true);
  });

  it('refuses server-side copying when the source size is not reported', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('abc'));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    server.replyOverride = (reply, request) => {
      if (request.kind !== 'fstat' || reply.kind !== 'attrs') return reply;
      const attrs = { ...reply.attrs };
      delete attrs.size;
      return { ...reply, attrs };
    };
    await expect(client.copyData(source, 0n, 3n, destination, 0n)).rejects.toMatchObject({
      code: 'ENOTSUP',
    });
    expect(server.packets.some((packet) => packet.request?.kind === 'copyData')).toBe(false);
  });

  it('times out a copy only when the server stops replying', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('abc'));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    server.holdReplies = true;
    vi.useFakeTimers();
    const outcome = client.copyData(source, 0n, 3n, destination, 0n, { stallTimeoutMs: 10 });
    const rejected = expect(outcome).rejects.toMatchObject({ code: 'VIEWER_REMOTE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(client.connected).toBe(false);
  });

  it('aborts a copy between bounded blocks and drops its late reply without failing unrelated work', async () => {
    const { client, server } = sftpFixture();
    const length = remoteLimits.readBytesPerStream + 1;
    server.file('/home/source', Buffer.alloc(length, 42));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/destination'), 'create');
    server.holdReplies = true;
    const controller = new AbortController();
    const copying = client.copyData(source, 0n, BigInt(length), destination, 0n, {
      signal: controller.signal,
    });
    const rejected = expect(copying).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await sftpTurn();
    // Both size reads answer, then the first block stays unanswered.
    server.releaseReply(0);
    await sftpTurn();
    server.releaseReply(0);
    await sftpTurn();
    expect(server.packets.at(-1)?.request?.kind).toBe('copyData');
    controller.abort();
    await rejected;
    const unrelated = client.lstat(b('/home/source'));
    await sftpTurn();
    server.releaseReplies();
    expect((await unrelated).size).toBe(BigInt(length));
    expect(server.packets.filter((packet) => packet.request?.kind === 'copyData')).toHaveLength(1);
    expect(client.stats.abandoned).toBe(0);
    expect(client.connected).toBe(true);
  });
});

describe('DATA payload and transfer window', () => {
  it.each(['read', 'write'] as const)(
    'bounds the %s byte window with requested concurrency 1024 and maximum DATA blocks',
    async (kind) => {
      const { client, server } = sftpFixture();
      server.file('/home/source', Buffer.alloc(2 * remoteLimits.readBytesPerStream));
      await client.connect();
      const handle = await client.open(
        b(kind === 'read' ? '/home/source' : '/home/output'),
        kind === 'read' ? 'read' : 'create',
      );
      const chunkBytes = kind === 'read' ? client.readChunkBytes : client.writeChunkBytes(handle);
      const controller = new AbortController();
      let peak = 0;
      server.holdReplies = true;
      const options = {
        chunkBytes,
        concurrency: 1024,
        signal: controller.signal,
        onInFlight: (bytes: number) => {
          peak = Math.max(peak, bytes);
        },
      };
      const result = (
        kind === 'read'
          ? pread(client, handle, options).next()
          : pwrite(client, handle, [Buffer.alloc(2 * remoteLimits.readBytesPerStream)], options)
      ).catch((error: unknown) => error);
      await sftpTurn();
      controller.abort();
      await result;
      expect(peak).toBeGreaterThan(remoteLimits.readBytesPerStream - chunkBytes);
      expect(peak).toBeLessThanOrEqual(remoteLimits.readBytesPerStream);
    },
  );

  it('aborts unresolved preads on an early break while no more replies arrive', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', Buffer.alloc(remoteLimits.readBytesPerStream));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    server.holdReplies = true;
    const consuming = (async () => {
      for await (const data of pread(client, handle, { concurrency: 4 })) {
        expect(data.length).toBeGreaterThan(0);
        break;
      }
    })();
    await sftpTurn();
    server.releaseReplies(false, 1);
    await consuming;
    expect(client.stats.inFlight).toBe(3);
    expect(client.stats.abandoned).toBe(3);
    server.releaseReplies();
    await vi.waitFor(() => expect(client.stats.inFlight).toBe(0));
    await client.close(handle);
  });
  it.each(['read', 'write'] as const)(
    'caps requested %s concurrency at channel credit with tiny blocks',
    async (kind) => {
      const { client, server } = sftpFixture();
      server.file('/home/source', Buffer.alloc(1024));
      await client.connect();
      const handle = await client.open(
        b(kind === 'read' ? '/home/source' : '/home/output'),
        kind === 'read' ? 'read' : 'create',
      );
      server.holdReplies = true;
      const controller = new AbortController();
      const options = { chunkBytes: 1, concurrency: 1024, signal: controller.signal };
      const result = (
        kind === 'read'
          ? pread(client, handle, options).next()
          : pwrite(client, handle, [Buffer.alloc(1024)], options)
      ).catch((error: unknown) => error);
      await sftpTurn();
      const reservedRequests = client.stats.inFlight + client.stats.queued;
      controller.abort();
      await result;
      expect(reservedRequests).toBe(remoteLimits.requestsPerChannel);
    },
  );
  it('accepts DATA and WRITE payloads up to 256 KiB independently of metadata strings', () => {
    const data = Buffer.alloc(256 * 1024);
    const packet = new SFTPWriter().byte(103).uint32(1).uint32(data.length).bytes(data).build();
    expect(decodeReply(packet)).toMatchObject({ kind: 'data', data });
    expect(() =>
      encodeRequest(1, { kind: 'write', handle: b('h'), offset: 0n, data }),
    ).not.toThrow();
  });

  it('fills the default 64-request window with 8 MiB of reserved reads', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/data', Buffer.alloc(8 * 1024 * 1024));
    await client.connect();
    const handle = await client.open(b('/home/data'), 'read');
    server.holdReplies = true;
    const controller = new AbortController();
    let peak = 0;
    const result = pread(client, handle, {
      signal: controller.signal,
      onInFlight: (bytes) => {
        peak = Math.max(peak, bytes);
      },
    })
      .next()
      .catch((error: unknown) => error);
    await sftpTurn();
    controller.abort();
    await result;
    expect(peak).toBe(8 * 1024 * 1024);
    expect(server.packets.filter((packet) => packet.type === 5)).toHaveLength(64);
  });
});

describe('explicit version and collision guards', () => {
  it('rejects a second VERSION with its explicit protocol error while work is pending', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    server.holdReplies = true;
    const rejection = expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
      message: 'Unexpected SFTP version packet.',
    });
    await server.send(encodeReply({ kind: 'version', version: 3, extensions: new Map() }));
    await rejection;
  });

  it('skips an ID that is still pending when the counter wraps', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    server.file('/home/a', b('a'));
    server.file('/home/b', b('bb'));
    await client.connect();
    server.holdReplies = true;
    const first = client.stat(b('/home/a'));
    // Accelerating the counter avoids billions of requests while preserving a real pending ID zero.
    Reflect.set(client, 'nextID', 0xffffffff);
    const second = client.stat(b('/home/b'));
    const third = client.stat(b('/home'));
    await sftpTurn();
    expect(server.packets.slice(1).map((packet) => packet.id)).toEqual([0, 0xffffffff, 1]);
    server.releaseReplies(true);
    expect((await first).size).toBe(1n);
    expect((await second).size).toBe(2n);
    expect((await third).permissions).toBe(0o40755);
  });
});

describe('outgoing allowlist and attribute allocation budget', () => {
  it.each([13, 15, 0, 255])('rejects framing packet type %i even from a new encoder', (type) => {
    expect(() => framed(new SFTPWriter().byte(type).uint32(1).string(b('/home/file')))).toThrow();
  });

  it.each([
    'posix-rename@openssh.com',
    'hardlink@openssh.com',
    'lsetstat@openssh.com',
    'unknown@example.org',
  ])('rejects framing an unapproved extension: %s', (name) => {
    expect(() => framed(new SFTPWriter().byte(200).uint32(1).string(b(name)))).toThrow();
  });

  it('checks the first byte of every writer against the packet-type allowlist', () => {
    const approved = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17, 18, 19, 20, 101, 102, 103, 104, 105, 200,
      201,
    ];
    for (let value = 0; value <= 255; value++) {
      const start = (): SFTPWriter => new SFTPWriter().byte(value);
      if (approved.includes(value)) expect(start).not.toThrow();
      else expect(start, 'packet type ' + value).toThrow(SFTPProtocolError);
    }
    // Later bytes are packet data, such as a STATUS code or an attribute byte.
    expect(() => new SFTPWriter().byte(101).byte(13).byte(15)).not.toThrow();
  });

  it('checks a framed body that did not start with a writer byte', () => {
    expect(() => framed(new SFTPWriter().bytes(Buffer.from([13])).uint32(1))).toThrow(
      SFTPProtocolError,
    );
  });

  it('keeps 128 extended attribute pairs per NAME packet and drops the rest', () => {
    const writer = new SFTPWriter().byte(104).uint32(1).uint32(2);
    for (const count of [64, 65]) {
      writer.string(b('name')).string(b('')).uint32(0x80000000).uint32(count);
      for (let index = 0; index < count; index++)
        writer.string(b('type-' + count + '-' + index)).string(b('value'));
    }
    const reply = decodeReply(writer.build());
    expect(reply.kind).toBe('name');
    const names = reply.kind === 'name' ? reply.names : [];
    expect(names.map((name) => name.attrs.extended?.length)).toEqual([64, 64]);
    expect(names[1]?.attrs.extended?.at(-1)?.type).toEqual(b('type-65-63'));
  });

  it('lists a server that attaches one extended attribute pair to every entry', async () => {
    const { client, server } = sftpFixture({ directoryEntries: 300, namesPerReply: 400 });
    await client.connect();
    const handle = await client.opendir(b('/home'));
    server.replyOverride = (reply) =>
      reply.kind === 'name'
        ? {
            ...reply,
            names: reply.names.map((name) => ({
              ...name,
              attrs: { ...name.attrs, extended: [{ type: b('acl'), data: b('x') }] },
            })),
          }
        : reply;
    const names = (await client.readdir(handle))!;
    expect(names).toHaveLength(302);
    expect(names.filter((name) => name.attrs.extended?.length === 1)).toHaveLength(128);
    expect(names.slice(128).every((name) => name.attrs.extended?.length === 0)).toBe(true);
    expect(client.connected).toBe(true);
    server.replyOverride = undefined;
    await client.close(handle);
  });
});

describe('fake server parity with OpenSSH metadata', () => {
  it('resolves a missing final REALPATH component with empty attributes', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    let attributes: unknown;
    server.replyOverride = (reply) => {
      if (reply.kind === 'name') attributes = reply.names[0]?.attrs;
      return reply;
    };
    expect(await client.realpath(b('/home/missing'))).toEqual(b('/home/missing'));
    expect(attributes).toEqual({});
  });

  it('opens a directory as a file handle and fails its READ', async () => {
    const { client } = sftpFixture();
    await client.connect();
    const handle = await client.open(b('/home'), 'read');
    await expect(client.read(handle, 0n, 1)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await client.close(handle);
  });

  it('maps read-only handles, loops and read-only filesystems to the real status codes', async () => {
    const { client, server } = sftpFixture({ subtrees: [{ path: '/readonly', readOnly: true }] });
    server.directory('/readonly');
    server.file('/home/file', b('x'));
    server.link('/home/loop', 'loop');
    await client.connect();
    const handle = await client.open(b('/home/file'), 'read');
    await expect(client.write(handle, 0n, b('x'))).rejects.toMatchObject({
      code: 'ENOENT',
      status: 2,
    });
    await expect(client.stat(b('/home/loop'))).rejects.toMatchObject({ code: 'ENOENT', status: 2 });
    await expect(client.open(b('/readonly/new'), 'create')).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      status: 4,
    });
    await client.close(handle);
  });

  it('uses generic status text for quota failures', async () => {
    const { client } = sftpFixture({ quotaBytes: 0 });
    await client.connect();
    const handle = await client.open(b('/home/file'), 'create');
    const error = await client.write(handle, 0n, b('x')).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'VIEWER_REMOTE_FAILURE', status: 4, message: 'Failure' });
    await client.close(handle);
  });

  it('answers every status with the OpenSSH text for its code', async () => {
    const { client, server } = sftpFixture({
      // The file and the link's target text hold five bytes, so an eight-byte write is over quota.
      quotaBytes: 10,
      subtrees: [{ path: '/readonly', readOnly: true }],
    });
    server.directory('/readonly');
    server.file('/home/file', b('x'));
    server.link('/home/loop', 'loop');
    await client.connect();
    const statuses: { status: number; message: string }[] = [];
    server.replyOverride = (reply) => {
      if (reply.kind === 'status')
        statuses.push({ status: reply.status, message: reply.message.toString() });
      return reply;
    };
    const settle = (work: Promise<unknown>): Promise<unknown> => work.catch(() => undefined);
    await settle(client.open(b('/home/file'), 'create'));
    await settle(client.opendir(b('/home/file')));
    await settle(client.stat(b('/home/missing')));
    await settle(client.stat(b('/home/loop')));
    await settle(client.open(b('/readonly/new'), 'create'));
    await settle(client.mkdir(b('/home/file')));
    await settle(client.readlink(b('/home/file')));
    await settle(client.close(b('none')));
    const read = await client.open(b('/home/file'), 'read');
    await settle(client.read(read, 5n, 1));
    await settle(client.write(read, 0n, b('y')));
    await client.close(read);
    const output = await client.open(b('/home/output'), 'create');
    await settle(client.write(output, 0n, b('too long')));
    await client.close(output);
    const folder = await client.opendir(b('/home'));
    let page = await client.readdir(folder);
    while (page) page = await client.readdir(folder);
    await client.close(folder);
    const text = [
      'Success',
      'End of file',
      'No such file',
      'Permission denied',
      'Failure',
      'Bad message',
      'No connection',
      'Connection lost',
      'Operation unsupported',
    ];
    expect(new Set(statuses.map((entry) => entry.status))).toEqual(new Set([0, 1, 2, 4]));
    for (const entry of statuses) expect(entry.message).toBe(text[entry.status]);
  });

  it('ignores wire OPEN times and applies its creation umask', async () => {
    const { client, server, wire } = sftpFixture();
    await client.connect();
    server.holdReplies = true;
    const body = new SFTPWriter()
      .byte(3)
      .uint32(99)
      .string(b('/home/new'))
      .uint32(42)
      .uint32(12)
      .uint32(0o666)
      .uint32(123)
      .uint32(456)
      .build();
    wire.write(new SFTPWriter().uint32(body.length).bytes(body).build());
    await sftpTurn();
    expect(server.nodes.get('/home/new')?.attrs).toMatchObject({ permissions: 0o100644 });
    expect(server.nodes.get('/home/new')?.attrs.mtime).not.toBe(456);
  });

  it('applies the creation umask to MKDIR and ignores wire MKDIR times', async () => {
    const { client, server, wire } = sftpFixture();
    await client.connect();
    await client.mkdir(b('/home/open'), { permissions: 0o777 });
    await client.mkdir(b('/home/default'));
    expect(server.nodes.get('/home/open')?.attrs.permissions).toBe(0o40755);
    expect(server.nodes.get('/home/default')?.attrs.permissions).toBe(0o40755);
    server.holdReplies = true;
    const body = new SFTPWriter()
      .byte(14)
      .uint32(99)
      .string(b('/home/timed'))
      .uint32(12)
      .uint32(0o700)
      .uint32(123)
      .uint32(456)
      .build();
    wire.write(new SFTPWriter().uint32(body.length).bytes(body).build());
    await sftpTurn();
    expect(server.nodes.get('/home/timed')?.attrs).toMatchObject({ permissions: 0o40700 });
    expect(server.nodes.get('/home/timed')?.attrs.mtime).not.toBe(456);
  });

  it.each(['dangling', 'loop'])(
    'answers NO_SUCH_FILE when a raw RENAME moves a folder onto a %s link',
    async (kind) => {
      const { client, server, wire } = sftpFixture();
      const folder = server.directory('/home/source');
      const link = server.link('/home/destination', kind === 'loop' ? 'destination' : 'missing');
      await client.connect();
      const statuses: number[] = [];
      server.replyOverride = (reply) => {
        if (reply.kind === 'status') statuses.push(reply.status);
        return reply;
      };
      server.holdReplies = true;
      wire.write(
        encodeRequest(99, { kind: 'rename', from: b('/home/source'), to: b('/home/destination') }),
      );
      await sftpTurn();
      expect(statuses).toEqual([2]);
      expect(server.nodes.get('/home/source')).toBe(folder);
      expect(server.nodes.get('/home/destination')).toBe(link);
    },
  );

  it('answers BAD_MESSAGE when a folder is renamed into itself', async () => {
    const { client, server } = sftpFixture();
    const folder = server.directory('/home/folder');
    await client.connect();
    await expect(client.rename(b('/home/folder'), b('/home/folder/inside'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      status: 5,
      message: 'Bad message',
    });
    expect(server.nodes.get('/home/folder')).toBe(folder);
  });

  it('frees the handle slot when a CLOSE fails through a status override', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const first = await client.opendir(b('/home'));
    server.statusOverride = { status: 4, message: 'Close failed' };
    await expect(client.close(first)).rejects.toMatchObject({ message: 'Close failed' });
    server.statusOverride = undefined;
    expect(server.handles.size).toBe(0);
    const reused = await client.opendir(b('/home'));
    expect(reused).toEqual(first);
    await client.close(reused);
  });

  it('does not encode ignored OPEN time attributes', () => {
    expect(() =>
      encodeRequest(1, {
        kind: 'open',
        path: b('/home/new'),
        mode: 'create',
        attrs: { permissions: 0o600, times: { atime: 1, mtime: 2 } },
      } as unknown as SFTPRequest),
    ).toThrow();
  });

  it('does not send ignored MKDIR time attributes', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const before = server.packets.length;
    await expect(
      client.mkdir(b('/home/timed'), {
        permissions: 0o700,
        times: { atime: 1, mtime: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_PROTOCOL' });
    expect(server.packets).toHaveLength(before);
    expect(server.nodes.has('/home/timed')).toBe(false);
    expect(client.connected).toBe(true);
  });

  it('keeps inherited time attributes out of OPEN packets', () => {
    const attrs = Object.assign(Object.create({ times: { atime: 1, mtime: 2 } }), {
      permissions: 0o600,
    });
    const bytes = encodeRequest(1, { kind: 'open', path: b('/home/new'), mode: 'create', attrs });
    const decoded = decodeClientPacket(bytes.subarray(4));
    expect(
      decoded.kind === 'request' && decoded.request.kind === 'open' && decoded.request.attrs,
    ).toEqual({ permissions: 0o600 });
  });

  it('advertises the OpenSSH extension set and packet/data limits', async () => {
    const { client } = sftpFixture();
    await client.connect();
    expect(
      [...client.extensions].map(([name, version]) => [name, version.toString()]).sort(),
    ).toEqual(
      [
        ['statvfs@openssh.com', '2'],
        ['fstatvfs@openssh.com', '2'],
        ['fsync@openssh.com', '1'],
        ['limits@openssh.com', '1'],
        ['expand-path@openssh.com', '1'],
        ['copy-data', '1'],
        ['home-directory', '1'],
        ['users-groups-by-id@openssh.com', '1'],
      ].sort(),
    );
    expect(client.serverLimits).toMatchObject({
      packetLength: 262144n,
      readLength: 261120n,
      writeLength: 261120n,
    });
  });
});

describe('plain v3 and hostile metadata boundaries', () => {
  it('accepts READLINK on plain v3 without OpenSSH extension evidence', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    server.link('/home/link', 'file');
    await client.connect();
    expect(await client.readlink(b('/home/link'))).toEqual(b('file'));
  });

  it('falls back to unspecified limits when the advertised extension returns an error', async () => {
    const { client, server } = sftpFixture();
    server.replyOverride = (reply, request) =>
      request.kind === 'limits' && reply.kind !== 'version'
        ? { kind: 'status', id: reply.id, status: 8, message: b('Unsupported'), language: b('') }
        : reply;
    await client.connect();
    expect(client.serverLimits).toEqual({
      packetLength: 0n,
      readLength: 0n,
      writeLength: 0n,
      openHandles: 0n,
    });
    expect(client.connected).toBe(true);
  });

  it('rejects an empty NAME reply to READDIR', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const handle = await client.opendir(b('/home'));
    server.replyOverride = (reply, request) =>
      request.kind === 'readdir' && reply.kind !== 'version'
        ? { kind: 'name', id: reply.id, names: [] }
        : reply;
    await expect(client.readdir(handle)).rejects.toMatchObject({ code: 'VIEWER_REMOTE_PROTOCOL' });
    expect(client.connected).toBe(false);
  });

  it.each([
    ['realpath', 'relative'],
    ['realpath', '/nul\0path'],
    ['readlink', 'nul\0target'],
  ] as const)('validates %s returned path bytes: %s', async (kind, filename) => {
    const { client, server } = sftpFixture();
    await client.connect();
    server.replyOverride = (reply) =>
      reply.kind === 'version'
        ? reply
        : {
            kind: 'name',
            id: reply.id,
            names: [{ filename: b(filename), longname: b(''), attrs: {} }],
          };
    await expect(client[kind](b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    expect(client.connected).toBe(false);
  });

  it('bounds sanitized error text while preserving separate raw bytes', () => {
    const raw = b('\u001b[31m\u202euntrusted\n' + 'x'.repeat(3000));
    const error = sftpStatusError(4, raw);
    expect(error.message).not.toMatch(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
    expect([...error.message].length).toBeLessThanOrEqual(2000);
    expect(error).toHaveProperty('rawMessage', raw);
  });

  it('strips format, separator and default-ignorable characters from error text', () => {
    const hidden = [
      '\u00ad',
      '\u034f',
      '\u0600',
      '\u061c',
      '\u115f',
      '\u180e',
      '\u200b',
      '\u200d',
      '\u2028',
      '\u2029',
      '\u2060',
      '\u2066',
      '\u3164',
      '\ufe0f',
      '\ufeff',
      '\ufff9',
      '\ufffb',
      '\u{e0001}',
      '\u{e0041}',
    ];
    const raw = b('No' + hidden.join('') + ' such ' + hidden.join('x') + ' file');
    const error = sftpStatusError(2, raw);
    expect(error.message).toBe('No such ' + 'x'.repeat(hidden.length - 1) + ' file');
    expect(error.rawMessage).toEqual(raw);
    expect(sftpStatusError(4, b('\u2028\u200b\ufeff')).message).toBe(
      'The server rejected the request.',
    );
  });
});

describe('wire deadlines and handle admission', () => {
  it('keeps a reused handle when an older CLOSE reply arrives after the new OPEN reply', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const first = await client.opendir(b('/home'));
    server.holdReplies = true;
    const closed = client.close(first).then(
      () => 'closed',
      (error: unknown) => error,
    );
    const reopened = client.opendir(b('/home')).then(
      (handle) => ({ handle }),
      (error: unknown) => ({ error }),
    );
    await sftpTurn();
    server.releaseReplies(true);
    const result = await reopened;
    expect(result).toEqual({ handle: first });
    expect(await closed).toBe('closed');
    expect(client.stats.handles).toBe(1);
    if ('handle' in result) await client.close(result.handle);
    expect(client.stats.handles).toBe(0);
  });
  it('reuses a four-byte handle slot after a failed CLOSE without losing the new handle', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const first = await client.opendir(b('/home'));
    expect(first.length).toBe(4);
    server.replyOverride = (reply, request) =>
      request.kind === 'close' && reply.kind === 'status' ? { ...reply, status: 4 } : reply;
    await expect(client.close(first)).rejects.toMatchObject({ code: 'VIEWER_REMOTE_FAILURE' });
    expect(client.stats.handles).toBe(0);
    const reused = await client.opendir(b('/home'));
    expect(reused).toEqual(first);
    expect(client.connected).toBe(true);
    server.replyOverride = undefined;
    await client.close(reused);
  });
  it('starts a fresh wire deadline after spending most of the queue deadline waiting', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    vi.useFakeTimers();
    server.holdReplies = true;
    const blockers = Array.from({ length: 64 }, () => client.stat(b('/home'), { timeoutMs: 1000 }));
    const result = client.stat(b('/home'), { timeoutMs: 50 }).then(
      (attrs) => ({ attrs }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(40);
    server.releaseReplies();
    server.holdReplies = true;
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(blockers);
    expect(client.stats.inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(11);
    expect(client.connected).toBe(true);
    server.releaseReplies();
    expect(await result).toHaveProperty('attrs');
  });

  it('queues an open until a close frees a slot without blocking that close', async () => {
    const { client, server } = sftpFixture({
      limits: { packetLength: 262144n, readLength: 261120n, writeLength: 261120n, openHandles: 1n },
    });
    await client.connect();
    const handle = await client.opendir(b('/home'));
    const outcome = client.opendir(b('/home')).then(
      (value) => ({ handle: value }),
      (error: unknown) => ({ error }),
    );
    await sftpTurn();
    expect(client.stats.queued).toBe(1);
    expect(server.packets.filter((packet) => packet.type === 11)).toHaveLength(1);
    await client.close(handle);
    const result = await outcome;
    expect(result).toHaveProperty('handle');
    if ('handle' in result) await client.close(result.handle);
  });
});

describe('cancelled handle ownership', () => {
  it.each(['open', 'opendir'] as const)(
    'closes a late %s handle without failing unrelated work',
    async (kind) => {
      const { client, server } = sftpFixture();
      await client.connect();
      server.holdReplies = true;
      const controller = new AbortController();
      const cancelled =
        kind === 'open'
          ? client.open(b('/home/new'), 'create', {}, { signal: controller.signal })
          : client.opendir(b('/home'), { signal: controller.signal });
      const rejection = expect(cancelled).rejects.toMatchObject({ code: 'ABORT_ERR' });
      const other = client.lstat(b('/home')).then(
        (attrs) => ({ attrs }),
        (error: unknown) => ({ error }),
      );
      await sftpTurn();
      controller.abort();
      await rejection;
      server.releaseReplies();
      expect(await other).toMatchObject({ attrs: { permissions: 0o40755 } });
      await vi.waitFor(() => expect(client.stats.handles).toBe(0));
      expect(client.connected).toBe(true);
      expect(server.packets.filter((packet) => packet.type === 4)).toHaveLength(1);
    },
  );

  it('closes a late handle first, even when the request queue is full', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    server.holdReplies = true;
    const controller = new AbortController();
    const rejection = expect(
      client.open(b('/home/new'), 'create', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    const blockers = Array.from(
      { length: remoteLimits.requestsPerChannel - 1 + sftpBounds.queueRequests },
      () => client.stat(b('/home'), { timeoutMs: null }),
    );
    expect(client.stats).toMatchObject({
      inFlight: remoteLimits.requestsPerChannel,
      queued: sftpBounds.queueRequests,
    });
    controller.abort();
    await rejection;
    await sftpTurn();
    server.releaseReply(0);
    await vi.waitFor(() =>
      expect(server.packets).toHaveLength(2 + remoteLimits.requestsPerChannel),
    );
    expect(server.packets.at(-1)?.type).toBe(4);
    server.releaseReplies();
    await Promise.all(blockers);
    await vi.waitFor(() => expect(client.stats.handles).toBe(0));
    expect(client.connected).toBe(true);
  });
});

describe('server stall clock and local backpressure', () => {
  it('resets the server clock on out-of-order progress while the first read is still pending', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('abc'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    vi.useFakeTimers();
    server.holdReplies = true;
    const stream = pread(client, handle, { chunkBytes: 1, concurrency: 3, length: 3n });
    const first = stream.next().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(40000);
    server.releaseReply(2);
    await vi.advanceTimersByTimeAsync(40000);
    server.releaseReply(1);
    await vi.advanceTimersByTimeAsync(40000);
    server.releaseReply(0);
    expect(await first).toMatchObject({ result: { value: b('a') } });
    expect((await stream.next()).value).toEqual(b('b'));
    expect((await stream.next()).value).toEqual(b('c'));
    expect((await stream.next()).done).toBe(true);
    expect(client.connected).toBe(true);
  });
  it('does not start a server stall deadline while its requests are waiting for channel credit', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('x'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    vi.useFakeTimers();
    server.holdReplies = true;
    const blockers = Promise.all(
      Array.from({ length: 64 }, () => client.stat(b('/home'), { timeoutMs: 1000 })),
    ).catch((error: unknown) => error);
    const controller = new AbortController();
    const result = pread(client, handle, {
      signal: controller.signal,
      concurrency: 1,
      stallTimeoutMs: 10,
    })
      .next()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(client.connected).toBe(true);
    expect(client.stats.queued).toBe(1);
    controller.abort();
    expect(await result).toMatchObject({ code: 'ABORT_ERR' });
    server.releaseReplies();
    await blockers;
    await client.close(handle);
  });
  it('pauses the clock while a pread consumer holds a yielded buffer', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/data', b('abcdef'));
    await client.connect();
    const handle = await client.open(b('/home/data'), 'read');
    vi.useFakeTimers();
    const stream = pread(client, handle, {
      concurrency: 2,
      chunkBytes: 2,
      length: 6n,
      stallTimeoutMs: 10,
    });
    expect((await stream.next()).value).toEqual(b('ab'));
    await vi.advanceTimersByTimeAsync(100);
    expect(client.connected).toBe(true);
    expect((await stream.next()).value).toEqual(b('cd'));
    await stream.return(undefined);
  });

  it('pauses the clock while pwrite awaits a local source', async () => {
    const { client } = sftpFixture();
    await client.connect();
    const handle = await client.open(b('/home/data'), 'create');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* source(): AsyncGenerator<Buffer> {
      yield b('ab');
      await gate;
      yield b('cd');
    }
    vi.useFakeTimers();
    const outcome = pwrite(client, handle, source(), { stallTimeoutMs: 10 }).then(
      (bytes) => ({ bytes }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(client.connected).toBe(true);
    release();
    expect(await outcome).toEqual({ bytes: 4n });
  });

  it('keeps the clock paused while pwrite waits for its source with a write unanswered', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const handle = await client.open(b('/home/data'), 'create');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* source(): AsyncGenerator<Buffer> {
      yield b('ab');
      await gate;
      yield b('cd');
    }
    vi.useFakeTimers();
    server.holdReplies = true;
    const outcome = pwrite(client, handle, source(), { stallTimeoutMs: 10 }).then(
      (bytes) => ({ bytes }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(client.stats.inFlight).toBe(1);
    expect(client.connected).toBe(true);
    release();
    server.releaseReplies();
    expect(await outcome).toEqual({ bytes: 4n });
  });

  it('keeps the clock paused while the consumer holds a block and a slow server keeps delivering', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('abc'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    vi.useFakeTimers();
    server.holdReplies = true;
    const stream = pread(client, handle, {
      chunkBytes: 1,
      concurrency: 3,
      length: 3n,
      stallTimeoutMs: 10,
    });
    const first = stream.next();
    await vi.advanceTimersByTimeAsync(0);
    server.releaseReply(0);
    expect((await first).value).toEqual(b('a'));
    await vi.advanceTimersByTimeAsync(5);
    server.releaseReply(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(client.connected).toBe(true);
    server.releaseReplies();
    expect((await stream.next()).value).toEqual(b('b'));
    expect((await stream.next()).value).toEqual(b('c'));
    expect((await stream.next()).done).toBe(true);
  });

  it('pauses the clock when the last wire block ends while the next block waits for credit', async () => {
    const { client, server } = sftpFixture({ shortReadBytes: 1 });
    server.file('/home/source', b('ab'));
    server.file('/home/other', b('other'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    const other = await client.open(b('/home/other'), 'read');
    vi.useFakeTimers();
    server.holdReplies = true;
    const blockers = Array.from({ length: remoteLimits.requestsPerChannel - 1 }, () =>
      client.stat(b('/home'), { timeoutMs: null }),
    );
    const stream = pread(client, handle, { chunkBytes: 2, concurrency: 2, stallTimeoutMs: 10 });
    const first = stream.next();
    await vi.advanceTimersByTimeAsync(0);
    // The first block takes the last credit and comes back short; its answer frees the credit
    // for the second block, the end-of-file read, which stays unanswered.
    server.releaseReply(remoteLimits.requestsPerChannel - 1);
    expect((await first).value).toEqual(b('a'));
    // A competitor starts on the stream's turn and queues before the gap read, so it wins the tie.
    const competing = pread(client, other, { chunkBytes: 1, concurrency: 2 });
    const competitor = competing.next();
    const second = stream.next().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(client.stats.queued).toBe(3);
    // The end-of-file answer frees the credit for the competitor; the gap read waits for credit.
    server.releaseReply(remoteLimits.requestsPerChannel - 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(client.stats.queued).toBe(2);
    expect(client.connected).toBe(true);
    server.releaseReplies();
    expect(await second).toMatchObject({ result: { value: b('b') } });
    expect((await stream.next()).done).toBe(true);
    expect((await competitor).value).toEqual(b('o'));
    await competing.return(undefined);
    await Promise.all(blockers);
  });

  it('starts the clock when a block leaves the credit queue while the consumer waits', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('x'));
    await client.connect();
    const handle = await client.open(b('/home/source'), 'read');
    vi.useFakeTimers();
    server.holdReplies = true;
    const blockers = Array.from({ length: remoteLimits.requestsPerChannel }, () =>
      client.stat(b('/home'), { timeoutMs: null }),
    );
    const result = pread(client, handle, { concurrency: 1, stallTimeoutMs: 10 })
      .next()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.stats.queued).toBe(1);
    // Only the blockers answer; the stream's read is then written and never answered.
    server.releaseReplies(false, remoteLimits.requestsPerChannel);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.stats.queued).toBe(0);
    await vi.advanceTimersByTimeAsync(9);
    expect(client.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.connected).toBe(false);
    expect(await result).toMatchObject({ code: 'VIEWER_REMOTE_TIMEOUT' });
    await Promise.all(blockers);
  });
});

describe('OpenSSH rename compatibility', () => {
  it.each(
    ['file', 'directory', 'symlink', 'fifo', 'socket'].flatMap((source) =>
      ['file', 'directory', 'dangling', 'loop'].map((destination) => ({ source, destination })),
    ),
  )(
    'preserves an existing $destination destination for a $source source',
    async ({ source, destination }) => {
      const { client, server } = sftpFixture();
      server.file('/home/target', b('target'));
      if (source === 'file') server.file('/home/source', b('source'));
      else if (source === 'directory') server.directory('/home/source');
      else if (source === 'symlink') server.link('/home/source', 'target');
      else server.special('/home/source', source as 'fifo' | 'socket');
      if (destination === 'file') server.file('/home/destination', b('keep'));
      else if (destination === 'directory') server.directory('/home/destination');
      else server.link('/home/destination', destination === 'loop' ? 'destination' : 'missing');
      const original = server.nodes.get('/home/destination');
      await client.connect();
      await expect(client.rename(b('/home/source'), b('/home/destination'))).rejects.toMatchObject({
        code: 'VIEWER_REMOTE_FAILURE',
      });
      expect(server.nodes.get('/home/destination')).toBe(original);
      expect(server.nodes.has('/home/source')).toBe(true);
      expect(server.packets.some((packet) => packet.type === 18)).toBe(false);
    },
  );
  it.each(['dangling', 'loop'])('refuses a %s destination before sending RENAME', async (kind) => {
    const { client, server } = sftpFixture();
    server.link('/home/source', 'target');
    server.link('/home/destination', kind === 'loop' ? 'destination' : 'missing');
    const destination = server.nodes.get('/home/destination');
    await client.connect();
    await expect(client.rename(b('/home/source'), b('/home/destination'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect(server.nodes.get('/home/destination')).toBe(destination);
    expect(server.packets.some((packet) => packet.type === 18)).toBe(false);
  });
  it.each(
    ['symlink', 'fifo', 'socket'].flatMap((source) =>
      ['dangling', 'loop'].map((destination) => ({ source, destination })),
    ),
  )(
    'models the raw server replacing a $destination link for a $source source',
    async ({ source: kind, destination: target }) => {
      const { client, server, wire } = sftpFixture();
      if (kind === 'symlink') server.link('/home/source', 'target');
      else server.special('/home/source', kind as 'fifo' | 'socket');
      server.link('/home/destination', target === 'loop' ? 'destination' : 'missing');
      const source = server.nodes.get('/home/source');
      await client.connect();
      server.holdReplies = true;
      wire.write(
        encodeRequest(99, { kind: 'rename', from: b('/home/source'), to: b('/home/destination') }),
      );
      await sftpTurn();
      expect(server.nodes.get('/home/destination')).toBe(source);
      expect(server.nodes.has('/home/source')).toBe(false);
    },
  );

  it.each([
    [3, 'VIEWER_REMOTE_DENIED'],
    [4, 'VIEWER_REMOTE_FAILURE'],
    [7, 'VIEWER_REMOTE_OFFLINE'],
  ])('refuses a rename when the destination LSTAT fails with status %i', async (status, code) => {
    const { client, server } = sftpFixture();
    const source = server.file('/home/source', b('source'));
    await client.connect();
    server.replyOverride = (reply, request) =>
      request.kind === 'lstat' && reply.kind !== 'version'
        ? { kind: 'status', id: reply.id, status, message: b('lstat failed'), language: b('') }
        : reply;
    await expect(client.rename(b('/home/source'), b('/home/destination'))).rejects.toMatchObject({
      code,
      status,
    });
    expect(server.packets.some((packet) => packet.type === 18)).toBe(false);
    expect(server.nodes.get('/home/source')).toBe(source);
    expect(server.nodes.has('/home/destination')).toBe(false);
  });
});
