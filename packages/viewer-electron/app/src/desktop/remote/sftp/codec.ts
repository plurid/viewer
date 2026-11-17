import { remoteLimits } from '../../../domain/remote/limits';
import { SFTPProtocolError } from './errors';

export const sftpBounds = Object.freeze({
  stringBytes: remoteLimits.codecStringBytes,
  nameBytes: remoteLimits.codecNameBytes,
  extensionPairs: remoteLimits.codecExtensionPairs,
  idNames: remoteLimits.codecStringBytes / 4,
  dataBytes: remoteLimits.packetBytes / 4,
  defaultDataBytes: remoteLimits.readBytesPerStream / remoteLimits.requestsPerChannel,
  queueRequests: remoteLimits.requestsPerChannel * remoteLimits.channelsPerConnection,
  openHandles: remoteLimits.resourceGrants,
  // Two full stream windows: one fills the wire, the other covers replies awaiting consumers.
  streamBytesPerChannel: 2 * remoteLimits.readBytesPerStream,
});

export const sftpPacketTypes = Object.freeze({
  init: 1,
  version: 2,
  open: 3,
  close: 4,
  read: 5,
  write: 6,
  lstat: 7,
  fstat: 8,
  setstat: 9,
  fsetstat: 10,
  opendir: 11,
  readdir: 12,
  mkdir: 14,
  realpath: 16,
  stat: 17,
  rename: 18,
  readlink: 19,
  symlink: 20,
  status: 101,
  handle: 102,
  data: 103,
  name: 104,
  attrs: 105,
  extended: 200,
  extendedReply: 201,
});

export const sftpExtensions = Object.freeze({
  statvfs: 'statvfs@openssh.com',
  fsync: 'fsync@openssh.com',
  limits: 'limits@openssh.com',
  copyData: 'copy-data',
  usersGroups: 'users-groups-by-id@openssh.com',
});

export interface SFTPAttributes {
  size?: bigint;
  uid?: number;
  gid?: number;
  permissions?: number;
  atime?: number;
  mtime?: number;
  extended?: readonly SFTPExtendedAttribute[];
}

export interface SFTPExtendedAttribute {
  type: Buffer;
  data: Buffer;
}

export interface SFTPSetAttributes {
  permissions?: number;
  times?: { atime: number; mtime: number };
}

/** OpenSSH ignores everything but permissions when OPEN or MKDIR creates an entry. */
export interface SFTPCreateAttributes {
  permissions?: number;
}

export interface SFTPName {
  filename: Buffer;
  longname: Buffer;
  attrs: SFTPAttributes;
}

export type SFTPOpenMode = 'read' | 'create';

export type SFTPRequest =
  | { kind: 'open'; path: Buffer; mode: SFTPOpenMode; attrs: SFTPCreateAttributes }
  | { kind: 'close' | 'fstat' | 'readdir'; handle: Buffer }
  | { kind: 'read'; handle: Buffer; offset: bigint; length: number }
  | { kind: 'write'; handle: Buffer; offset: bigint; data: Buffer }
  | { kind: 'lstat' | 'stat' | 'opendir' | 'realpath' | 'readlink'; path: Buffer }
  | { kind: 'setstat'; path: Buffer; attrs: SFTPSetAttributes }
  | { kind: 'mkdir'; path: Buffer; attrs: SFTPCreateAttributes }
  | { kind: 'fsetstat'; handle: Buffer; attrs: SFTPSetAttributes }
  | { kind: 'rename'; from: Buffer; to: Buffer }
  | { kind: 'symlink'; target: Buffer; path: Buffer }
  | { kind: 'statvfs'; path: Buffer }
  | { kind: 'fsync'; handle: Buffer }
  | { kind: 'limits' }
  | {
      kind: 'copyData';
      source: Buffer;
      sourceOffset: bigint;
      length: bigint;
      destination: Buffer;
      destinationOffset: bigint;
    }
  | { kind: 'usersGroups'; uids: readonly number[]; gids: readonly number[] };

