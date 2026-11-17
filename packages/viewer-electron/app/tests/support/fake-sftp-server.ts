import type { Duplex } from 'node:stream';
import type {
  SFTPAttributes,
  SFTPName,
  SFTPReply,
  SFTPRequest,
  SFTPServerLimits,
  SFTPSetAttributes,
} from '../../src/desktop/remote/sftp/codec';
import { once } from 'node:events';
import path from 'node:path/posix';
import { afterEach, expect } from 'vitest';
import {
  decodeClientPacket,
  encodeReply,
  sftpExtensions,
  SFTPFramer,
  SFTPReader,
  SFTPWriter,
} from '../../src/desktop/remote/sftp/codec';

export type FakePacketFault = 'oversized' | 'truncated' | 'oversizedString' | 'tooManyNames';
export type FakeNodeKind = 'file' | 'directory' | 'symlink';

export interface FakeSubtree {
  path: string;
  filesystemID?: bigint;
  readOnly?: boolean;
}

export interface FakeSFTPOptions {
  extensions?: boolean | ReadonlyMap<string, Buffer>;
  limits?: SFTPServerLimits;
  subtrees?: readonly FakeSubtree[];
  quotaBytes?: number;
  latencyMs?: number;
  reorderReplies?: boolean;
  fragmentBytes?: number;
  hostileNames?: readonly Buffer[];
  directoryEntries?: number;
  namesPerReply?: number;
  fault?: FakePacketFault;
  dropAfterBytes?: number;
  shortReadBytes?: number;
  folderRenameRace?: (server: FakeSFTPServer, destination: string) => void;
}

export interface FakeNode {
  kind: FakeNodeKind;
  attrs: SFTPAttributes;
  chunks: Map<number, Buffer>;
  size: number;
  target?: string;
}

interface FakeHandle {
  path: string;
  node: FakeNode;
  writable: boolean;
  cursor: number;
  names?: readonly SFTPName[];
}

interface PacketLog {
  type: number;
  extension?: string;
  id?: number;
  request?: SFTPRequest;
  length: number;
}

class FakeStatus extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const chunkSize = 64 * 1024;
const forbiddenTypes = new Set([13, 15]);
const forbiddenExtensions = [
  'posix-rename@openssh.com',
  'hardlink@openssh.com',
  'lsetstat@openssh.com',
];
const servers = new Set<FakeSFTPServer>();
let assertionsInstalled = false;

/** Each SFTP test file opts in, including codec-only files, so future fixtures inherit the guard. */
export function assertSafeSFTPAfterEach(): void {
  if (assertionsInstalled) return;
  assertionsInstalled = true;
  afterEach(() => {
    for (const server of servers) {
      server.stop();
      server.assertSafePackets();
    }
    servers.clear();
  });
}

export class FakeSFTPServer {
  readonly packets: PacketLog[] = [];
  readonly replyIDs: number[] = [];
  readonly nodes = new Map<string, FakeNode>();
  readonly handles = new Map<string, FakeHandle>();
  readonly renameEvents: string[] = [];
  readonly fsyncs: string[] = [];
  readonly errors: unknown[] = [];
  readonly extensions: ReadonlyMap<string, Buffer>;
  private readonly framer = new SFTPFramer();
  private serial = 0;
  private sequence = 0;
  private transferred = 0;
  private initialized = false;
  private stopped = false;
  private faultUsed = false;
  private sending = Promise.resolve();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly held: SFTPReply[] = [];
  holdReplies = false;
  statusOverride: { status: number; message: string } | undefined;
  replyOverride: ((reply: SFTPReply, request: SFTPRequest) => SFTPReply) | undefined;

  constructor(
    readonly transport: Duplex,
    readonly options: FakeSFTPOptions = {},
  ) {
    this.extensions =
      options.extensions === false
        ? new Map()
        : options.extensions instanceof Map
          ? options.extensions
          : new Map(
              Object.entries(sftpExtensions).map(([key, name]) => [
                name,
                Buffer.from(key === 'statvfs' ? '2' : '1'),
              ]),
            );
    this.directory('/');
    this.directory('/home');
    transport.on('data', (bytes: Buffer) => {
      try {
        this.framer.push(bytes, (packet) => this.receive(packet));
      } catch (error) {
        this.errors.push(error);
        transport.destroy();
      }
    });
    transport.on('end', () => {
      try {
        this.framer.end();
      } catch (error) {
        this.errors.push(error);
      }
    });
    transport.on('error', () => {});
    servers.add(this);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.transport.destroy();
  }

