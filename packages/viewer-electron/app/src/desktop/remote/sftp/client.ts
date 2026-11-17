import type { Duplex } from 'node:stream';
import type { SFTPStreamActivity, SFTPStreamOptions } from './streams';
import type {
  SFTPAttributes,
  SFTPName,
  SFTPOpenMode,
  SFTPCreateAttributes,
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
import { SFTPStreamLifetime, sftpStreamActivity } from './streams';

export interface SFTPRequestOptions {
  signal?: AbortSignal;
  /** Streams share a progress clock and disable individual request deadlines. */
  timeoutMs?: number | null;
}

export interface SFTPClientOptions {
  initialRequestID?: number;
  metadataTimeoutMs?: number;
}

export type SFTPCopyOptions = Pick<SFTPStreamOptions, 'signal' | 'stallTimeoutMs' | 'onProgress'>;

type ClientState = 'disconnected' | 'negotiating' | 'ready' | 'closed';
type RequestReply = Exclude<SFTPReply, { kind: 'version' }>;
type ReplyKind = RequestReply['kind'];

/**
 * Requests outside streams share one flow and each stream is its own. Flows take turns for wire
 * credit, least recently served first; a new flow starts at the turn current when it first queues.
 */
interface Flow {
  readonly queue: PendingRequest[];
  turn: number;
  /** Queued and unanswered requests; a stream's window keeps this within channel credit. */
  requests: number;
}

interface PendingRequest {
  request: SFTPRequest;
  expected: ReplyKind;
  resolve: (reply: RequestReply) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  timeoutMs: number | null;
  signal?: AbortSignal;
  abort: () => void;
  settled: boolean;
  id?: number;
  handleGeneration?: number;
  activity?: SFTPStreamActivity;
  wireActive: boolean;
  flow: Flow;
  cleanup: boolean;
  /** Enqueue order breaks ties between flows on the same turn. */
  sequence: number;
  /** Channel replies seen when the request queued. */
  repliesQueued: number;
  /** Write order, and how many earlier writes were unanswered at the last deadline. */
  written: number;
  ahead: number;
}

const unlimited: SFTPServerLimits = {
  packetLength: 0n,
  readLength: 0n,
  writeLength: 0n,
  openHandles: 0n,
};

const boundedLimit = (limit: bigint, maximum: number): number =>
  limit === 0n || limit > BigInt(maximum) ? maximum : Number(limit);

const opensHandle = (request: SFTPRequest): boolean =>
  request.kind === 'open' || request.kind === 'opendir';

/**
 * The transport owns authentication. Server messages are display text; callers branch on codes.
 * OpenSSH handles requests on one thread: packages 4 and 6 must lstat before OPEN, because a
 * FIFO can block the channel while listing or previewing.
 */
export class SFTPClient {
  private state: ClientState = 'disconnected';
  private readonly framer = new SFTPFramer();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly metadataFlow: Flow = { queue: [], turn: 0, requests: 0 };
  private readonly streamFlows = new WeakMap<SFTPStreamActivity, Flow>();
  /** Flows with queued requests, so choosing the next request scans flows, not requests. */
  private readonly waitingFlows = new Set<Flow>();
  /** CLOSE requests for handles whose callers left; they go before any flow. */
  private readonly cleanups: PendingRequest[] = [];
  private queued = 0;
  private turn = 0;
  private sequence = 0;
  private writes = 0;
  private replies = 0;
  private readonly handles = new Map<string, number>();
  private handleGeneration = 0;
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
      queued: this.queued,
      abandoned: [...this.pending.values()].filter((entry) => entry.settled).length,
      handles: this.handles.size + this.openingHandles,
    };
  }

  get readChunkBytes(): number {
    return Math.max(
      0,
      Math.min(
        boundedLimit(this.limitsValue.readLength, sftpBounds.dataBytes),
        this.packetLimit - 13,
      ),
    );
  }

  writeChunkBytes(handle: Buffer): number {
    return Math.max(
      0,
      Math.min(
        boundedLimit(this.limitsValue.writeLength, sftpBounds.dataBytes),
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
          if (reply.kind !== 'status') this.limitsValue = this.decodeExtension(reply, decodeLimits);
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
    const queued = [...this.cleanups, ...[...this.waitingFlows].flatMap((flow) => flow.queue)];
    for (const entry of [...queued, ...this.pending.values()]) {
      this.releaseWire(entry);
      this.settle(entry, error);
      clearTimeout(entry.timer);
    }
    for (const flow of this.waitingFlows) flow.queue.length = 0;
    this.waitingFlows.clear();
    this.cleanups.length = 0;
    this.queued = 0;
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

  private releaseWire(entry: PendingRequest): void {
    if (!entry.wireActive) return;
    entry.wireActive = false;
    entry.activity?.replied();
  }

  private reply(reply: SFTPReply): void {
    if (reply.kind === 'version') {
      protocolAssert(
        this.state === 'negotiating' && this.versionResolve !== undefined,
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
    if (entry.request.kind === 'readdir' && reply.kind === 'name') {
      protocolAssert(reply.names.length > 0, 'Empty SFTP directory reply.');
    }
    if (
      (entry.request.kind === 'open' || entry.request.kind === 'opendir') &&
      reply.kind === 'handle'
    ) {
      const key = reply.handle.toString('hex');
      const generation = this.handles.get(key);
      const closing = [...this.pending.values()].some(
        (candidate) =>
          candidate.request.kind === 'close' &&
          candidate.request.handle.toString('hex') === key &&
          candidate.handleGeneration === generation,
      );
      protocolAssert(generation === undefined || closing, 'Duplicate SFTP handle.');
    }
    this.pending.delete(reply.id);
    this.replies++;
    entry.flow.requests--;
    this.releaseWire(entry);
    clearTimeout(entry.timer);
    if (entry.request.kind === 'open' || entry.request.kind === 'opendir') {
      this.openingHandles--;
      if (reply.kind === 'handle') {
        this.handles.set(reply.handle.toString('hex'), ++this.handleGeneration);
        if (entry.settled) {
          // Ownership transfers to the channel when the requesting caller has already left.
          void this.request(
            { kind: 'close', handle: reply.handle },
            'status',
            {},
            false,
            true,
          ).catch(() => {});
        }
      }
    }
    if (entry.request.kind === 'close' && reply.kind === 'status') {
      const key = entry.request.handle.toString('hex');
      if (this.handles.get(key) === entry.handleGeneration) this.handles.delete(key);
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
    cleanup = false,
  ): Promise<RequestReply> {
    if (this.state !== 'ready' && !(negotiating && this.state === 'negotiating')) {
      return Promise.reject(this.disconnected());
    }
    if (options.signal?.aborted) return Promise.reject(sftpAbortError());
    const activity = sftpStreamActivity(options);
    let flow = this.metadataFlow;
    if (activity) {
      flow = this.streamFlows.get(activity) ?? { queue: [], turn: this.turn, requests: 0 };
      this.streamFlows.set(activity, flow);
      // Pipelined reads and writes never exceed channel credit; more means a misused lifetime.
      if (flow.requests >= remoteLimits.requestsPerChannel)
        return Promise.reject(new SFTPProtocolError('An SFTP stream exceeded its request window.'));
    } else if (!cleanup && flow.queue.length >= sftpBounds.queueRequests) {
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
        activity,
        wireActive: false,
        flow,
        cleanup,
        sequence: ++this.sequence,
        repliesQueued: this.replies,
        written: 0,
        ahead: 0,
        timeoutMs: timeout,
        signal: options.signal,
        // Written requests swap this for a wire deadline, so it only ever expires a queued one.
        timer:
          timeout === null
            ? undefined
            : setTimeout(() => {
                const error = new SFTPError(
                  'VIEWER_REMOTE_TIMEOUT',
                  'The server request timed out.',
                );
                this.dequeue(entry);
                this.settle(entry, error);
                // Credit held for a whole metadata timeout without one reply is a hung server,
                // even when paused stream consumers stopped their own stall clocks.
                if (
                  timeout >= this.metadataTimeoutMs &&
                  this.pending.size > 0 &&
                  this.replies === entry.repliesQueued
                )
                  this.fail(error);
              }, timeout),
        abort: () => {
          this.settle(entry, sftpAbortError());
          if (entry.id === undefined) {
            clearTimeout(entry.timer);
            this.dequeue(entry);
            this.pump();
          } else if (entry.timer === undefined) {
            // Abandoned stream credits must eventually retire even if the peer never replies.
            entry.timer = setTimeout(
              () =>
                this.fail(
                  new SFTPError(
                    'VIEWER_REMOTE_TIMEOUT',
                    'The server did not drain a canceled request.',
                  ),
                ),
              remoteLimits.transferStallTimeoutMs,
            );
          }
        },
      };
      flow.requests++;
      this.queued++;
      if (cleanup) this.cleanups.push(entry);
      else {
        flow.queue.push(entry);
        this.waitingFlows.add(flow);
      }
      options.signal?.addEventListener('abort', entry.abort, { once: true });
      this.pump();
    });
  }

  /** Takes a queued request off its queue; `false` when it was not queued. */
  private unqueue(entry: PendingRequest): boolean {
    const queue = entry.cleanup ? this.cleanups : entry.flow.queue;
    const index = queue.indexOf(entry);
    if (index === -1) return false;
    queue.splice(index, 1);
    if (!entry.cleanup && queue.length === 0) this.waitingFlows.delete(entry.flow);
    this.queued--;
    return true;
  }

  /** Forgets a request that leaves the queue without being written. */
  private dequeue(entry: PendingRequest): void {
    if (this.unqueue(entry)) entry.flow.requests--;
  }

  /**
   * An orphan CLOSE goes first. Otherwise the flow that sent least recently goes next, in queue
   * order within a flow, so a listing waits one turn per stream with queued work when it queued.
   */
  private nextQueued(): PendingRequest | undefined {
    if (this.cleanups.length) return this.cleanups[0];
    const handleLimit = boundedLimit(this.limitsValue.openHandles, sftpBounds.openHandles);
    const handleFree = this.handles.size + this.openingHandles < handleLimit;
    let chosen: PendingRequest | undefined;
    for (const flow of this.waitingFlows) {
      const head = handleFree
        ? flow.queue[0]
        : flow.queue.find((candidate) => !opensHandle(candidate.request));
      if (!head) continue;
      if (
        !chosen ||
        flow.turn < chosen.flow.turn ||
        (flow.turn === chosen.flow.turn && head.sequence < chosen.sequence)
      )
        chosen = head;
    }
    return chosen;
  }

  /** A serial server is busy, not hung, while it still answers requests written earlier. */
  private armWireDeadline(entry: PendingRequest, timeout: number): void {
    entry.timer = setTimeout(() => {
      let ahead = 0;
      for (const other of this.pending.values()) if (other.written < entry.written) ahead++;
      if (ahead < entry.ahead) {
        entry.ahead = ahead;
        this.armWireDeadline(entry, timeout);
        return;
      }
      this.fail(new SFTPError('VIEWER_REMOTE_TIMEOUT', 'The server request timed out.'));
    }, timeout);
  }

  private pump(): void {
    if (this.pumping || this.state === 'closed') return;
    this.pumping = true;
    try {
      while (
        this.writable &&
        this.queued > 0 &&
        this.pending.size < remoteLimits.requestsPerChannel
      ) {
        const entry = this.nextQueued();
        if (!entry) break;
        this.unqueue(entry);
        const opens = opensHandle(entry.request);
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
          entry.flow.requests--;
          this.settle(
            entry,
            error instanceof Error ? error : new SFTPProtocolError('Invalid SFTP request.'),
          );
          continue;
        }
        entry.id = id;
        if (entry.request.kind === 'close')
          entry.handleGeneration = this.handles.get(entry.request.handle.toString('hex'));
        clearTimeout(entry.timer);
        entry.timer = undefined;
        entry.written = ++this.writes;
        // Every unanswered request was written earlier, so all of them are ahead of this one.
        entry.ahead = this.pending.size;
        if (entry.timeoutMs !== null) this.armWireDeadline(entry, entry.timeoutMs);
        this.pending.set(id, entry);
        if (!entry.cleanup) entry.flow.turn = ++this.turn;
        entry.wireActive = true;
        entry.activity?.sent();
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
    attrs: SFTPCreateAttributes = {},
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

  /** OpenSSH ignores MKDIR times; set them with SETSTAT after creating the folder. */
  async mkdir(
    path: Buffer,
    attrs: SFTPCreateAttributes = {},
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
    const result = names[0]!.filename;
    if (
      result.length > remoteLimits.serverPathBytes ||
      result.includes(0) ||
      (kind === 'realpath' && result[0] !== 47)
    ) {
      const error = new SFTPProtocolError('Invalid SFTP resolved path.');
      this.fail(error);
      throw error;
    }
    return result;
  }

  realpath(path: Buffer, options: SFTPRequestOptions = {}): Promise<Buffer> {
    return this.oneName('realpath', path, options);
  }

  async readlink(path: Buffer, options: SFTPRequestOptions = {}): Promise<Buffer> {
    return this.oneName('readlink', path, options);
  }

  async rename(from: Buffer, to: Buffer, options: SFTPRequestOptions = {}): Promise<void> {
    try {
      await this.lstat(to, options);
    } catch (error) {
      if (!(error instanceof SFTPError) || error.code !== 'ENOENT') throw error;
      await this.operation({ kind: 'rename', from, to }, 'status', options);
      return;
    }
    throw new SFTPError('VIEWER_REMOTE_FAILURE', 'The server destination already exists.');
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

  /**
   * Copies exactly `length` bytes or fails, reporting progress only for bytes it verified.
   *
   * OpenSSH answers copy-data OK when the last 64 KiB of a request fail or end early, so a short
   * source, a read-only destination, a full disk or a folder handle can all look like success.
   * The client reads both sizes first: a source that ends before the range gives
   * `VIEWER_REMOTE_SHORT_SOURCE`; a size the server does not report, or a destination already
   * past `destinationOffset`, gives `ENOTSUP`, and the caller copies by streaming. After each
   * block, the destination must reach the bytes copied so far; when it does not, the result is
   * `VIEWER_REMOTE_SHORT_SOURCE` if the source is also short, else `VIEWER_REMOTE_FAILURE`, and
   * bytes past the verified total may be on the server. A zero length checks only the range and
   * the extension and sends nothing.
   */
  async copyData(
    source: Buffer,
    sourceOffset: bigint,
    length: bigint,
    destination: Buffer,
    destinationOffset: bigint,
    options: SFTPCopyOptions = {},
  ): Promise<void> {
    protocolAssert(
      length >= 0n &&
        sourceOffset >= 0n &&
        destinationOffset >= 0n &&
        sourceOffset + length <= 0xffffffffffffffffn &&
        destinationOffset + length <= 0xffffffffffffffffn,
      'Invalid SFTP copy range.',
    );
    if (!this.connected) throw this.disconnected();
    if (!this.supports('copyData'))
      throw new SFTPError('ENOTSUP', 'The server does not offer this SFTP extension.');
    if (length === 0n) return;
    const lifetime = new SFTPStreamLifetime(this, options);
    const end = sourceOffset + length;
    const shortSource = (): SFTPError =>
      new SFTPError(
        'VIEWER_REMOTE_SHORT_SOURCE',
        'The server copy source ends before the copied range.',
      );
    const sizeOf = async (handle: Buffer): Promise<bigint | undefined> =>
      (await lifetime.wait(this.fstat(handle, lifetime.request))).size;
    let copied = 0n;
    try {
      const sourceSize = await sizeOf(source);
      const destinationSize = await sizeOf(destination);
      if (sourceSize === undefined || destinationSize === undefined)
        throw new SFTPError('ENOTSUP', 'The server did not report the copy file sizes.');
      if (sourceSize < end) throw shortSource();
      // Growth proves what landed only while nothing already lies at or past the offset.
      if (destinationSize > destinationOffset)
        throw new SFTPError(
          'ENOTSUP',
          'Server-side copy writes only at or past the end of the destination.',
        );
      while (copied < length) {
        lifetime.check();
        const remaining = length - copied;
        const block =
          remaining < BigInt(remoteLimits.readBytesPerStream)
            ? remaining
            : BigInt(remoteLimits.readBytesPerStream);
        try {
          await lifetime.wait(
            this.extension(
              {
                kind: 'copyData',
                source,
                sourceOffset: sourceOffset + copied,
                length: block,
                destination,
                destinationOffset: destinationOffset + copied,
              },
              'copyData',
              'status',
              lifetime.request,
            ),
          );
        } catch (error) {
          // OpenSSH answers END OF FILE when the source ends before the last 64 KiB.
          if (error instanceof SFTPError && error.status === 1) throw shortSource();
          throw error;
        }
        const size = await sizeOf(destination);
        if (size === undefined || size < destinationOffset + copied + block) {
          const now = await sizeOf(source);
          if (now !== undefined && now < end) throw shortSource();
          throw new SFTPError('VIEWER_REMOTE_FAILURE', 'The server copied fewer bytes than asked.');
        }
        copied += block;
        lifetime.progress(Number(block));
      }
    } finally {
      lifetime.finish();
    }
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