export type SFTPClientPacket =
  | { kind: 'init'; version: number; extensions: ReadonlyMap<string, Buffer> }
  | { kind: 'request'; id: number; request: SFTPRequest };

export type SFTPReply =
  | { kind: 'version'; version: number; extensions: ReadonlyMap<string, Buffer> }
  | { kind: 'status'; id: number; status: number; message: Buffer; language: Buffer }
  | { kind: 'handle'; id: number; handle: Buffer }
  | { kind: 'data'; id: number; data: Buffer }
  | { kind: 'name'; id: number; names: readonly SFTPName[] }
  | { kind: 'attrs'; id: number; attrs: SFTPAttributes }
  | { kind: 'extendedReply'; id: number; data: Buffer };

export interface SFTPServerLimits {
  packetLength: bigint;
  readLength: bigint;
  writeLength: bigint;
  openHandles: bigint;
}

export interface SFTPStatVFS {
  blockSize: bigint;
  fragmentSize: bigint;
  blocks: bigint;
  freeBlocks: bigint;
  availableBlocks: bigint;
  files: bigint;
  freeFiles: bigint;
  availableFiles: bigint;
  filesystemID: bigint;
  flags: bigint;
  nameMax: bigint;
}

export interface SFTPUsersGroups {
  users: readonly Buffer[];
  groups: readonly Buffer[];
}

// Keep this independent of encoder tables so adding an encoder cannot add wire authority.
const approvedPacketTypes: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17, 18, 19, 20, 101, 102, 103, 104, 105, 200, 201,
]);

export function protocolAssert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SFTPProtocolError(message);
}

export class SFTPReader {
  private offset = 0;
  private attributePairs = 0;

  constructor(private readonly data: Buffer) {}

  get remaining(): number {
    return this.data.length - this.offset;
  }

  bytes(length: number): Buffer {
    protocolAssert(
      Number.isSafeInteger(length) && length >= 0 && length <= this.remaining,
      'Truncated SFTP packet.',
    );
    const data = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  byte(): number {
    return this.bytes(1)[0]!;
  }

  uint32(): number {
    return this.bytes(4).readUInt32BE();
  }

  uint64(): bigint {
    return this.bytes(8).readBigUInt64BE();
  }

  string(limit = sftpBounds.stringBytes): Buffer {
    const length = this.uint32();
    protocolAssert(length <= limit, 'Oversized SFTP string.');
    return this.bytes(length);
  }

  end(): void {
    protocolAssert(this.remaining === 0, 'Unexpected bytes in SFTP packet.');
  }

  /**
   * One budget per packet bounds retained Buffer views. Pairs past it are read and dropped, so a
   * server that attaches a pair to every entry still lists.
   */
  keepsExtendedAttribute(): boolean {
    if (this.attributePairs >= sftpBounds.extensionPairs) return false;
    this.attributePairs++;
    return true;
  }
}

export class SFTPWriter {
  private readonly parts: Buffer[] = [];
  private length = 0;

  bytes(value: Buffer): this {
    const length = this.length + value.length;
    protocolAssert(length <= remoteLimits.packetBytes, 'Oversized SFTP packet.');
    this.length = length;
    this.parts.push(value);
    return this;
  }

  byte(value: number): this {
    protocolAssert(Number.isInteger(value) && value >= 0 && value <= 255, 'Invalid SFTP byte.');
    // A packet body starts with its type byte, so a body built without framing is checked too.
    protocolAssert(
      this.length > 0 || approvedPacketTypes.includes(value),
      'Unapproved SFTP packet type.',
    );
    return this.bytes(Buffer.from([value]));
  }

  uint32(value: number): this {
    protocolAssert(
      Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
      'Invalid SFTP uint32.',
    );
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return this.bytes(bytes);
  }

  uint64(value: bigint): this {
    protocolAssert(
      typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn,
      'Invalid SFTP uint64.',
    );
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE(value);
    return this.bytes(bytes);
  }

