import type { SFTPAttributes, SFTPReply, SFTPRequest } from '../src/desktop/remote/sftp/codec';
import { describe, expect, it } from 'vitest';
import { remoteLimits } from '../src/domain/remote/limits';
import {
  decodeClientPacket,
  decodeLimits,
  decodeListingName,
  decodeReply,
  decodeStatVFS,
  decodeUsersGroups,
  encodeInit,
  encodeReply,
  encodeRequest,
  readAttributes,
  sftpBounds,
  SFTPFramer,
  SFTPReader,
  SFTPWriter,
} from '../src/desktop/remote/sftp/codec';
import { SFTPProtocolError } from '../src/desktop/remote/sftp/errors';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';

assertSafeSFTPAfterEach();

const bytes = (text: string): Buffer => Buffer.from(text);
const handle = bytes('h');
const path = bytes('/home/file');
const attrs = { permissions: 0o640, times: { atime: 12, mtime: 34 } };

const requests: SFTPRequest[] = [
  { kind: 'open', path, mode: 'read', attrs: {} },
  { kind: 'open', path, mode: 'create', attrs },
  { kind: 'close', handle },
  { kind: 'read', handle, offset: 0x123456789abcdef0n, length: 123 },
  { kind: 'write', handle, offset: 999n, data: Buffer.from([0, 255, 1]) },
  { kind: 'lstat', path },
  { kind: 'stat', path },
  { kind: 'fstat', handle },
  { kind: 'setstat', path, attrs },
  { kind: 'fsetstat', handle, attrs },
  { kind: 'opendir', path },
  { kind: 'readdir', handle },
  { kind: 'mkdir', path, attrs },
  { kind: 'realpath', path },
  { kind: 'rename', from: path, to: bytes('/home/new') },
  { kind: 'readlink', path },
  { kind: 'symlink', target: bytes('target'), path },
  { kind: 'statvfs', path },
  { kind: 'fsync', handle },
  { kind: 'limits' },
  {
    kind: 'copyData',
    source: handle,
    sourceOffset: 5n,
    length: 6n,
    destination: bytes('d'),
    destinationOffset: 7n,
  },
  { kind: 'usersGroups', uids: [0, 1, 0xffffffff], gids: [10] },
];

const replies: SFTPReply[] = [
  {
    kind: 'version',
    version: 3,
    extensions: new Map([['unknown@example.org', Buffer.from([255, 0])]]),
  },
  { kind: 'status', id: 42, status: 4, message: bytes('Quota exceeded'), language: bytes('en') },
  { kind: 'handle', id: 42, handle },
  { kind: 'data', id: 42, data: Buffer.from([255, 0, 128]) },
  {
    kind: 'name',
    id: 42,
    names: [
      {
        filename: Buffer.from([255]),
        longname: bytes('untrusted'),
        attrs: {
          size: 0xffffffffffffffffn,
          uid: 1000,
          gid: 1001,
          permissions: 0o100644,
          atime: 1,
          mtime: 2,
          extended: [{ type: bytes('key'), data: Buffer.from([0, 255]) }],
        },
      },
    ],
  },
  { kind: 'attrs', id: 42, attrs: {} },
  { kind: 'extendedReply', id: 42, data: bytes('opaque') },
];

