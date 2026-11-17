import { describe, expect, it } from 'vitest';
import { remoteLimits } from '../src/domain/remote/limits';
import {
  decodeReply,
  decodeUsersGroups,
  sftpBounds,
  SFTPWriter,
} from '../src/desktop/remote/sftp/codec';
import { SFTPProtocolError } from '../src/desktop/remote/sftp/errors';

const b = (text: string): Buffer => Buffer.from(text);

describe('complete over-cap SFTP bodies', () => {
  it('rejects a complete oversized metadata string, independently of DATA', () => {
    const length = sftpBounds.stringBytes + 1;
    const packet = new SFTPWriter()
      .byte(101)
      .uint32(1)
      .uint32(4)
      .uint32(length)
      .bytes(Buffer.alloc(length, 97))
      .uint32(0)
      .build();
    expect(() => decodeReply(packet)).toThrow(SFTPProtocolError);
  });

  it('rejects a complete NAME with one more than the permitted number of entries', () => {
    const count = remoteLimits.namesPerReply + 1;
    const packet = new SFTPWriter().byte(104).uint32(1).uint32(count);
    for (let index = 0; index < count; index++) packet.string(b('a')).string(b('')).uint32(0);
    expect(() => decodeReply(packet.build())).toThrow(SFTPProtocolError);
  });

  it('uses the name cap for a complete filename instead of the metadata-string cap', () => {
    const length = sftpBounds.nameBytes + 1;
    const packet = new SFTPWriter()
      .byte(104)
      .uint32(1)
      .uint32(1)
      .uint32(length)
      .bytes(Buffer.alloc(length, 97))
      .string(b(''))
      .uint32(0)
      .build();
    expect(() => decodeReply(packet)).toThrow(SFTPProtocolError);
  });

  it('reads complete extended attribute pairs over the packet budget and keeps only the budget', () => {
    const count = sftpBounds.extensionPairs + 1;
    const packet = new SFTPWriter().byte(105).uint32(1).uint32(0x80000000).uint32(count);
    for (let index = 0; index < count; index++) packet.string(b('' + index)).string(b(''));
    const reply = decodeReply(packet.build());
    const extended = reply.kind === 'attrs' ? reply.attrs.extended : undefined;
    expect(extended).toHaveLength(sftpBounds.extensionPairs);
    expect(extended?.at(-1)?.type).toEqual(b('' + (sftpBounds.extensionPairs - 1)));
  });

  it('still rejects an extended attribute count the packet does not contain', () => {
    const packet = new SFTPWriter().byte(105).uint32(1).uint32(0x80000000).uint32(0xffffffff);
    expect(() => decodeReply(packet.build())).toThrow(SFTPProtocolError);
  });

  it('rejects a full oversized writer allocation before framing', () => {
    expect(() => new SFTPWriter().bytes(Buffer.alloc(remoteLimits.packetBytes + 1))).toThrow(
      SFTPProtocolError,
    );
  });

  it('keeps a rejected append from poisoning the writer allocation size', () => {
    const writer = new SFTPWriter().byte(101);
    expect(() => writer.bytes(Buffer.alloc(remoteLimits.packetBytes))).toThrow(SFTPProtocolError);
    expect(writer.build().length).toBe(1);
    expect(writer.build()[0]).toBe(101);
  });

  it('rejects extra complete names inside each packed user/group list', () => {
    const extra = new SFTPWriter().string(b('first')).string(b('unasked')).build();
    const empty = b('');
    expect(() =>
      decodeUsersGroups(new SFTPWriter().string(extra).string(empty).build(), 1, 0),
    ).toThrow(SFTPProtocolError);
    expect(() =>
      decodeUsersGroups(new SFTPWriter().string(empty).string(extra).build(), 0, 1),
    ).toThrow(SFTPProtocolError);
  });

  it('rejects a complete oversized DATA payload', () => {
    const length = sftpBounds.dataBytes + 1;
    const packet = new SFTPWriter()
      .byte(103)
      .uint32(1)
      .uint32(length)
      .bytes(Buffer.alloc(length))
      .build();
    expect(() => decodeReply(packet)).toThrow(SFTPProtocolError);
  });

  it('rejects a complete VERSION map over the extension-pair cap', () => {
    const packet = new SFTPWriter().byte(2).uint32(3);
    for (let index = 0; index <= sftpBounds.extensionPairs; index++)
      packet.string(b('extension-' + index)).string(b('1'));
    expect(() => decodeReply(packet.build())).toThrow(SFTPProtocolError);
  });
});
