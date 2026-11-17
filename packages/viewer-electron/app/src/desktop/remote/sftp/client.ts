import type { Duplex } from 'node:stream';
import type {
  SFTPAttributes,
  SFTPName,
  SFTPOpenMode,
  SFTPReply,
  SFTPRequest,
  SFTPServerLimits,
  SFTPSetAttributes,
  SFTPStatVFS,
  SFTPUsersGroups,
} from './codec';
import { remoteLimits } from '../../../domain/remote/limits';
import {
  decodeLimits,
  decodeReply,
  decodeStatVFS,
  decodeUsersGroups,
  encodeInit,
  encodeRequest,
  protocolAssert,
  sftpBounds,
  sftpExtensions,
  SFTPFramer,
} from './codec';
import { sftpAbortError, SFTPError, SFTPProtocolError, sftpStatusError } from './errors';

export interface SFTPRequestOptions {
  signal?: AbortSignal;
  /** Streams share a progress clock and disable individual request deadlines. */
  timeoutMs?: number | null;
}

export interface SFTPClientOptions {
  initialRequestID?: number;
  metadataTimeoutMs?: number;
}

type ClientState = 'disconnected' | 'negotiating' | 'ready' | 'closed';
type RequestReply = Exclude<SFTPReply, { kind: 'version' }>;
type ReplyKind = RequestReply['kind'];

interface PendingRequest {
  request: SFTPRequest;
  expected: ReplyKind;
  resolve: (reply: RequestReply) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort: () => void;
  settled: boolean;
  id?: number;
}

const unlimited: SFTPServerLimits = {
  packetLength: 0n,
  readLength: 0n,
  writeLength: 0n,
  openHandles: 0n,
};

const boundedLimit = (limit: bigint, maximum: number): number =>
  limit === 0n || limit > BigInt(maximum) ? maximum : Number(limit);

/** The transport owns authentication. This channel owns only bounded v3 request/reply lifetimes. */
export class SFTPClient {
  private state: ClientState = 'disconnected';
  private readonly framer = new SFTPFramer();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly queue: PendingRequest[] = [];
  private readonly handles = new Set<string>();
  private openingHandles = 0;
  private nextID: number;
  private writable = true;
  private pumping = false;
  private failure: Error | undefined;
  private extensionsValue: ReadonlyMap<string, Buffer> = new Map();
  private limitsValue: SFTPServerLimits = { ...unlimited };
  private connection: Promise<void> | undefined;
  private versionResolve: (() => void) | undefined;
  private versionReject: ((error: Error) => void) | undefined;
  private versionTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly metadataTimeoutMs: number;

  constructor(
    private readonly transport: Duplex,
    options: SFTPClientOptions = {},
  ) {
    this.nextID = options.initialRequestID ?? 0;
    protocolAssert(
      Number.isInteger(this.nextID) && this.nextID >= 0 && this.nextID <= 0xffffffff,
      'Invalid initial SFTP request ID.',
    );
    this.metadataTimeoutMs = options.metadataTimeoutMs ?? remoteLimits.metadataTimeoutMs;
    protocolAssert(
      Number.isFinite(this.metadataTimeoutMs) && this.metadataTimeoutMs > 0,
      'Invalid SFTP timeout.',
    );
    transport.on('data', this.receive);
    transport.on('end', this.ended);
    transport.on('close', this.lost);
    transport.on('error', this.lost);
    transport.on('drain', this.drained);
  }

  get connected(): boolean {
    return this.state === 'ready';
  }

  get extensions(): ReadonlyMap<string, Buffer> {
    return new Map([...this.extensionsValue].map(([key, value]) => [key, Buffer.from(value)]));
  }

  get serverLimits(): Readonly<SFTPServerLimits> {
    return { ...this.limitsValue };
  }

  get stats(): { inFlight: number; queued: number; abandoned: number; handles: number } {
    return {
      inFlight: this.pending.size,
      queued: this.queue.length,
      abandoned: [...this.pending.values()].filter((entry) => entry.settled).length,
      handles: this.handles.size + this.openingHandles,
    };
  }

  get readChunkBytes(): number {
    return Math.max(
      0,
      Math.min(
        boundedLimit(this.limitsValue.readLength, sftpBounds.stringBytes),
        this.packetLimit - 13,
      ),
    );
  }

  writeChunkBytes(handle: Buffer): number {
    return Math.max(
      0,
      Math.min(
        boundedLimit(this.limitsValue.writeLength, sftpBounds.stringBytes),
        this.packetLimit - 25 - handle.length,
      ),
    );
  }