  assertSafePackets(): void {
    expect(this.packets.filter((packet) => forbiddenTypes.has(packet.type))).toEqual([]);
    for (const packet of this.packets) {
      if (packet.request?.kind === 'open')
        expect(['read', 'create']).toContain(packet.request.mode);
      if (packet.type === 200) {
        expect(forbiddenExtensions).not.toContain(packet.extension);
      }
    }
  }

  private makeNode(kind: FakeNodeKind, permissions: number): FakeNode {
    return {
      kind,
      attrs: { uid: 1000, gid: 1000, permissions, atime: 1_700_000_000, mtime: 1_700_000_000 },
      chunks: new Map(),
      size: 0,
    };
  }

  directory(file: string, permissions = 0o40755): FakeNode {
    const node = this.makeNode('directory', permissions);
    this.nodes.set(file, node);
    return node;
  }

  file(file: string, bytes: Buffer = Buffer.alloc(0), permissions = 0o100644): FakeNode {
    const node = this.makeNode('file', permissions);
    this.nodes.set(file, node);
    this.writeBytes(node, 0, bytes);
    return node;
  }

  link(file: string, target: string): FakeNode {
    const node = this.makeNode('symlink', 0o120777);
    node.target = target;
    node.size = Buffer.byteLength(target);
    this.nodes.set(file, node);
    return node;
  }

  bytes(file: string): Buffer {
    const { node } = this.resolve(file);
    return this.readBytes(node, 0, node.size);
  }

  private attributes(node: FakeNode): SFTPAttributes {
    return { ...node.attrs, size: BigInt(node.size) };
  }

  private pathname(bytes: Buffer): string {
    const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (name.includes('\0')) throw new FakeStatus(4, 'Invalid path');
    return path.resolve('/home', name);
  }

  private resolve(input: string, follow = true, depth = 0): { path: string; node: FakeNode } {
    if (depth > 40) throw new FakeStatus(4, 'Too many symbolic links');
    const segments = input.split('/').filter(Boolean);
    let current = '/';
    let node = this.nodes.get('/')!;
    for (let index = 0; index < segments.length; index++) {
      current = path.join(current, segments[index]!);
      const found = this.nodes.get(current);
      if (!found) throw new FakeStatus(2, 'No such file');
      node = found;
      if (node.kind === 'symlink' && (follow || index < segments.length - 1)) {
        const target = path.resolve(
          path.dirname(current),
          node.target!,
          ...segments.slice(index + 1),
        );
        return this.resolve(target, true, depth + 1);
      }
      if (index < segments.length - 1 && node.kind !== 'directory')
        throw new FakeStatus(4, 'Not a directory');
    }
    return { path: current, node };
  }

  private destination(input: string): string {
    const parent = this.resolve(path.dirname(input));
    if (parent.node.kind !== 'directory') throw new FakeStatus(4, 'Not a directory');
    return path.join(parent.path, path.basename(input));
  }

  private filesystem(file: string): { filesystemID: bigint; readOnly: boolean } {
    const matching = (this.options.subtrees ?? [])
      .filter((tree) => tree.path === '/' || file === tree.path || file.startsWith(tree.path + '/'))
      .sort((a, b) => b.path.length - a.path.length);
    return {
      filesystemID: matching.find((tree) => tree.filesystemID !== undefined)?.filesystemID ?? 1n,
      readOnly: matching.find((tree) => tree.readOnly !== undefined)?.readOnly ?? false,
    };
  }

  private writable(file: string): void {
    if (this.filesystem(file).readOnly) throw new FakeStatus(3, 'Read-only filesystem');
  }

