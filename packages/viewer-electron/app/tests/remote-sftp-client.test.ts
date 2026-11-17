import type { SFTPRequest } from '../src/desktop/remote/sftp/codec';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SFTPClient } from '../src/desktop/remote/sftp/client';
import { encodeReply, sftpExtensions } from '../src/desktop/remote/sftp/codec';
import { sftpStatusError } from '../src/desktop/remote/sftp/errors';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';
import { sftpFixture, sftpTurn } from './support/sftp-fixture';

assertSafeSFTPAfterEach();
afterEach(() => vi.useRealTimers());

const b = (text: string): Buffer => Buffer.from(text);

describe('transport-independent SFTP channel', () => {
  it('negotiates v3, retains opaque extensions and queries advertised limits before ready', async () => {
    const { client, server } = sftpFixture();
    expect(client.connected).toBe(false);
    await expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_DISCONNECTED',
    });
    const first = client.connect();
    expect(client.connect()).toBe(first);
    await first;
    expect(client.connected).toBe(true);
    expect([...client.extensions.keys()]).toEqual(Object.values(sftpExtensions));
    expect(client.serverLimits).toEqual({
      packetLength: 262144n,
      readLength: 65536n,
      writeLength: 65536n,
      openHandles: 256n,
    });
    expect(server.packets.map((packet) => packet.type)).toEqual([1, 200]);
    const copy = client.extensions.get(sftpExtensions.fsync)!;
    copy.fill(0);
    expect(client.supports('fsync')).toBe(true);
    client.disconnect();
    expect(client.connected).toBe(false);
    await expect(client.connect()).rejects.toMatchObject({ code: 'VIEWER_REMOTE_DISCONNECTED' });
    await expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_DISCONNECTED',
    });
  });

  it('supports all safe file and directory operations with binary content', async () => {
    const { client, server } = sftpFixture({ fragmentBytes: 1 });
    await client.connect();
    const folder = b('/home/folder');
    const file = b('/home/folder/file');
    await client.mkdir(folder, { permissions: 0o700 });
    const handle = await client.open(file, 'create', { permissions: 0o600 });
    const content = Buffer.from([0, 255, 254, 128, 10]);
    await client.write(handle, 0n, content);
    await client.fsetstat(handle, { permissions: 0o640, times: { atime: 12, mtime: 34 } });
    expect(await client.fstat(handle)).toMatchObject({
      size: 5n,
      permissions: 0o100640,
      atime: 12,
      mtime: 34,
    });
    await client.fsync(handle);
    expect(server.fsyncs).toEqual(['/home/folder/file']);
    await client.close(handle);
    const read = await client.open(file, 'read');
    expect(await client.read(read, 1n, 3)).toEqual(content.subarray(1, 4));
    expect(await client.read(read, 100n, 1)).toBeUndefined();
    await client.close(read);
    await client.setstat(file, { times: { atime: 55, mtime: 66 } });
    expect(await client.stat(file)).toMatchObject({ size: 5n, mtime: 66 });
    expect(await client.lstat(file)).toMatchObject({ size: 5n });
    expect(await client.realpath(b('.'))).toEqual(b('/home'));
    const directory = await client.opendir(folder);
    expect(await client.readdir(directory)).toMatchObject([
      { filename: b('file'), attrs: { size: 5n } },
    ]);
    expect(await client.readdir(directory)).toBeUndefined();
    await client.close(directory);
    await client.rename(file, b('/home/folder/renamed'));
    expect(server.bytes('/home/folder/renamed')).toEqual(content);
    expect(client.stats.handles).toBe(0);
  });

  it('preserves links, uses OpenSSH target-first order and distinguishes stat from lstat', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/file', b('hello'));
    await client.connect();
    await client.symlink(b('file'), b('/home/link'));
    expect(await client.readlink(b('/home/link'))).toEqual(b('file'));
    expect(await client.lstat(b('/home/link'))).toMatchObject({ permissions: 0o120777, size: 4n });
    expect(await client.stat(b('/home/link'))).toMatchObject({ permissions: 0o100644, size: 5n });
    expect(await client.realpath(b('/home/link'))).toEqual(b('/home/file'));
    expect(server.packets.find((packet) => packet.type === 20)?.request).toEqual({
      kind: 'symlink',
      target: b('file'),
      path: b('/home/link'),
    });
  });

  it('supports statvfs, server-side copying and optional user/group names', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/source', b('abcdef'));
    await client.connect();
    const source = await client.open(b('/home/source'), 'read');
    const destination = await client.open(b('/home/copy'), 'create');
    await client.copyData(source, 1n, 3n, destination, 2n);
    expect(server.bytes('/home/copy')).toEqual(Buffer.from([0, 0, 98, 99, 100]));
    await client.copyData(source, 3n, 0n, destination, 5n);
    expect(server.bytes('/home/copy')).toEqual(Buffer.from([0, 0, 98, 99, 100, 100, 101, 102]));
    expect(await client.statvfs(b('/home'))).toMatchObject({
      filesystemID: 1n,
      flags: 0n,
      blockSize: 4096n,
    });
    expect(await client.usersGroupsByID([1000, 99], [1000, 99])).toEqual({
      users: [b('viewer'), b('')],
      groups: [b('staff'), b('')],
    });
    expect(await client.usersGroupsByID([], [])).toEqual({ users: [], groups: [] });
    await client.close(source);
    await client.close(destination);
  });

  it('does not replace a file or folder through plain rename', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/a', b('a'));
    server.file('/home/b', b('b'));
    server.directory('/home/first');
    server.directory('/home/second');
    await client.connect();
    await expect(client.rename(b('/home/a'), b('/home/b'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      message: 'File exists',
    });
    await expect(client.rename(b('/home/first'), b('/home/second'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect(server.bytes('/home/a')).toEqual(b('a'));
    expect(server.bytes('/home/b')).toEqual(b('b'));
    await client.rename(b('/home/first'), b('/home/third'));
    expect(server.renameEvents).toEqual(['stat-destination', 'rename']);
  });

  it('correlates 120 reordered replies with at most 64 requests awaiting a reply', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    for (let index = 0; index < 120; index++) server.file('/home/f' + index, Buffer.alloc(index));
    await client.connect();
    server.holdReplies = true;
    const requests = Array.from({ length: 120 }, (_, index) => client.stat(b('/home/f' + index)));
    await sftpTurn();
    expect(client.stats).toMatchObject({ inFlight: 64, queued: 56 });
    expect(server.packets.filter((packet) => packet.type === 17)).toHaveLength(64);
    server.releaseReplies(true);
    const results = await Promise.all(requests);
    expect(results.map((result) => result.size)).toEqual(
      Array.from({ length: 120 }, (_, index) => BigInt(index)),
    );
    expect(server.replyIDs.slice(0, 64)).toEqual(
      Array.from({ length: 64 }, (_, index) => 63 - index),
    );
    expect(client.stats).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it('wraps request IDs through zero without overwriting pending requests', async () => {
    const { client, server } = sftpFixture(
      { extensions: false, reorderReplies: true },
      { initialRequestID: 0xfffffffe },
    );
    await client.connect();
    await Promise.all(Array.from({ length: 5 }, () => client.stat(b('/home'))));
    expect(server.packets.slice(1).map((packet) => packet.id)).toEqual([
      0xfffffffe, 0xffffffff, 0, 1, 2,
    ]);
    expect(server.replyIDs).not.toEqual([0xfffffffe, 0xffffffff, 0, 1, 2]);
  });

  it('waits for drain when the duplex stream withholds write credit', async () => {
    const { client, server } = sftpFixture(
      { extensions: false },
      {},
      { highWaterMark: 1, writeDelayMs: 2 },
    );
    await client.connect();
    const requests = Array.from({ length: 20 }, () => client.stat(b('/home')));
    expect(client.stats.inFlight).toBe(1);
    expect(client.stats.queued).toBe(19);
    await Promise.all(requests);
    expect(server.packets).toHaveLength(21);
  });

  it('honours server read, write, total packet and simultaneous handle limits', async () => {
    const { client, server } = sftpFixture({
      limits: { packetLength: 100n, readLength: 20n, writeLength: 200n, openHandles: 2n },
    });
    server.file('/home/a', b('abc'));
    await client.connect();
    const [source, destination] = await Promise.all([
      client.open(b('/home/a'), 'read'),
      client.open(b('/home/b'), 'create'),
    ]);
    expect(client.readChunkBytes).toBe(20);
    expect(client.writeChunkBytes(destination)).toBe(100 - 25 - destination.length);
    await expect(client.read(source, 0n, 21)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    await expect(client.write(destination, 0n, Buffer.alloc(75))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    const before = server.packets.length;
    await expect(client.opendir(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      message: expect.stringContaining('open-handle'),
    });
    await expect(client.stat(Buffer.alloc(100, 97))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    expect(server.packets).toHaveLength(before);
    await client.close(source);
    const dir = await client.opendir(b('/home'));
    await client.close(dir);
    await client.close(destination);
    expect(server.packets.every((packet) => packet.length <= 100)).toBe(true);
  });

  it('treats zero server limits as unspecified and caps large advertised values locally', async () => {
    for (const value of [0n, 0xffffffffffffffffn]) {
      const { client } = sftpFixture({
        limits: { packetLength: value, readLength: value, writeLength: value, openHandles: value },
      });
      await client.connect();
      expect(client.readChunkBytes).toBe(65536);
      expect(client.writeChunkBytes(b('h'))).toBe(65536);
    }
  });

  it('fails unsupported extension calls locally and skips the limits query on plain v3', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    expect(server.packets.map((packet) => packet.type)).toEqual([1]);
    for (const operation of [
      () => client.statvfs(b('/home')),
      () => client.fsync(b('h')),
      () => client.copyData(b('a'), 0n, 1n, b('b'), 0n),
      () => client.usersGroupsByID([1], [2]),
      () => client.symlink(b('a'), b('/home/l')),
      () => client.readlink(b('/home/l')),
    ])
      await expect(operation()).rejects.toMatchObject({ code: 'ENOTSUP' });
    expect(server.packets.map((packet) => packet.type)).toEqual([1]);
  });

  it('does not use unknown extension versions and preserves unrecognized extension data', async () => {
    const extensions = new Map([
      [sftpExtensions.limits, b('2')],
      [sftpExtensions.fsync, b('99')],
      ['opaque@example.org', Buffer.from([0, 255])],
    ]);
    const { client, server } = sftpFixture({ extensions });
    await client.connect();
    expect(client.extensions).toEqual(extensions);
    expect(client.supports('limits')).toBe(false);
    await expect(client.fsync(b('h'))).rejects.toMatchObject({ code: 'ENOTSUP' });
    expect(server.packets.map((packet) => packet.type)).toEqual([1]);
  });

  it('times out metadata, retires outstanding credits and closes the channel', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    vi.useFakeTimers();
    server.holdReplies = true;
    const first = expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_TIMEOUT',
    });
    const second = expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(29999);
    expect(client.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(client.connected).toBe(false);
    expect(client.stats.inFlight).toBe(0);
  });

  it('times out a missing VERSION handshake', async () => {
    const { client, server } = sftpFixture();
    server.holdReplies = true;
    vi.useFakeTimers();
    const result = expect(client.connect()).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(30000);
    await result;
    expect(client.connected).toBe(false);
  });

  it('rejects pre-aborted work without sending, and drops late aborted replies without releasing credit early', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    const controller = new AbortController();
    controller.abort();
    await expect(client.stat(b('/home'), { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORT_ERR',
    });
    expect(server.packets).toHaveLength(1);
    server.holdReplies = true;
    const abort = new AbortController();
    const rejected = expect(
      client.stat(b('/home'), { signal: abort.signal }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await sftpTurn();
    abort.abort();
    await rejected;
    expect(client.stats).toMatchObject({ inFlight: 1, abandoned: 1 });
    server.releaseReplies();
    await sftpTurn();
    expect(client.connected).toBe(true);
    expect(client.stats.inFlight).toBe(0);
    expect(await client.stat(b('/home'))).toMatchObject({ permissions: 0o40755 });
  });

  it('cancels queued work without consuming IDs or request credits', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    server.holdReplies = true;
    const first = Array.from({ length: 64 }, () => client.stat(b('/home')));
    const controller = new AbortController();
    const cancelled = expect(
      client.stat(b('/home'), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(client.stats.queued).toBe(1);
    controller.abort();
    await cancelled;
    expect(client.stats).toMatchObject({ inFlight: 64, queued: 0 });
    await sftpTurn();
    server.releaseReplies();
    await Promise.all(first);
    expect(server.packets).toHaveLength(65);
  });

  it('retires the channel after an aborted open gets an ownerless handle', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    server.holdReplies = true;
    const controller = new AbortController();
    const cancelled = expect(
      client.open(b('/home/partial'), 'create', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await sftpTurn();
    controller.abort();
    await cancelled;
    server.releaseReplies();
    await sftpTurn();
    expect(client.connected).toBe(false);
    expect(server.nodes.has('/home/partial')).toBe(true);
  });

  it('fails all pending requests on channel loss', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    server.holdReplies = true;
    const rejected = expect(
      Promise.all([client.stat(b('/home')), client.lstat(b('/home'))]),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_OFFLINE' });
    server.transport.destroy();
    await rejected;
    expect(client.stats).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it('times out queued work without consuming an ID or closing active work', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    server.holdReplies = true;
    const first = Array.from({ length: 64 }, () => client.stat(b('/home')));
    vi.useFakeTimers();
    const timedOut = expect(client.stat(b('/home'), { timeoutMs: 50 })).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(50);
    await timedOut;
    expect(client.stats).toMatchObject({ inFlight: 64, queued: 0 });
    expect(client.connected).toBe(true);
    vi.useRealTimers();
    await sftpTurn();
    server.releaseReplies();
    await Promise.all(first);
    expect(server.packets).toHaveLength(65);
  });

  it('bounds queued requests independently of channel credits', async () => {
    const { client, server } = sftpFixture({ extensions: false });
    await client.connect();
    server.holdReplies = true;
    const first = Array.from({ length: 64 + 1024 }, () => client.stat(b('/home')));
    await expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      message: expect.stringContaining('queue is full'),
    });
    expect(client.stats).toMatchObject({ inFlight: 64, queued: 1024 });
    await sftpTurn();
    server.releaseReplies();
    await Promise.all(first);
    expect(client.stats).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it('rejects malformed outbound requests without sending or closing the channel', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const before = server.packets.length;
    for (const change of [{ size: 0n }, { uid: 1 }, { gid: 2 }])
      await expect(client.setstat(b('/home'), change as never)).rejects.toMatchObject({
        code: 'VIEWER_REMOTE_PROTOCOL',
      });
    await expect(client.stat(b('/home'), { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    expect(server.packets).toHaveLength(before);
    expect(client.connected).toBe(true);
  });
});

const errorOperations: { kind: string; call: (client: SFTPClient) => Promise<unknown> }[] = [
  { kind: 'open', call: (client) => client.open(b('/home/file'), 'read') },
  { kind: 'close', call: (client) => client.close(b('h')) },
  { kind: 'read', call: (client) => client.read(b('h'), 0n, 10) },
  { kind: 'write', call: (client) => client.write(b('h'), 0n, b('abc')) },
  { kind: 'lstat', call: (client) => client.lstat(b('/home/file')) },
  { kind: 'stat', call: (client) => client.stat(b('/home/file')) },
  { kind: 'fstat', call: (client) => client.fstat(b('h')) },
  { kind: 'setstat', call: (client) => client.setstat(b('/home/file'), { permissions: 0o600 }) },
  { kind: 'fsetstat', call: (client) => client.fsetstat(b('h'), { permissions: 0o600 }) },
  { kind: 'opendir', call: (client) => client.opendir(b('/home')) },
  { kind: 'readdir', call: (client) => client.readdir(b('h')) },
  { kind: 'mkdir', call: (client) => client.mkdir(b('/home/new')) },
  { kind: 'realpath', call: (client) => client.realpath(b('.')) },
  { kind: 'rename', call: (client) => client.rename(b('/home/a'), b('/home/b')) },
  { kind: 'readlink', call: (client) => client.readlink(b('/home/a')) },
  { kind: 'symlink', call: (client) => client.symlink(b('a'), b('/home/b')) },
  { kind: 'statvfs', call: (client) => client.statvfs(b('/home')) },
  { kind: 'fsync', call: (client) => client.fsync(b('h')) },
  { kind: 'copyData', call: (client) => client.copyData(b('a'), 0n, 1n, b('b'), 0n) },
  { kind: 'usersGroups', call: (client) => client.usersGroupsByID([1], [2]) },
];

describe('SFTP errors and hostile replies', () => {
  it.each(errorOperations)('preserves the server failure message for $kind', async ({ call }) => {
    const { client, server } = sftpFixture();
    await client.connect();
    server.statusOverride = { status: 4, message: 'Server quota: no space left' };
    await expect(call(client)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      message: 'Server quota: no space left',
    });
    expect(client.connected).toBe(true);
  });

  it.each([
    [2, 'ENOENT'],
    [3, 'VIEWER_REMOTE_DENIED'],
    [4, 'VIEWER_REMOTE_FAILURE'],
    [8, 'ENOTSUP'],
    [6, 'VIEWER_REMOTE_OFFLINE'],
    [7, 'VIEWER_REMOTE_OFFLINE'],
    [999, 'VIEWER_REMOTE_FAILURE'],
  ])('maps status %s to %s', async (status, code) => {
    const { client, server } = sftpFixture();
    await client.connect();
    server.statusOverride = { status: Number(status), message: 'Server message' };
    await expect(client.stat(b('/home'))).rejects.toMatchObject({
      code,
      message: 'Server message',
      status,
    });
    expect(sftpStatusError(Number(status), b('Server message')).code).toBe(code);
  });

  it.each(['oversized', 'truncated', 'oversizedString', 'tooManyNames'] as const)(
    'closes the session for a %s packet',
    async (fault) => {
      const { client } = sftpFixture({ fault });
      await client.connect();
      await expect(client.stat(b('/home'))).rejects.toMatchObject({
        code: 'VIEWER_REMOTE_PROTOCOL',
      });
      expect(client.connected).toBe(false);
    },
  );

  it.each([
    'unknownID',
    'wrongType',
    'okInsteadOfAttrs',
    'emptyRealpath',
    'extraRealpath',
    'emptyData',
    'longData',
    'badExtension',
  ] as const)('closes the session for %s', async (problem) => {
    const { client, server } = sftpFixture();
    server.file('/home/file', b('data'));
    await client.connect();
    const handle = await client.open(b('/home/file'), 'read');
    server.replyOverride = (reply, request) => {
      if (reply.kind === 'version') return reply;
      switch (problem) {
        case 'unknownID':
          return { ...reply, id: 0xdeadbeef };
        case 'wrongType':
          return { kind: 'handle', id: reply.id, handle: b('wrong') };
        case 'okInsteadOfAttrs':
          return { kind: 'status', id: reply.id, status: 0, message: b(''), language: b('') };
        case 'emptyRealpath':
          return { kind: 'name', id: reply.id, names: [] };
        case 'extraRealpath':
          return {
            kind: 'name',
            id: reply.id,
            names: [
              { filename: b('/a'), longname: b(''), attrs: {} },
              { filename: b('/b'), longname: b(''), attrs: {} },
            ],
          };
        case 'emptyData':
          return { kind: 'data', id: reply.id, data: b('') };
        case 'longData':
          return { kind: 'data', id: reply.id, data: b('too long') };
        case 'badExtension':
          expect(request.kind).toBe('statvfs');
          return { kind: 'extendedReply', id: reply.id, data: b('short') };
      }
    };
    const operation =
      problem === 'emptyRealpath' || problem === 'extraRealpath'
        ? client.realpath(b('.'))
        : problem === 'emptyData' || problem === 'longData'
          ? client.read(handle, 0n, 1)
          : problem === 'badExtension'
            ? client.statvfs(b('/home'))
            : client.stat(b('/home'));
    await expect(operation).rejects.toMatchObject({ code: 'VIEWER_REMOTE_PROTOCOL' });
    expect(client.connected).toBe(false);
  });

  it('rejects an unexpected or repeated VERSION and a duplicate reply', async () => {
    for (const problem of ['version', 'duplicate']) {
      const { client, server } = sftpFixture({ extensions: false });
      await client.connect();
      await client.stat(b('/home'));
      await server.send(
        encodeReply(
          problem === 'version'
            ? { kind: 'version', version: 3, extensions: new Map() }
            : { kind: 'attrs', id: 0, attrs: {} },
        ),
      );
      await sftpTurn();
      expect(client.connected).toBe(false);
    }
  });

  it('closes and rejects an open whose returned handle aliases an active handle', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    const handle = await client.opendir(b('/home'));
    server.replyOverride = (reply) => (reply.kind === 'handle' ? { ...reply, handle } : reply);
    await expect(client.opendir(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    expect(client.connected).toBe(false);
    expect(client.stats.inFlight).toBe(0);
  });

  it('classifies an abruptly closed partial frame as a protocol error', async () => {
    const { client, server } = sftpFixture();
    await client.connect();
    server.holdReplies = true;
    const result = expect(client.stat(b('/home'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    await server.send(Buffer.from([0, 0]));
    await sftpTurn();
    server.transport.destroy();
    await result;
  });

  it('rejects non-v3 negotiation and malformed advertised limits', async () => {
    const badVersion = sftpFixture();
    badVersion.server.holdReplies = true;
    const rejected = expect(badVersion.client.connect()).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    await sftpTurn();
    await badVersion.server.send(
      encodeReply({ kind: 'version', version: 4, extensions: new Map() }),
    );
    await rejected;
    const badLimits = sftpFixture();
    badLimits.server.replyOverride = (reply, request: SFTPRequest) =>
      request.kind === 'limits' && reply.kind !== 'version'
        ? { kind: 'extendedReply', id: reply.id, data: b('bad') }
        : reply;
    await expect(badLimits.client.connect()).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
    const unusable = sftpFixture({
      limits: { packetLength: 10n, readLength: 1n, writeLength: 1n, openHandles: 0n },
    });
    await expect(unusable.client.connect()).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_PROTOCOL',
    });
  });
});