  private get packetLimit(): number {
    return boundedLimit(this.limitsValue.packetLength, remoteLimits.packetBytes);
  }

  supports(extension: keyof typeof sftpExtensions): boolean {
    const version = this.extensionsValue.get(sftpExtensions[extension]);
    return version?.equals(Buffer.from(extension === 'statvfs' ? '2' : '1')) ?? false;
  }

  connect(): Promise<void> {
    if (this.state === 'closed') return Promise.reject(this.disconnected());
    if (this.connection) return this.connection;
    if (this.state !== 'disconnected') return Promise.reject(this.disconnected());
    this.state = 'negotiating';
    const version = new Promise<void>((resolve, reject) => {
      this.versionResolve = resolve;
      this.versionReject = reject;
      this.versionTimer = setTimeout(() => {
        this.fail(
          new SFTPError('VIEWER_REMOTE_TIMEOUT', 'The server did not negotiate SFTP in time.'),
        );
      }, this.metadataTimeoutMs);
    });
    this.connection = version
      .then(async () => {
        if (this.supports('limits')) {
          const reply = await this.request({ kind: 'limits' }, 'extendedReply', {}, true);
          this.limitsValue = this.decodeExtension(reply, decodeLimits);
          protocolAssert(
            this.packetLimit >= 34 && this.readChunkBytes > 0,
            'The server advertised unusable SFTP limits.',
          );
        }
        if (this.state === 'closed') throw this.failure ?? this.disconnected();
        this.state = 'ready';
      })
      .catch((error: unknown) => {
        const failure =
          error instanceof Error ? error : new SFTPProtocolError('Invalid SFTP negotiation.');
        this.fail(failure);
        throw failure;
      });
    try {
      this.writable = this.transport.write(encodeInit());
    } catch {
      this.lost();
    }
    return this.connection;
  }

  disconnect(reason?: SFTPError): void {
    this.fail(reason ?? this.disconnected());
  }

  private disconnected(): SFTPError {
    return new SFTPError('VIEWER_REMOTE_DISCONNECTED', 'The server channel is not connected.');
  }

  private readonly receive = (chunk: Buffer): void => {
    if (this.state === 'closed') return;
    try {
      protocolAssert(Buffer.isBuffer(chunk), 'SFTP requires a byte stream.');
      this.framer.push(chunk, (packet) => this.reply(decodeReply(packet)));
    } catch (error) {
      this.fail(
        error instanceof SFTPProtocolError ? error : new SFTPProtocolError('Malformed SFTP reply.'),
      );
    }
  };

  private readonly ended = (): void => {
    if (this.state === 'closed') return;
    try {
      this.framer.end();
      this.lost();
    } catch (error) {
      this.fail(error instanceof Error ? error : new SFTPProtocolError('Truncated SFTP stream.'));
    }
  };

  private readonly lost = (): void => {
    if (this.state === 'closed') return;
    try {
      this.framer.end();
      this.fail(new SFTPError('VIEWER_REMOTE_OFFLINE', 'The server channel was lost.'));
    } catch (error) {
      this.fail(error instanceof Error ? error : new SFTPProtocolError('Truncated SFTP stream.'));
    }
  };

  private readonly drained = (): void => {
    this.writable = true;
    this.pump();
  };