  private handle(bytes: Buffer, writable = false): FakeHandle {
    const handle = this.handles.get(bytes.toString('hex'));
    if (!handle) throw new FakeStatus(4, 'Invalid handle');
    if (writable && !handle.writable) throw new FakeStatus(3, 'Handle is read only');
    return handle;
  }

  private openHandle(id: number, file: string, node: FakeNode, writable: boolean): SFTPReply {
    const maximum = this.options.limits?.openHandles ?? 0n;
    if (maximum !== 0n && BigInt(this.handles.size) >= maximum)
      throw new FakeStatus(4, 'Too many open handles');
    const handle = Buffer.from(String(++this.serial));
    this.handles.set(handle.toString('hex'), { path: file, node, writable, cursor: 0 });
    return { kind: 'handle', id, handle };
  }

  private readBytes(node: FakeNode, offset: number, length: number): Buffer {
    const size = Math.max(0, Math.min(length, node.size - offset));
    const result = Buffer.alloc(size);
    for (let index = 0; index < size;) {
      const position = offset + index;
      const chunkIndex = Math.floor(position / chunkSize);
      const within = position % chunkSize;
      const count = Math.min(size - index, chunkSize - within);
      node.chunks.get(chunkIndex)?.copy(result, index, within, within + count);
      index += count;
    }
    return result;
  }

  private writeBytes(node: FakeNode, offset: number, data: Buffer): void {
    const total = [...this.nodes.values()].reduce((sum, item) => sum + item.size, 0);
    const increase = Math.max(0, offset + data.length - node.size);
    if (total + increase > (this.options.quotaBytes ?? Infinity))
      throw new FakeStatus(4, 'Quota exceeded');
    for (let index = 0; index < data.length;) {
      const position = offset + index;
      const chunkIndex = Math.floor(position / chunkSize);
      const within = position % chunkSize;
      const count = Math.min(data.length - index, chunkSize - within);
      let chunk = node.chunks.get(chunkIndex);
      if (!chunk) {
        chunk = Buffer.alloc(chunkSize);
        node.chunks.set(chunkIndex, chunk);
      }
      data.copy(chunk, within, index, index + count);
      index += count;
    }
    node.size = Math.max(node.size, offset + data.length);
  }

  private setAttributes(node: FakeNode, attrs: SFTPSetAttributes): void {
    if (attrs.permissions !== undefined)
      node.attrs.permissions = (node.attrs.permissions! & 0o170000) | (attrs.permissions & 0o7777);
    if (attrs.times) {
      node.attrs.atime = attrs.times.atime;
      node.attrs.mtime = attrs.times.mtime;
    }
  }

  private status(id: number, status = 0, message = ''): SFTPReply {
    return { kind: 'status', id, status, message: Buffer.from(message), language: Buffer.alloc(0) };
  }

  private name(filename: Buffer, attrs: SFTPAttributes = {}): SFTPName {
    return { filename, longname: Buffer.alloc(0), attrs };
  }

  private receive(packet: Buffer): void {
    const log: PacketLog = { type: packet[0]!, length: packet.length + 4 };
    this.packets.push(log);
    if (log.type === 200) {
      const extension = new SFTPReader(packet.subarray(5));
      log.extension = extension.string().toString('utf8');
    }
    const decoded = decodeClientPacket(packet);
    if (decoded.kind === 'init') {
      if (this.initialized || decoded.version !== 3) throw new Error('Invalid fake handshake');
      this.initialized = true;
      this.schedule({ kind: 'version', version: 3, extensions: this.extensions });
      return;
    }
    if (!this.initialized) throw new Error('Request before INIT');
    log.id = decoded.id;
    log.request = decoded.request;
    if (
      decoded.request.kind !== 'limits' &&
      this.options.limits?.packetLength &&
      BigInt(log.length) > this.options.limits.packetLength
    ) {
      this.transport.destroy();
      return;
    }
    let reply: SFTPReply;
    try {
      if (this.statusOverride)
        throw new FakeStatus(this.statusOverride.status, this.statusOverride.message);
      reply = this.execute(decoded.id, decoded.request);
    } catch (error) {
      if (!(error instanceof FakeStatus)) throw error;
      reply = this.status(decoded.id, error.status, error.message);
    }
    if (this.replyOverride) reply = this.replyOverride(reply, decoded.request);
    this.schedule(reply);
  }