  string(value: Buffer, limit = sftpBounds.stringBytes): this {
    protocolAssert(Buffer.isBuffer(value) && value.length <= limit, 'Oversized SFTP string.');
    return this.uint32(value.length).bytes(value);
  }

  build(): Buffer {
    return Buffer.concat(this.parts, this.length);
  }
}

export function framed(writer: SFTPWriter): Buffer {
  const body = writer.build();
  protocolAssert(body.length <= remoteLimits.packetBytes, 'Oversized SFTP packet.');
  protocolAssert(approvedPacketTypes.includes(body[0]!), 'Unapproved SFTP packet type.');
  if (body[0] === 200) {
    const reader = new SFTPReader(body.subarray(5));
    const extension = reader.string();
    protocolAssert(
      [
        'statvfs@openssh.com',
        'fsync@openssh.com',
        'limits@openssh.com',
        'copy-data',
        'users-groups-by-id@openssh.com',
      ].some((name) => extension.equals(Buffer.from(name))),
      'Unapproved SFTP extension.',
    );
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

/** Allocate only after the length is checked; one-byte fragments do not cause repeated concatenation. */
export class SFTPFramer {
  private readonly header = Buffer.alloc(4);
  private headerBytes = 0;
  private body: Buffer | undefined;
  private bodyBytes = 0;
  private failed = false;

  push(chunk: Buffer, receive: (packet: Buffer) => void): void {
    protocolAssert(!this.failed, 'The SFTP decoder is closed.');
    let offset = 0;
    try {
      while (offset < chunk.length) {
        if (!this.body) {
          const count = Math.min(4 - this.headerBytes, chunk.length - offset);
          chunk.copy(this.header, this.headerBytes, offset, offset + count);
          this.headerBytes += count;
          offset += count;
          if (this.headerBytes < 4) continue;
          const length = this.header.readUInt32BE();
          protocolAssert(
            length >= 1 && length <= remoteLimits.packetBytes,
            'Invalid SFTP packet length.',
          );
          this.body = Buffer.alloc(length);
        }
        const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
        chunk.copy(this.body, this.bodyBytes, offset, offset + count);
        offset += count;
        this.bodyBytes += count;
        if (this.bodyBytes === this.body.length) {
          const packet = this.body;
          this.body = undefined;
          this.headerBytes = 0;
          this.bodyBytes = 0;
          receive(packet);
        }
      }
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  end(): void {
    this.failed = true;
    protocolAssert(this.headerBytes === 0 && !this.body, 'Truncated SFTP frame.');
  }
}

export function readAttributes(reader: SFTPReader): SFTPAttributes {
  const flags = reader.uint32();
  protocolAssert((flags & 0x7ffffff0) === 0, 'Unknown SFTP attribute flags.');
  const attrs: SFTPAttributes = {};
  if (flags & 1) attrs.size = reader.uint64();
  if (flags & 2) {
    attrs.uid = reader.uint32();
    attrs.gid = reader.uint32();
  }
  if (flags & 4) attrs.permissions = reader.uint32();
  if (flags & 8) {
    attrs.atime = reader.uint32();
    attrs.mtime = reader.uint32();
  }
  if (flags & 0x80000000) {
    // Each pair reads at least eight bytes, so the packet length bounds this loop.
    const count = reader.uint32();
    const extended: SFTPExtendedAttribute[] = [];
    for (let index = 0; index < count; index++) {
      const pair = { type: reader.string(), data: reader.string() };
      if (reader.keepsExtendedAttribute()) extended.push(pair);
    }
    attrs.extended = extended;
  }
  return attrs;
}

function writeAttributes(writer: SFTPWriter, attrs: SFTPAttributes): void {
  protocolAssert(
    (attrs.uid === undefined) === (attrs.gid === undefined),
    'Unpaired SFTP owner IDs.',
  );
  protocolAssert(
    (attrs.atime === undefined) === (attrs.mtime === undefined),
    'Unpaired SFTP times.',
  );
  const flags =
    (attrs.size === undefined ? 0 : 1) +
    (attrs.uid === undefined ? 0 : 2) +
    (attrs.permissions === undefined ? 0 : 4) +
    (attrs.atime === undefined ? 0 : 8) +
    (attrs.extended === undefined ? 0 : 0x80000000);
  writer.uint32(flags);
  if (attrs.size !== undefined) writer.uint64(attrs.size);
  if (attrs.uid !== undefined) writer.uint32(attrs.uid).uint32(attrs.gid!);
  if (attrs.permissions !== undefined) writer.uint32(attrs.permissions);
  if (attrs.atime !== undefined) writer.uint32(attrs.atime).uint32(attrs.mtime!);
  if (attrs.extended !== undefined) {
    protocolAssert(
      attrs.extended.length <= sftpBounds.extensionPairs,
      'Too many SFTP extended attributes.',
    );
    writer.uint32(attrs.extended.length);
    for (const pair of attrs.extended) writer.string(pair.type).string(pair.data);
  }
}

function writeSetAttributes(writer: SFTPWriter, attrs: SFTPSetAttributes): void {
  protocolAssert(
    Object.keys(attrs).every((key) => key === 'permissions' || key === 'times'),
    'Unsupported SFTP attribute change.',
  );
  if (attrs.times) {
    protocolAssert(
      Object.keys(attrs.times).every((key) => key === 'atime' || key === 'mtime'),
      'Unsupported SFTP time change.',
    );
  }
  writer.uint32((attrs.permissions === undefined ? 0 : 4) + (attrs.times === undefined ? 0 : 8));
  if (attrs.permissions !== undefined) writer.uint32(attrs.permissions);
  if (attrs.times !== undefined) writer.uint32(attrs.times.atime).uint32(attrs.times.mtime);
}

/** Only own permissions are encoded, so neither extra nor inherited keys reach the wire. */
function writeCreateAttributes(writer: SFTPWriter, attrs: SFTPCreateAttributes): void {
  protocolAssert(
    Object.keys(attrs).every((key) => key === 'permissions'),
    'Unsupported SFTP creation attribute.',
  );
  writeSetAttributes(writer, { permissions: attrs.permissions });
}

function readSetAttributes(reader: SFTPReader): SFTPSetAttributes {
  const flags = reader.uint32();
  protocolAssert((flags & ~12) === 0, 'Unsupported SFTP attribute change.');
  const attrs: SFTPSetAttributes = {};
  if (flags & 4) attrs.permissions = reader.uint32();
  if (flags & 8) attrs.times = { atime: reader.uint32(), mtime: reader.uint32() };
  return attrs;
}

function readExtensions(reader: SFTPReader): ReadonlyMap<string, Buffer> {
  const extensions = new Map<string, Buffer>();
  while (reader.remaining) {
    protocolAssert(extensions.size < sftpBounds.extensionPairs, 'Too many SFTP extensions.');
    const name = reader.string();
    protocolAssert(
      name.length > 0 && name.every((byte) => byte >= 33 && byte <= 126),
      'Invalid SFTP extension name.',
    );
    const key = name.toString('ascii');
    protocolAssert(!extensions.has(key), 'Duplicate SFTP extension.');
    extensions.set(key, reader.string());
  }
  return extensions;
}

function writeExtensions(writer: SFTPWriter, extensions: ReadonlyMap<string, Buffer>): void {
  protocolAssert(extensions.size <= sftpBounds.extensionPairs, 'Too many SFTP extensions.');
  for (const [name, data] of extensions) writer.string(Buffer.from(name)).string(data);
}

export function encodeInit(): Buffer {
  return framed(new SFTPWriter().byte(sftpPacketTypes.init).uint32(3));
}

function writeIDs(writer: SFTPWriter, ids: readonly number[]): void {
  protocolAssert(ids.length <= sftpBounds.idNames, 'Too many SFTP identity names.');
  const packed = new SFTPWriter();
  for (const id of ids) packed.uint32(id);
  writer.string(packed.build());
}

function readIDs(reader: SFTPReader): number[] {
  const data = new SFTPReader(reader.string());
  protocolAssert(
    data.remaining % 4 === 0 && data.remaining / 4 <= sftpBounds.idNames,
    'Invalid SFTP identity list.',
  );
  const ids: number[] = [];
  while (data.remaining) ids.push(data.uint32());
  return ids;
}

export function encodeRequest(id: number, request: SFTPRequest): Buffer {
  const extended = Object.hasOwn(sftpExtensions, request.kind);
  const type = extended
    ? sftpPacketTypes.extended
    : sftpPacketTypes[request.kind as keyof typeof sftpPacketTypes];
  protocolAssert(type !== undefined, 'Unknown SFTP request.');
  const writer = new SFTPWriter().byte(type).uint32(id);
  if (extended)
    writer.string(Buffer.from(sftpExtensions[request.kind as keyof typeof sftpExtensions]));
  switch (request.kind) {
    case 'open':
      protocolAssert(
        request.mode === 'read' || request.mode === 'create',
        'Unsupported SFTP open mode.',
      );
      writer.string(request.path).uint32(request.mode === 'read' ? 1 : 2 | 8 | 32);
      writeCreateAttributes(writer, request.attrs);
      break;
    case 'close':
    case 'fstat':
    case 'readdir':
    case 'fsync':
      writer.string(request.handle);
      break;
    case 'read':
      protocolAssert(
        request.length > 0 && request.length <= sftpBounds.dataBytes,
        'Invalid SFTP read length.',
      );
      writer.string(request.handle).uint64(request.offset).uint32(request.length);
      break;
    case 'write':
      writer
        .string(request.handle)
        .uint64(request.offset)
        .string(request.data, sftpBounds.dataBytes);
      break;
    case 'lstat':
    case 'stat':
    case 'opendir':
    case 'realpath':
    case 'readlink':
    case 'statvfs':
      writer.string(request.path);
      break;
    case 'setstat':
      writer.string(request.path);
      writeSetAttributes(writer, request.attrs);
      break;
    case 'mkdir':
      writer.string(request.path);
      writeCreateAttributes(writer, request.attrs);
      break;
    case 'fsetstat':
      writer.string(request.handle);
      writeSetAttributes(writer, request.attrs);
      break;
    case 'rename':
      writer.string(request.from).string(request.to);
      break;
    case 'symlink':
      writer.string(request.target).string(request.path);
      break;
    case 'limits':
      break;
    case 'copyData':
      writer
        .string(request.source)
        .uint64(request.sourceOffset)
        .uint64(request.length)
        .string(request.destination)
        .uint64(request.destinationOffset);
      break;
    case 'usersGroups':
      writeIDs(writer, request.uids);
      writeIDs(writer, request.gids);
      break;
    default:
      throw new SFTPProtocolError('Unknown SFTP request.');
  }
  return framed(writer);
}

export function decodeClientPacket(packet: Buffer): SFTPClientPacket {
  protocolAssert(packet.length <= remoteLimits.packetBytes, 'Oversized SFTP packet.');
  const reader = new SFTPReader(packet);
  const type = reader.byte();
  if (type === sftpPacketTypes.init) {
    const version = reader.uint32();
    return { kind: 'init', version, extensions: readExtensions(reader) };
  }
  const id = reader.uint32();
  let request: SFTPRequest;
  switch (type) {
    case sftpPacketTypes.open: {
      const path = reader.string();
      const flags = reader.uint32();
      protocolAssert(flags === 1 || flags === (2 | 8 | 32), 'Unsupported SFTP open flags.');
      request = {
        kind: 'open',
        path,
        mode: flags === 1 ? 'read' : 'create',
        attrs: readSetAttributes(reader),
      };
      break;
    }
    case sftpPacketTypes.close:
    case sftpPacketTypes.fstat:
    case sftpPacketTypes.readdir:
      request = {
        kind: type === 4 ? 'close' : type === 8 ? 'fstat' : 'readdir',
        handle: reader.string(),
      };
      break;
    case sftpPacketTypes.read:
      request = {
        kind: 'read',
        handle: reader.string(),
        offset: reader.uint64(),
        length: reader.uint32(),
      };
      protocolAssert(
        request.length > 0 && request.length <= sftpBounds.dataBytes,
        'Invalid SFTP read length.',
      );
      break;
    case sftpPacketTypes.write:
      request = {
        kind: 'write',
        handle: reader.string(),
        offset: reader.uint64(),
        data: reader.string(sftpBounds.dataBytes),
      };
      break;
    case sftpPacketTypes.lstat:
    case sftpPacketTypes.stat:
    case sftpPacketTypes.opendir:
    case sftpPacketTypes.realpath:
    case sftpPacketTypes.readlink: {
      const kind =
        type === 7
          ? 'lstat'
          : type === 17
            ? 'stat'
            : type === 11
              ? 'opendir'
              : type === 16
                ? 'realpath'
                : 'readlink';
      request = { kind, path: reader.string() };
      break;
    }
    case sftpPacketTypes.setstat:
    case sftpPacketTypes.mkdir:
      request = {
        kind: type === 9 ? 'setstat' : 'mkdir',
        path: reader.string(),
        attrs: readSetAttributes(reader),
      };
      break;
    case sftpPacketTypes.fsetstat:
      request = { kind: 'fsetstat', handle: reader.string(), attrs: readSetAttributes(reader) };
      break;
    case sftpPacketTypes.rename:
      request = { kind: 'rename', from: reader.string(), to: reader.string() };
      break;
    case sftpPacketTypes.symlink:
      request = { kind: 'symlink', target: reader.string(), path: reader.string() };
      break;
    case sftpPacketTypes.extended: {
      const extension = reader.string().toString('ascii');
      switch (extension) {
        case sftpExtensions.statvfs:
          request = { kind: 'statvfs', path: reader.string() };
          break;
        case sftpExtensions.fsync:
          request = { kind: 'fsync', handle: reader.string() };
          break;
        case sftpExtensions.limits:
          request = { kind: 'limits' };
          break;
        case sftpExtensions.copyData:
          request = {
            kind: 'copyData',
            source: reader.string(),
            sourceOffset: reader.uint64(),
            length: reader.uint64(),
            destination: reader.string(),
            destinationOffset: reader.uint64(),
          };
          break;
        case sftpExtensions.usersGroups:
          request = { kind: 'usersGroups', uids: readIDs(reader), gids: readIDs(reader) };
          break;
        default:
          throw new SFTPProtocolError('Unknown SFTP extension request.');
      }
      break;
    }
    default:
      throw new SFTPProtocolError('Unknown SFTP packet type.');
  }
  reader.end();
  return { kind: 'request', id, request };
}

export function encodeReply(reply: SFTPReply): Buffer {
  const writer = new SFTPWriter().byte(sftpPacketTypes[reply.kind]);
  if (reply.kind === 'version') {
    writer.uint32(reply.version);
    writeExtensions(writer, reply.extensions);
  } else {
    writer.uint32(reply.id);
    switch (reply.kind) {
      case 'status':
        writer.uint32(reply.status).string(reply.message).string(reply.language);
        break;
      case 'handle':
        writer.string(reply.handle);
        break;
      case 'data':
        writer.string(reply.data, sftpBounds.dataBytes);
        break;
      case 'name':
        protocolAssert(reply.names.length <= remoteLimits.namesPerReply, 'Too many SFTP names.');
        writer.uint32(reply.names.length);
        for (const name of reply.names) {
          writer.string(name.filename, sftpBounds.nameBytes).string(name.longname);
          writeAttributes(writer, name.attrs);
        }
        break;
      case 'attrs':
        writeAttributes(writer, reply.attrs);
        break;
      case 'extendedReply':
        writer.bytes(reply.data);
        break;
    }
  }
  return framed(writer);
}

export function decodeReply(packet: Buffer): SFTPReply {
  protocolAssert(packet.length <= remoteLimits.packetBytes, 'Oversized SFTP packet.');
  const reader = new SFTPReader(packet);
  const type = reader.byte();
  if (type === sftpPacketTypes.version) {
    const version = reader.uint32();
    return { kind: 'version', version, extensions: readExtensions(reader) };
  }
  const id = reader.uint32();
  let reply: SFTPReply;
  switch (type) {
    case sftpPacketTypes.status:
      reply = {
        kind: 'status',
        id,
        status: reader.uint32(),
        message: reader.string(),
        language: reader.string(),
      };
      break;
    case sftpPacketTypes.handle:
      reply = { kind: 'handle', id, handle: reader.string() };
      protocolAssert(reply.handle.length > 0, 'Empty SFTP handle.');
      break;
    case sftpPacketTypes.data:
      reply = { kind: 'data', id, data: reader.string(sftpBounds.dataBytes) };
      break;
    case sftpPacketTypes.name: {
      const count = reader.uint32();
      protocolAssert(count <= remoteLimits.namesPerReply, 'Too many SFTP names.');
      const names: SFTPName[] = [];
      for (let index = 0; index < count; index++) {
        names.push({
          filename: reader.string(sftpBounds.nameBytes),
          longname: reader.string(),
          attrs: readAttributes(reader),
        });
      }
      reply = { kind: 'name', id, names };
      break;
    }
    case sftpPacketTypes.attrs:
      reply = { kind: 'attrs', id, attrs: readAttributes(reader) };
      break;
    case sftpPacketTypes.extendedReply:
      reply = { kind: 'extendedReply', id, data: reader.bytes(reader.remaining) };
      break;
    default:
      throw new SFTPProtocolError('Unknown SFTP reply type.');
  }
  reader.end();
  return reply;
}

export function decodeLimits(data: Buffer): SFTPServerLimits {
  const reader = new SFTPReader(data);
  const limits = {
    packetLength: reader.uint64(),
    readLength: reader.uint64(),
    writeLength: reader.uint64(),
    openHandles: reader.uint64(),
  };
  reader.end();
  return limits;
}

export function decodeStatVFS(data: Buffer): SFTPStatVFS {
  const reader = new SFTPReader(data);
  const stat = {
    blockSize: reader.uint64(),
    fragmentSize: reader.uint64(),
    blocks: reader.uint64(),
    freeBlocks: reader.uint64(),
    availableBlocks: reader.uint64(),
    files: reader.uint64(),
    freeFiles: reader.uint64(),
    availableFiles: reader.uint64(),
    filesystemID: reader.uint64(),
    flags: reader.uint64(),
    nameMax: reader.uint64(),
  };
  reader.end();
  return stat;
}

export function decodeUsersGroups(data: Buffer, users: number, groups: number): SFTPUsersGroups {
  const reader = new SFTPReader(data);
  const names = (count: number): Buffer[] => {
    protocolAssert(count <= sftpBounds.idNames, 'Too many SFTP identity names.');
    const list = new SFTPReader(reader.string());
    const result: Buffer[] = [];
    for (let index = 0; index < count; index++) result.push(list.string());
    list.end();
    return result;
  };
  const result = { users: names(users), groups: names(groups) };
  reader.end();
  return result;
}

export type SFTPListingName =
  | { kind: 'skip' }
  | { kind: 'entry'; name: string; attrs: SFTPAttributes }
  | { kind: 'error'; rawName: Buffer; message: string };

/** Invalid server names stay inert evidence, so callers cannot accidentally join them into paths. */
export function decodeListingName(entry: SFTPName): SFTPListingName {
  try {
    protocolAssert(
      entry.filename.length > 0 && entry.filename.length <= remoteLimits.serverNameBytes,
      'The server name is empty or too long.',
    );
    const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.filename);
    if (name === '.' || name === '..') return { kind: 'skip' };
    protocolAssert(!/[/\0]/.test(name), 'The server name is unsafe.');
    return { kind: 'entry', name, attrs: entry.attrs };
  } catch {
    return {
      kind: 'error',
      rawName: entry.filename,
      message: 'The server returned an invalid UTF-8 file name or an unsafe name.',
    };
  }
}