  private fail(error: Error): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.failure = error;
    clearTimeout(this.versionTimer);
    this.versionReject?.(error);
    this.versionResolve = undefined;
    this.versionReject = undefined;
    for (const entry of [...this.queue, ...this.pending.values()]) {
      this.settle(entry, error);
      clearTimeout(entry.timer);
    }
    this.queue.length = 0;
    this.pending.clear();
    this.handles.clear();
    this.openingHandles = 0;
    this.transport.off('data', this.receive);
    this.transport.off('end', this.ended);
    this.transport.off('drain', this.drained);
    this.transport.destroy();
  }

  private settle(entry: PendingRequest, error?: Error, reply?: RequestReply): void {
    if (entry.settled) return;
    entry.settled = true;
    entry.signal?.removeEventListener('abort', entry.abort);
    if (error) entry.reject(error);
    else if (reply) entry.resolve(reply);
  }

  private reply(reply: SFTPReply): void {
    if (reply.kind === 'version') {
      protocolAssert(
        this.state === 'negotiating' && this.versionResolve,
        'Unexpected SFTP version packet.',
      );
      protocolAssert(reply.version === 3, 'The server did not negotiate SFTP version 3.');
      this.extensionsValue = reply.extensions;
      clearTimeout(this.versionTimer);
      this.versionResolve();
      this.versionResolve = undefined;
      this.versionReject = undefined;
      return;
    }
    const entry = this.pending.get(reply.id);
    protocolAssert(entry, 'Unknown or duplicate SFTP request ID.');
    protocolAssert(
      reply.kind === 'status' || reply.kind === entry.expected,
      'Unexpected SFTP reply type.',
    );
    if (reply.kind === 'status' && reply.status === 0) {
      protocolAssert(entry.expected === 'status', 'Unexpected successful SFTP status.');
    }
    if (entry.request.kind === 'read' && reply.kind === 'data') {
      protocolAssert(
        reply.data.length <= entry.request.length && reply.data.length > 0,
        'Invalid SFTP data length.',
      );
    }
    if (
      (entry.request.kind === 'open' || entry.request.kind === 'opendir') &&
      reply.kind === 'handle'
    ) {
      protocolAssert(!this.handles.has(reply.handle.toString('hex')), 'Duplicate SFTP handle.');
    }
    this.pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (entry.request.kind === 'open' || entry.request.kind === 'opendir') {
      this.openingHandles--;
      if (reply.kind === 'handle') {
        this.handles.add(reply.handle.toString('hex'));
        if (entry.settled) {
          // An abandoned open has no owner that can close its server handle.
          this.fail(
            new SFTPError('VIEWER_REMOTE_OFFLINE', 'A cancelled open retired the server channel.'),
          );
          return;
        }
      }
    }
    if (entry.request.kind === 'close' && reply.kind === 'status' && reply.status === 0) {
      this.handles.delete(entry.request.handle.toString('hex'));
    }
    this.settle(entry, undefined, reply);
    this.pump();
  }

  private allocateID(): number {
    while (this.pending.has(this.nextID)) this.nextID = (this.nextID + 1) >>> 0;
    const id = this.nextID;
    this.nextID = (this.nextID + 1) >>> 0;
    return id;
  }

  private request(
    request: SFTPRequest,
    expected: ReplyKind,
    options: SFTPRequestOptions,
    negotiating = false,
  ): Promise<RequestReply> {
    if (this.state !== 'ready' && !(negotiating && this.state === 'negotiating')) {
      return Promise.reject(this.disconnected());
    }
    if (options.signal?.aborted) return Promise.reject(sftpAbortError());
    if (this.queue.length >= 1024) {
      return Promise.reject(
        new SFTPError('VIEWER_REMOTE_FAILURE', 'The server request queue is full.'),
      );
    }
    const timeout = options.timeoutMs === undefined ? this.metadataTimeoutMs : options.timeoutMs;
    if (timeout !== null && (!Number.isFinite(timeout) || timeout <= 0)) {
      return Promise.reject(new SFTPProtocolError('Invalid SFTP request timeout.'));
    }
    return new Promise<RequestReply>((resolve, reject) => {
      const entry: PendingRequest = {
        request,
        expected,
        resolve,
        reject,
        settled: false,
        signal: options.signal,
        timer:
          timeout === null
            ? undefined
            : setTimeout(() => {
                const error = new SFTPError(
                  'VIEWER_REMOTE_TIMEOUT',
                  'The server request timed out.',
                );
                if (entry.id !== undefined) this.fail(error);
                else {
                  this.queue.splice(this.queue.indexOf(entry), 1);
                  this.settle(entry, error);
                }
              }, timeout),
        abort: () => {
          this.settle(entry, sftpAbortError());
          if (entry.id === undefined) {
            clearTimeout(entry.timer);
            this.queue.splice(this.queue.indexOf(entry), 1);
            this.pump();
          } else if (entry.timer === undefined) {
            // Abandoned stream credits must eventually retire even if the peer never replies.
            entry.timer = setTimeout(
              () =>
                this.fail(
                  new SFTPError(
                    'VIEWER_REMOTE_TIMEOUT',
                    'The server did not drain a cancelled request.',
                  ),
                ),
              remoteLimits.transferStallTimeoutMs,
            );
          }
        },
      };
      this.queue.push(entry);
      options.signal?.addEventListener('abort', entry.abort, { once: true });
      this.pump();
    });
  }

  private pump(): void {
    if (this.pumping || this.state === 'closed') return;
    this.pumping = true;
    try {
      while (
        this.writable &&
        this.queue.length &&
        this.pending.size < remoteLimits.requestsPerChannel
      ) {
        const entry = this.queue.shift()!;
        const opens = entry.request.kind === 'open' || entry.request.kind === 'opendir';
        const handleLimit = boundedLimit(this.limitsValue.openHandles, 1024);
        if (opens && this.handles.size + this.openingHandles >= handleLimit) {
          clearTimeout(entry.timer);
          this.settle(
            entry,
            new SFTPError('VIEWER_REMOTE_FAILURE', 'The server open-handle limit was reached.'),
          );
          continue;
        }
        const id = this.allocateID();
        let bytes: Buffer;
        try {
          bytes = encodeRequest(id, entry.request);
          protocolAssert(
            bytes.length <= this.packetLimit,
            'The request exceeds the server packet limit.',
          );
        } catch (error) {
          clearTimeout(entry.timer);
          this.settle(
            entry,
            error instanceof Error ? error : new SFTPProtocolError('Invalid SFTP request.'),
          );
          continue;
        }
        entry.id = id;
        this.pending.set(id, entry);
        if (opens) this.openingHandles++;
        this.writable = this.transport.write(bytes);
      }
    } catch {
      this.lost();
    } finally {
      this.pumping = false;
    }
  }

  private async operation(
    request: SFTPRequest,
    expected: ReplyKind,
    options: SFTPRequestOptions = {},
    eof = false,
  ): Promise<RequestReply | undefined> {
    const reply = await this.request(request, expected, options);
    if (reply.kind === 'status') {
      if (eof && reply.status === 1) return undefined;
      if (reply.status !== 0) throw sftpStatusError(reply.status, reply.message);
    }
    return reply;
  }

  private async extension(
    request: SFTPRequest,
    kind: keyof typeof sftpExtensions,
    expected: ReplyKind,
    options: SFTPRequestOptions,
  ): Promise<RequestReply> {
    if (!this.connected) throw this.disconnected();
    if (!this.supports(kind))
      throw new SFTPError('ENOTSUP', 'The server does not offer this SFTP extension.');
    return (await this.operation(request, expected, options))!;
  }

  private decodeExtension<T>(reply: RequestReply, decode: (data: Buffer) => T): T {
    try {
      if (reply.kind === 'status') throw sftpStatusError(reply.status, reply.message);
      protocolAssert(reply.kind === 'extendedReply', 'Unexpected SFTP extension reply.');
      return decode(reply.data);
    } catch (error) {
      if (error instanceof SFTPProtocolError) this.fail(error);
      throw error;
    }
  }

  async open(
    path: Buffer,
    mode: SFTPOpenMode,
    attrs: SFTPSetAttributes = {},
    options: SFTPRequestOptions = {},
  ): Promise<Buffer> {
    const reply = await this.operation({ kind: 'open', path, mode, attrs }, 'handle', options);
    return (reply as Extract<RequestReply, { kind: 'handle' }>).handle;
  }

  async close(handle: Buffer, options: SFTPRequestOptions = {}): Promise<void> {
    await this.operation({ kind: 'close', handle }, 'status', options);
  }

  async read(
    handle: Buffer,
    offset: bigint,
    length: number,
    options: SFTPRequestOptions = {},
  ): Promise<Buffer | undefined> {
    protocolAssert(
      Number.isInteger(length) && length > 0 && length <= this.readChunkBytes,
      'The read exceeds the server limits.',
    );
    const reply = await this.operation(
      { kind: 'read', handle, offset, length },
      'data',
      options,
      true,
    );
    return reply ? (reply as Extract<RequestReply, { kind: 'data' }>).data : undefined;
  }

  async write(
    handle: Buffer,
    offset: bigint,
    data: Buffer,
    options: SFTPRequestOptions = {},
  ): Promise<void> {
    protocolAssert(
      data.length <= this.writeChunkBytes(handle),
      'The write exceeds the server limits.',
    );
    await this.operation({ kind: 'write', handle, offset, data }, 'status', options);
  }

  async lstat(path: Buffer, options: SFTPRequestOptions = {}): Promise<SFTPAttributes> {
    const reply = await this.operation({ kind: 'lstat', path }, 'attrs', options);
    return (reply as Extract<RequestReply, { kind: 'attrs' }>).attrs;
  }

  async stat(path: Buffer, options: SFTPRequestOptions = {}): Promise<SFTPAttributes> {
    const reply = await this.operation({ kind: 'stat', path }, 'attrs', options);
    return (reply as Extract<RequestReply, { kind: 'attrs' }>).attrs;
  }

  async fstat(handle: Buffer, options: SFTPRequestOptions = {}): Promise<SFTPAttributes> {
    const reply = await this.operation({ kind: 'fstat', handle }, 'attrs', options);
    return (reply as Extract<RequestReply, { kind: 'attrs' }>).attrs;
  }

  async setstat(
    path: Buffer,
    attrs: SFTPSetAttributes,
    options: SFTPRequestOptions = {},
  ): Promise<void> {
    await this.operation({ kind: 'setstat', path, attrs }, 'status', options);
  }

  async fsetstat(
    handle: Buffer,
    attrs: SFTPSetAttributes,
    options: SFTPRequestOptions = {},
  ): Promise<void> {
    await this.operation({ kind: 'fsetstat', handle, attrs }, 'status', options);
  }

  async opendir(path: Buffer, options: SFTPRequestOptions = {}): Promise<Buffer> {
    const reply = await this.operation({ kind: 'opendir', path }, 'handle', options);
    return (reply as Extract<RequestReply, { kind: 'handle' }>).handle;
  }

  async readdir(
    handle: Buffer,
    options: SFTPRequestOptions = {},
  ): Promise<readonly SFTPName[] | undefined> {
    const reply = await this.operation({ kind: 'readdir', handle }, 'name', options, true);
    return reply ? (reply as Extract<RequestReply, { kind: 'name' }>).names : undefined;
  }

  async mkdir(
    path: Buffer,
    attrs: SFTPSetAttributes = {},
    options: SFTPRequestOptions = {},
  ): Promise<void> {
    await this.operation({ kind: 'mkdir', path, attrs }, 'status', options);
  }

  private async oneName(
    kind: 'realpath' | 'readlink',
    path: Buffer,
    options: SFTPRequestOptions,
  ): Promise<Buffer> {
    const reply = await this.operation({ kind, path }, 'name', options);
    const names = (reply as Extract<RequestReply, { kind: 'name' }>).names;
    if (names.length !== 1) {
      const error = new SFTPProtocolError('The server must return exactly one resolved path.');
      this.fail(error);
      throw error;
    }
    return names[0]!.filename;
  }

  realpath(path: Buffer, options: SFTPRequestOptions = {}): Promise<Buffer> {
    return this.oneName('realpath', path, options);
  }

  async readlink(path: Buffer, options: SFTPRequestOptions = {}): Promise<Buffer> {
    this.requireOpenSSHLinks();
    return this.oneName('readlink', path, options);
  }

  async rename(from: Buffer, to: Buffer, options: SFTPRequestOptions = {}): Promise<void> {
    await this.operation({ kind: 'rename', from, to }, 'status', options);
  }

  async symlink(target: Buffer, path: Buffer, options: SFTPRequestOptions = {}): Promise<void> {
    this.requireOpenSSHLinks();
    await this.operation({ kind: 'symlink', target, path }, 'status', options);
  }

  private requireOpenSSHLinks(): void {
    if (!this.connected) throw this.disconnected();
    if (![...this.extensionsValue.keys()].some((name) => name.endsWith('@openssh.com'))) {
      throw new SFTPError(
        'ENOTSUP',
        'The server does not identify OpenSSH link argument ordering.',
      );
    }
  }

  async statvfs(path: Buffer, options: SFTPRequestOptions = {}): Promise<SFTPStatVFS> {
    const reply = await this.extension(
      { kind: 'statvfs', path },
      'statvfs',
      'extendedReply',
      options,
    );
    return this.decodeExtension(reply, decodeStatVFS);
  }

  async fsync(handle: Buffer, options: SFTPRequestOptions = {}): Promise<void> {
    await this.extension({ kind: 'fsync', handle }, 'fsync', 'status', options);
  }

  async copyData(
    source: Buffer,
    sourceOffset: bigint,
    length: bigint,
    destination: Buffer,
    destinationOffset: bigint,
    options: SFTPRequestOptions = {},
  ): Promise<void> {
    await this.extension(
      { kind: 'copyData', source, sourceOffset, length, destination, destinationOffset },
      'copyData',
      'status',
      options,
    );
  }

  async usersGroupsByID(
    uids: readonly number[],
    gids: readonly number[],
    options: SFTPRequestOptions = {},
  ): Promise<SFTPUsersGroups> {
    const reply = await this.extension(
      { kind: 'usersGroups', uids, gids },
      'usersGroups',
      'extendedReply',
      options,
    );
    return this.decodeExtension(reply, (data) => decodeUsersGroups(data, uids.length, gids.length));
  }
}