  private execute(id: number, request: SFTPRequest): SFTPReply {
    switch (request.kind) {
      case 'open': {
        const file = this.pathname(request.path);
        if (request.mode === 'create') {
          const destination = this.destination(file);
          this.writable(destination);
          if (this.nodes.has(destination)) throw new FakeStatus(4, 'File exists');
          const node = this.file(destination);
          this.setAttributes(node, request.attrs);
          return this.openHandle(id, destination, node, true);
        }
        const found = this.resolve(file);
        if (found.node.kind !== 'file') throw new FakeStatus(4, 'Not a regular file');
        return this.openHandle(id, found.path, found.node, false);
      }
      case 'close':
        this.handle(request.handle);
        this.handles.delete(request.handle.toString('hex'));
        return this.status(id);
      case 'read': {
        const handle = this.handle(request.handle);
        if (handle.node.kind !== 'file') throw new FakeStatus(4, 'Not a regular file');
        if (
          this.options.limits?.readLength &&
          BigInt(request.length) > this.options.limits.readLength
        )
          throw new FakeStatus(4, 'Read limit exceeded');
        const offset = Number(request.offset);
        if (request.offset > BigInt(Number.MAX_SAFE_INTEGER) || offset >= handle.node.size)
          return this.status(id, 1, 'End of file');
        const data = this.readBytes(
          handle.node,
          offset,
          Math.min(request.length, this.options.shortReadBytes ?? Infinity),
        );
        this.transferred += data.length;
        if (this.shouldDrop()) return this.status(id, 7, 'Connection lost');
        return { kind: 'data', id, data };
      }
      case 'write': {
        const handle = this.handle(request.handle, true);
        this.writable(handle.path);
        if (
          this.options.limits?.writeLength &&
          BigInt(request.data.length) > this.options.limits.writeLength
        )
          throw new FakeStatus(4, 'Write limit exceeded');
        if (request.offset > BigInt(512 * 1024 * 1024))
          throw new FakeStatus(4, 'Fake file size limit');
        this.writeBytes(handle.node, Number(request.offset), request.data);
        this.transferred += request.data.length;
        this.shouldDrop();
        return this.status(id);
      }
      case 'lstat':
      case 'stat': {
        const { node } = this.resolve(this.pathname(request.path), request.kind === 'stat');
        return { kind: 'attrs', id, attrs: this.attributes(node) };
      }
      case 'fstat':
        return { kind: 'attrs', id, attrs: this.attributes(this.handle(request.handle).node) };
      case 'setstat': {
        const found = this.resolve(this.pathname(request.path));
        this.writable(found.path);
        this.setAttributes(found.node, request.attrs);
        return this.status(id);
      }
      case 'fsetstat': {
        const handle = this.handle(request.handle);
        this.writable(handle.path);
        this.setAttributes(handle.node, request.attrs);
        return this.status(id);
      }
      case 'opendir': {
        const found = this.resolve(this.pathname(request.path));
        if (found.node.kind !== 'directory') throw new FakeStatus(4, 'Not a directory');
        return this.openHandle(id, found.path, found.node, false);
      }
      case 'readdir': {
        const handle = this.handle(request.handle);
        if (handle.node.kind !== 'directory') throw new FakeStatus(4, 'Not a directory');
        handle.names ??= [
          ...[...this.nodes]
            .filter(([file]) => file !== handle.path && path.dirname(file) === handle.path)
            .map(([file, node]) =>
              this.name(Buffer.from(path.basename(file)), this.attributes(node)),
            ),
          ...(this.options.hostileNames ?? []).map((name) => this.name(name)),
          ...Array.from({ length: this.options.directoryEntries ?? 0 }, (_, index) =>
            this.name(Buffer.from('entry-' + index)),
          ),
        ];
        if (handle.cursor >= handle.names.length) return this.status(id, 1, 'End of directory');
        const names = handle.names.slice(
          handle.cursor,
          handle.cursor + (this.options.namesPerReply ?? 100),
        );
        handle.cursor += names.length;
        return { kind: 'name', id, names };
      }
      case 'mkdir': {
        const file = this.destination(this.pathname(request.path));
        this.writable(file);
        if (this.nodes.has(file)) throw new FakeStatus(4, 'File exists');
        this.setAttributes(this.directory(file), request.attrs);
        return this.status(id);
      }
      case 'realpath': {
        const found = this.resolve(this.pathname(request.path));
        return {
          kind: 'name',
          id,
          names: [this.name(Buffer.from(found.path), this.attributes(found.node))],
        };
      }
      case 'readlink': {
        const { node } = this.resolve(this.pathname(request.path), false);
        if (node.kind !== 'symlink') throw new FakeStatus(4, 'Not a symbolic link');
        return { kind: 'name', id, names: [this.name(Buffer.from(node.target!))] };
      }
      case 'symlink': {
        const file = this.destination(this.pathname(request.path));
        this.writable(file);
        if (this.nodes.has(file)) throw new FakeStatus(4, 'File exists');
        this.link(file, request.target.toString('utf8'));
        return this.status(id);
      }
      case 'rename': {
        const source = this.resolve(this.pathname(request.from), false);
        const destination = this.destination(this.pathname(request.to));
        this.writable(source.path);
        this.writable(destination);
        if (this.filesystem(source.path).filesystemID !== this.filesystem(destination).filesystemID)
          throw new FakeStatus(4, 'EXDEV: cross-device link');
        if (this.nodes.has(destination)) throw new FakeStatus(4, 'File exists');
        if (source.node.kind === 'directory') {
          this.renameEvents.push('stat-destination');
          this.options.folderRenameRace?.(this, destination);
          const occupied = this.nodes.get(destination);
          if (
            occupied &&
            (occupied.kind !== 'directory' ||
              [...this.nodes.keys()].some((file) => file.startsWith(destination + '/')))
          )
            throw new FakeStatus(4, 'Destination is not an empty directory');
        } else this.renameEvents.push('exclusive-file-publication');
        if (destination.startsWith(source.path + '/'))
          throw new FakeStatus(4, 'Invalid directory move');
        const entries = [...this.nodes].filter(
          ([file]) => file === source.path || file.startsWith(source.path + '/'),
        );
        for (const [file, node] of entries) {
          this.nodes.delete(file);
          this.nodes.set(destination + file.slice(source.path.length), node);
        }
        this.renameEvents.push('rename');
        return this.status(id);
      }
      case 'limits': {
        this.requireExtension('limits');
        const limits = this.options.limits ?? {
          packetLength: 256n * 1024n,
          readLength: 64n * 1024n,
          writeLength: 64n * 1024n,
          openHandles: 256n,
        };
        return {
          kind: 'extendedReply',
          id,
          data: new SFTPWriter()
            .uint64(limits.packetLength)
            .uint64(limits.readLength)
            .uint64(limits.writeLength)
            .uint64(limits.openHandles)
            .build(),
        };
      }
      case 'statvfs': {
        this.requireExtension('statvfs');
        const found = this.resolve(this.pathname(request.path));
        const filesystem = this.filesystem(found.path);
        const data = new SFTPWriter();
        for (const value of [
          4096n,
          4096n,
          1000000n,
          500000n,
          500000n,
          100000n,
          50000n,
          50000n,
          filesystem.filesystemID,
          filesystem.readOnly ? 1n : 0n,
          255n,
        ])
          data.uint64(value);
        return { kind: 'extendedReply', id, data: data.build() };
      }
      case 'fsync': {
        this.requireExtension('fsync');
        const handle = this.handle(request.handle);
        this.writable(handle.path);
        this.fsyncs.push(handle.path);
        return this.status(id);
      }
      case 'copyData': {
        this.requireExtension('copyData');
        const source = this.handle(request.source);
        const destination = this.handle(request.destination, true);
        this.writable(destination.path);
        if (source === destination || source.node === destination.node)
          throw new FakeStatus(4, 'Invalid copy handles');
        const sourceOffset = Number(request.sourceOffset);
        const count =
          request.length === 0n
            ? Math.max(0, source.node.size - sourceOffset)
            : Number(request.length);
        if (
          !Number.isSafeInteger(count) ||
          count > 512 * 1024 * 1024 ||
          request.destinationOffset > BigInt(512 * 1024 * 1024)
        )
          throw new FakeStatus(4, 'Fake file size limit');
        const data = this.readBytes(source.node, sourceOffset, count);
        this.writeBytes(destination.node, Number(request.destinationOffset), data);
        return this.status(id);
      }
      case 'usersGroups': {
        this.requireExtension('usersGroups');
        const users = new SFTPWriter();
        const groups = new SFTPWriter();
        for (const uid of request.uids) users.string(Buffer.from(uid === 1000 ? 'viewer' : ''));
        for (const gid of request.gids) groups.string(Buffer.from(gid === 1000 ? 'staff' : ''));
        return {
          kind: 'extendedReply',
          id,
          data: new SFTPWriter().string(users.build()).string(groups.build()).build(),
        };
      }
    }
  }