describe('SFTP v3 wire codec', () => {
  it('uses independently specified wire bytes for INIT, OPEN, READ and OpenSSH link order', () => {
    expect(encodeInit().toString('hex')).toBe('000000050100000003');
    expect(
      encodeRequest(1, { kind: 'open', path: bytes('x'), mode: 'read', attrs: {} }).toString('hex'),
    ).toBe('00000012030000000100000001780000000100000000');
    expect(
      encodeRequest(1, { kind: 'open', path: bytes('x'), mode: 'create', attrs: {} })
        .subarray(-8)
        .toString('hex'),
    ).toBe('0000002a00000000');
    expect(
      encodeRequest(2, { kind: 'read', handle, offset: 0x0102030405060708n, length: 9 }).toString(
        'hex',
      ),
    ).toBe('0000001605000000020000000168010203040506070800000009');
    expect(
      encodeRequest(3, { kind: 'symlink', target: bytes('t'), path: bytes('p') }).toString('hex'),
    ).toBe('0000000f140000000300000001740000000170');
    expect(decodeClientPacket(encodeInit().subarray(4))).toEqual({
      kind: 'init',
      version: 3,
      extensions: new Map(),
    });
  });

  it.each(requests.map((request, index) => ({ label: request.kind + '-' + index, request })))(
    'round trips $label requests',
    ({ request }) => {
      const encoded = encodeRequest(0xffffffff, request);
      expect(encoded.readUInt32BE()).toBe(encoded.length - 4);
      expect(decodeClientPacket(encoded.subarray(4))).toEqual({
        kind: 'request',
        id: 0xffffffff,
        request,
      });
    },
  );

  it.each(replies.map((reply) => ({ label: reply.kind, reply })))(
    'round trips $label replies',
    ({ reply }) => {
      expect(decodeReply(encodeReply(reply).subarray(4))).toEqual(reply);
    },
  );

  it.each(Array.from({ length: 32 }, (_, flags) => flags))(
    'round trips attribute combination %i',
    (flags) => {
      const attributes: SFTPAttributes = {};
      if (flags & 1) attributes.size = 0xffffffffffffffffn;
      if (flags & 2) {
        attributes.uid = 0;
        attributes.gid = 0xffffffff;
      }
      if (flags & 4) attributes.permissions = 0o120777;
      if (flags & 8) {
        attributes.atime = 0;
        attributes.mtime = 0xffffffff;
      }
      if (flags & 16)
        attributes.extended = [
          { type: bytes('a'), data: bytes('b') },
          { type: Buffer.alloc(0), data: Buffer.alloc(0) },
        ];
      const reply: SFTPReply = { kind: 'attrs', id: 1, attrs: attributes };
      expect(decodeReply(encodeReply(reply).subarray(4))).toEqual(reply);
    },
  );

  it('frames samples at every byte boundary, one byte at a time, and in a combined chunk', () => {
    const samples = [
      encodeInit(),
      ...requests.slice(0, 6).map((request) => encodeRequest(7, request)),
      ...replies.map(encodeReply),
    ];
    for (const sample of samples) {
      for (let split = 0; split <= sample.length; split++) {
        const framer = new SFTPFramer();
        const received: Buffer[] = [];
        framer.push(sample.subarray(0, split), (packet) => received.push(packet));
        framer.push(sample.subarray(split), (packet) => received.push(packet));
        framer.end();
        expect(received).toEqual([sample.subarray(4)]);
      }
      const framer = new SFTPFramer();
      const received: Buffer[] = [];
      for (const byte of sample)
        framer.push(Buffer.from([byte]), (packet) => received.push(packet));
      framer.end();
      expect(received).toEqual([sample.subarray(4)]);
    }
    const framer = new SFTPFramer();
    const received: Buffer[] = [];
    framer.push(Buffer.concat(samples), (packet) => received.push(packet));
    expect(received).toEqual(samples.map((sample) => sample.subarray(4)));
  });

  it('accepts exact packet, string, name, count and extension bounds', () => {
    const maximum = Buffer.alloc(remoteLimits.packetBytes + 4);
    maximum.writeUInt32BE(remoteLimits.packetBytes);
    const framer = new SFTPFramer();
    const received: Buffer[] = [];
    framer.push(maximum, (packet) => received.push(packet));
    expect(received[0]?.length).toBe(remoteLimits.packetBytes);
    const data: SFTPReply = { kind: 'data', id: 1, data: Buffer.alloc(sftpBounds.stringBytes) };
    expect(decodeReply(encodeReply(data).subarray(4))).toEqual(data);
    const name: SFTPReply = {
      kind: 'name',
      id: 1,
      names: [
        { filename: Buffer.alloc(sftpBounds.nameBytes), longname: Buffer.alloc(0), attrs: {} },
      ],
    };
    expect(decodeReply(encodeReply(name).subarray(4))).toEqual(name);
    const many: SFTPReply = {
      kind: 'name',
      id: 1,
      names: Array.from({ length: remoteLimits.namesPerReply }, () => ({
        filename: bytes('x'),
        longname: Buffer.alloc(0),
        attrs: {},
      })),
    };
    expect(decodeReply(encodeReply(many).subarray(4))).toEqual(many);
    const version: SFTPReply = {
      kind: 'version',
      version: 3,
      extensions: new Map(
        Array.from({ length: sftpBounds.extensionPairs }, (_, index) => ['e' + index, bytes('1')]),
      ),
    };
    expect(decodeReply(encodeReply(version).subarray(4))).toEqual(version);
  });

  it.each([0, remoteLimits.packetBytes + 1, 0xffffffff])(
    'rejects frame length %i before buffering a body',
    (length) => {
      const framer = new SFTPFramer();
      expect(() => framer.push(new SFTPWriter().uint32(length).build(), () => {})).toThrow(
        SFTPProtocolError,
      );
    },
  );

  it('rejects every truncated prefix of sample packets and partial frames', () => {
    for (const reply of replies) {
      const encoded = encodeReply(reply);
      for (let end = 1; end < encoded.length; end++) {
        const framer = new SFTPFramer();
        framer.push(encoded.subarray(0, end), () => {});
        expect(() => framer.end()).toThrow(SFTPProtocolError);
      }
      // Extensions and opaque replies are valid at their own field boundaries.
      if (reply.kind === 'version' || reply.kind === 'extendedReply') continue;
      for (let end = 0; end < encoded.length - 4; end++)
        expect(() => decodeReply(encoded.subarray(4, 4 + end))).toThrow(SFTPProtocolError);
    }
    for (const request of requests) {
      const encoded = encodeRequest(1, request).subarray(4);
      for (let end = 0; end < encoded.length; end++)
        expect(() => decodeClientPacket(encoded.subarray(0, end))).toThrow(SFTPProtocolError);
    }
  });

  it('rejects malformed attributes, replies, strings, names, extensions and trailing bytes', () => {
    const malformed = [
      Buffer.from([255]),
      new SFTPWriter()
        .byte(103)
        .uint32(1)
        .uint32(sftpBounds.stringBytes + 1)
        .build(),
      new SFTPWriter().byte(104).uint32(1).uint32(100000).build(),
      new SFTPWriter()
        .byte(104)
        .uint32(1)
        .uint32(1)
        .uint32(sftpBounds.nameBytes + 1)
        .build(),
      new SFTPWriter().byte(105).uint32(1).uint32(16).build(),
      new SFTPWriter()
        .byte(105)
        .uint32(1)
        .uint32(0x80000000)
        .uint32(sftpBounds.extensionPairs + 1)
        .build(),
      new SFTPWriter().byte(102).uint32(1).string(Buffer.alloc(0)).build(),
      new SFTPWriter().byte(2).uint32(3).string(bytes('a')).build(),
      new SFTPWriter()
        .byte(2)
        .uint32(3)
        .string(bytes('a'))
        .string(bytes('1'))
        .string(bytes('a'))
        .string(bytes('2'))
        .build(),
      new SFTPWriter()
        .byte(2)
        .uint32(3)
        .string(Buffer.from([255]))
        .string(bytes('1'))
        .build(),
      Buffer.concat([encodeReply(replies[1]!).subarray(4), bytes('extra')]),
    ];
    for (const packet of malformed) expect(() => decodeReply(packet)).toThrow(SFTPProtocolError);
    const tooMany = new SFTPWriter().byte(2).uint32(3);
    for (let index = 0; index <= sftpBounds.extensionPairs; index++)
      tooMany.string(bytes('e' + index)).string(bytes('1'));
    expect(() => decodeReply(tooMany.build())).toThrow(SFTPProtocolError);
    expect(() => readAttributes(new SFTPReader(bytes('')))).toThrow(SFTPProtocolError);
  });

  it('has no unsafe attribute or open-mode request encoding, even for untyped callers', () => {
    for (const unsafe of [{ size: 0n }, { uid: 1 }, { gid: 2 }, { extended: [] }]) {
      for (const kind of ['open', 'mkdir', 'setstat', 'fsetstat'] as const) {
        const request = {
          kind,
          path,
          handle,
          mode: 'create',
          attrs: unsafe,
        } as unknown as SFTPRequest;
        expect(() => encodeRequest(1, request)).toThrow(SFTPProtocolError);
      }
    }
    expect(() =>
      encodeRequest(1, { kind: 'open', path, mode: 'unsafe', attrs: {} } as unknown as SFTPRequest),
    ).toThrow(SFTPProtocolError);
    expect(() =>
      encodeRequest(1, { kind: 'setstat', path, attrs: { times: { atime: 1 } } } as SFTPRequest),
    ).toThrow(SFTPProtocolError);
    expect(() => encodeRequest(1, { kind: 'read', handle, offset: -1n, length: 1 })).toThrow(
      SFTPProtocolError,
    );
    expect(() => encodeRequest(1, { kind: 'read', handle, offset: 0n, length: 0 })).toThrow(
      SFTPProtocolError,
    );
    expect(() =>
      encodeRequest(1, {
        kind: 'write',
        handle,
        offset: 0n,
        data: Buffer.alloc(sftpBounds.stringBytes + 1),
      }),
    ).toThrow(SFTPProtocolError);
    expect(() => encodeReply({ kind: 'attrs', id: 1, attrs: { uid: 1 } })).toThrow(
      SFTPProtocolError,
    );
    expect(() => encodeReply({ kind: 'attrs', id: 1, attrs: { atime: 1 } })).toThrow(
      SFTPProtocolError,
    );
    expect(() =>
      encodeRequest(1, { kind: 'usersGroups', uids: Array(1025).fill(1), gids: [] }),
    ).toThrow(SFTPProtocolError);
  });

  it('decodes extension layouts independently and rejects wrong lengths and counts', () => {
    const limits = Buffer.from(
      '0000000000040000000000000001000000000000000080000000000000000040',
      'hex',
    );
    expect(decodeLimits(limits)).toEqual({
      packetLength: 262144n,
      readLength: 65536n,
      writeLength: 32768n,
      openHandles: 64n,
    });
    const stat = new SFTPWriter();
    for (let value = 1n; value <= 11n; value++) stat.uint64(value);
    expect(decodeStatVFS(stat.build())).toEqual({
      blockSize: 1n,
      fragmentSize: 2n,
      blocks: 3n,
      freeBlocks: 4n,
      availableBlocks: 5n,
      files: 6n,
      freeFiles: 7n,
      availableFiles: 8n,
      filesystemID: 9n,
      flags: 10n,
      nameMax: 11n,
    });
    const names = Buffer.from('0000000500000001750000000400000000', 'hex');
    expect(decodeUsersGroups(names, 1, 1)).toEqual({
      users: [bytes('u')],
      groups: [Buffer.alloc(0)],
    });
    expect(() => decodeUsersGroups(names, 2, 1)).toThrow(SFTPProtocolError);
    expect(() => decodeLimits(limits.subarray(1))).toThrow(SFTPProtocolError);
    expect(() => decodeLimits(Buffer.concat([limits, bytes('x')]))).toThrow(SFTPProtocolError);
    expect(() => decodeStatVFS(stat.build().subarray(1))).toThrow(SFTPProtocolError);
    expect(() => decodeUsersGroups(Buffer.concat([names, bytes('x')]), 1, 1)).toThrow(
      SFTPProtocolError,
    );
  });
});

describe('listing name boundary', () => {
  it.each([
    Buffer.alloc(0),
    bytes('.'),
    bytes('..'),
    bytes('/'),
    bytes('a/b'),
    bytes('a\0b'),
    Buffer.from([255]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xf4, 0x90, 0x80, 0x80]),
    Buffer.alloc(1025, 97),
    bytes('é'.repeat(513)),
  ])('returns an inert error entry for invalid bytes %j', (filename) => {
    const result = decodeListingName({ filename, longname: Buffer.alloc(0), attrs: {} });
    expect(result).toMatchObject({ kind: 'error', rawName: filename });
    expect(result).not.toHaveProperty('name');
  });

  it.each(['name', 'é'.repeat(512), '文.txt', 'a\\b', '%2f', '\ufeffname', 'a\nb'])(
    'preserves valid names exactly: %s',
    (name) => {
      expect(
        decodeListingName({
          filename: bytes(name),
          longname: bytes('untrusted'),
          attrs: { size: 1n },
        }),
      ).toEqual({ kind: 'entry', name, attrs: { size: 1n } });
    },
  );
});