  private requireExtension(kind: keyof typeof sftpExtensions): void {
    if (!this.extensions.has(sftpExtensions[kind]))
      throw new FakeStatus(8, 'Unsupported extension');
  }

  private shouldDrop(): boolean {
    if (
      this.options.dropAfterBytes !== undefined &&
      this.transferred >= this.options.dropAfterBytes
    ) {
      this.transport.destroy();
      return true;
    }
    return false;
  }

  releaseReplies(reverse = false): void {
    this.holdReplies = false;
    const replies = this.held.splice(0);
    if (reverse) replies.reverse();
    for (const reply of replies) this.enqueue(reply);
  }

  private schedule(reply: SFTPReply): void {
    if (this.stopped || this.transport.destroyed) return;
    if (this.holdReplies) {
      this.held.push(reply);
      return;
    }
    const orderDelay =
      this.options.reorderReplies && reply.kind !== 'version' ? 7 - (this.sequence++ % 8) : 0;
    const delay = (this.options.latencyMs ?? 0) + orderDelay;
    if (!delay) this.enqueue(reply);
    else {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.enqueue(reply);
      }, delay);
      this.timers.add(timer);
    }
  }

  private enqueue(reply: SFTPReply): void {
    this.sending = this.sending
      .then(async () => {
        if (this.stopped || this.transport.destroyed) return;
        if (reply.kind !== 'version') this.replyIDs.push(reply.id);
        if (
          this.options.fault &&
          !this.faultUsed &&
          reply.kind !== 'version' &&
          reply.kind !== 'extendedReply'
        ) {
          this.faultUsed = true;
          switch (this.options.fault) {
            case 'oversized':
              await this.send(Buffer.from([0, 16, 0, 1]));
              return;
            case 'truncated':
              await this.send(encodeReply(reply).subarray(0, 7));
              this.transport.end();
              return;
            case 'oversizedString': {
              const body = new SFTPWriter().byte(103).uint32(reply.id).uint32(65537).build();
              await this.send(new SFTPWriter().uint32(body.length).bytes(body).build());
              return;
            }
            case 'tooManyNames': {
              const body = new SFTPWriter().byte(104).uint32(reply.id).uint32(100000).build();
              await this.send(new SFTPWriter().uint32(body.length).bytes(body).build());
              return;
            }
          }
        }
        await this.send(encodeReply(reply));
      })
      .catch((error: unknown) => {
        if (!this.stopped && !this.transport.destroyed) {
          this.errors.push(error);
          this.transport.destroy();
        }
      });
  }

  async send(bytes: Buffer): Promise<void> {
    const fragment = this.options.fragmentBytes ?? bytes.length;
    if (!Number.isInteger(fragment) || fragment < 1) throw new Error('Invalid fake fragment size');
    for (let index = 0; index < bytes.length; index += fragment) {
      if (this.transport.destroyed) return;
      if (!this.transport.write(bytes.subarray(index, index + fragment)))
        await once(this.transport, 'drain');
    }
  }
}
