import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Duplex } from 'node:stream';
import { ZodError } from 'zod';
import { remoteConnection } from '../../domain/remote/connections';
import { remoteLimits } from '../../domain/remote/limits';
import { remotePath } from '../../domain/remote/location';
import { remoteFeatureEnabled } from '../../domain/remote/feature';
import { sshArguments } from '../../domain/remote/ssh-arguments';
import { classifySSHFailure, SSHConnectionError } from '../../domain/remote/ssh-errors';
import { workerPort } from '../workers/worker-port';
import type { ClientMethods, WorkerRequest } from '../workers/utility-client';
import { testSSHExecutable } from './control';
import { remoteEnvironment } from './environment';
import { SFTPClient } from './sftp/client';
import { decodeListingName } from './sftp/codec';
import type { SFTPListingName } from './sftp/codec';
import { SFTPError } from './sftp/errors';
import { pread, pwrite } from './sftp/streams';
import { remoteLanes } from './lanes';
import type { RemoteLane } from './lanes';
import type {
  RemoteMethods,
  RemotePrimitive,
  RemotePrimitiveReply,
  RemoteSessionConfiguration,
} from './session';

// "Viewer servers": every ssh child that carries SFTP, one client per channel, and the lanes
// that share each channel. Main keeps policy and authority; this process only moves bytes.

interface Channel {
  child: ChildProcessWithoutNullStreams;
  client: SFTPClient;
  /** Closed on purpose (idle or Disconnect): its exit is not a lost connection. */
  closing: boolean;
}

interface Session {
  configuration: RemoteSessionConfiguration;
  channels: Map<RemoteLane, Promise<Channel>>;
  opened: Set<Channel>;
  stopped: boolean;
}

interface Job {
  signal: AbortSignal;
  thumbnail: boolean;
  run(): Promise<void>;
}

/** A request the worker refuses before touching the server. */
class RemoteRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const stderrCharacters = 64 * 1024;
const laneConcurrency = 16;
const regularFile = (permissions: number | undefined) =>
  permissions !== undefined && (permissions & 0xf000) === 0x8000;

/** Foreground work goes first; thumbnails take what is left, at most two at a time. */
class LaneScheduler {
  private queued: Job[] = [];
  private active = 0;
  private thumbnails = 0;

  run<T>(signal: AbortSignal, thumbnail: boolean, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queued.push({
        signal,
        thumbnail,
        run: async () => {
          try {
            signal.throwIfAborted();
            resolve(await work());
          } catch (error) {
            reject(error);
          }
        },
      });
      this.queued.sort((left, right) => Number(left.thumbnail) - Number(right.thumbnail));
      this.pump();
    });
  }

  private next(): Job | undefined {
    const index = this.queued.findIndex(
      (job) => !job.thumbnail || this.thumbnails < remoteLimits.thumbnailsPerConnection,
    );
    return index < 0 ? undefined : this.queued.splice(index, 1)[0];
  }

  private pump(): void {
    while (this.active < laneConcurrency) {
      const job = this.next();
      if (!job) {
        return;
      }
      this.active++;
      if (job.thumbnail) {
        this.thumbnails++;
      }
      void job.run().finally(() => {
        this.active--;
        if (job.thumbnail) {
          this.thumbnails--;
        }
        this.pump();
      });
    }
  }
}

const sessions = new Map<string, Session>();
const requests = new Map<string, { connectionID: string; controller: AbortController }>();
const schedulers = new Map<string, LaneScheduler>();

/** `intentional` for idle and Disconnect; a channel that failed to open is still a loss. */
function closeChannel(channel: Channel, intentional = true): void {
  channel.closing ||= intentional;
  channel.client.disconnect();
  channel.child.kill();
  const child = channel.child;
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, 100).unref();
}

/** The ssh child's stdio as one byte stream for the SFTP client, with backpressure both ways. */
function childTransport(child: ChildProcessWithoutNullStreams): Duplex {
  const transport = new Duplex({
    read() {
      child.stdout.resume();
    },
    write(bytes, encoding, callback) {
      child.stdin.write(bytes, encoding, callback);
    },
    final(callback) {
      child.stdin.end(callback);
    },
    destroy(error, callback) {
      child.stdin.destroy();
      child.stdout.destroy();
      child.kill();
      callback(error);
    },
  });
  child.stdout.on('data', (bytes: Buffer) => {
    if (!transport.push(bytes)) {
      child.stdout.pause();
    }
  });
  child.stdout.on('end', () => transport.push(null));
  child.stdin.on('error', (error) => transport.destroy(error));
  child.stdout.on('error', (error) => transport.destroy(error));
  transport.on('error', () => {});
  return transport;
}

async function openChannel(session: Session): Promise<Channel> {
  const configuration = session.configuration;
  const command = sshArguments(configuration.connection, {
    kind: 'sftp',
    controlPath: configuration.controlPath,
  });
  const child = spawn(testSSHExecutable(configuration.sshExecutable), command.args, {
    env: remoteEnvironment(),
    stdio: 'pipe',
  });
  const transport = childTransport(child);
  const client = new SFTPClient(transport);
  const channel: Channel = { child, client, closing: false };
  let stderr = '';
  child.stderr.on('data', (bytes: Buffer) => {
    if (stderr.length < stderrCharacters) {
      stderr += bytes.toString('utf8').slice(0, stderrCharacters - stderr.length);
    }
  });
  child.on('error', () => transport.destroy(new Error('The SSH channel could not start.')));
  child.once('exit', (code) => {
    session.opened.delete(channel);
    const failure = classifySSHFailure(code, stderr);
    transport.destroy(failure ? new SSHConnectionError(failure) : undefined);
    if (!session.stopped && !channel.closing) {
      workerPort?.postMessage({ event: 'remote-channel-lost', value: configuration.connection.id });
    }
  });
  session.opened.add(channel);
  if (session.stopped) {
    closeChannel(channel);
    throw new RemoteRequestError('VIEWER_REMOTE_DISCONNECTED', 'Connect to this server first.');
  }
  try {
    await client.connect();
  } catch (error) {
    closeChannel(channel, false);
    throw error;
  }
  return channel;
}

function channel(session: Session, lane: RemoteLane): Promise<Channel> {
  const existing = session.channels.get(lane);
  if (existing) {
    return existing;
  }
  const pending = openChannel(session);
  session.channels.set(lane, pending);
  pending.then(
    (opened) =>
      opened.child.once('exit', () => {
        if (session.channels.get(lane) === pending) {
          session.channels.delete(lane);
        }
      }),
    () => {
      if (session.channels.get(lane) === pending) {
        session.channels.delete(lane);
      }
    },
  );
  return pending;
}

function checkBounds(request: RemotePrimitive): void {
  if (
    request.type === 'read' &&
    (!Number.isSafeInteger(request.length) ||
      request.length < 0 ||
      request.length > remoteLimits.readBytesPerStream ||
      request.offset < 0n)
  ) {
    throw new RemoteRequestError('VIEWER_REMOTE_LIMIT', 'The server read exceeds its byte limit.');
  }
  if (request.type === 'write' && request.bytes.byteLength > remoteLimits.readBytesPerStream) {
    throw new RemoteRequestError('VIEWER_REMOTE_LIMIT', 'The server write exceeds its byte limit.');
  }
}

async function list(client: SFTPClient, file: Buffer, signal: AbortSignal) {
  const handle = await client.opendir(file, { signal });
  const entries: SFTPListingName[] = [];
  let truncated = false;
  try {
    for (let names = await client.readdir(handle, { signal }); names;) {
      for (const name of names) {
        const entry = decodeListingName(name);
        if (entry.kind === 'skip') {
          continue;
        }
        if (entries.length >= remoteLimits.listingEntries) {
          truncated = true;
          break;
        }
        entries.push(entry);
      }
      names = truncated ? undefined : await client.readdir(handle, { signal });
    }
  } finally {
    await client.close(handle).catch(() => {});
  }
  return { type: 'list' as const, entries, truncated };
}

async function read(
  client: SFTPClient,
  file: Buffer,
  request: Extract<RemotePrimitive, { type: 'read' }>,
  signal: AbortSignal,
) {
  // A FIFO would block the whole channel on OPEN, so only a regular file is opened.
  if (!regularFile((await client.stat(file, { signal })).permissions)) {
    throw new RemoteRequestError(
      'VIEWER_REMOTE_NOT_FILE',
      'Only regular server files can be read.',
    );
  }
  const handle = await client.open(file, 'read', undefined, { signal });
  try {
    if (!regularFile((await client.fstat(handle, { signal })).permissions)) {
      throw new RemoteRequestError(
        'VIEWER_REMOTE_CHANGED',
        'The server file changed before reading.',
      );
    }
    const chunks: Buffer[] = [];
    const range = { signal, offset: request.offset, length: BigInt(request.length) };
    for await (const chunk of pread(client, handle, range)) {
      chunks.push(chunk);
    }
    return { type: 'read' as const, bytes: Buffer.concat(chunks) };
  } finally {
    await client.close(handle).catch(() => {});
  }
}

async function write(
  client: SFTPClient,
  file: Buffer,
  request: Extract<RemotePrimitive, { type: 'write' }>,
  signal: AbortSignal,
) {
  // Exclusive creation: an existing item is never replaced or truncated.
  const attributes =
    request.permissions === undefined ? undefined : { permissions: request.permissions };
  const handle = await client.open(file, 'create', attributes, { signal });
  try {
    const bytes = await pwrite(client, handle, [Buffer.from(request.bytes)], { signal });
    return { type: 'write' as const, bytes };
  } finally {
    await client.close(handle).catch(() => {});
  }
}

async function perform(
  session: Session,
  lane: RemoteLane,
  request: RemotePrimitive,
  signal: AbortSignal,
): Promise<RemotePrimitiveReply> {
  checkBounds(request);
  const file = Buffer.from(request.type === 'home' ? '.' : remotePath.parse(request.path));
  const { client } = await channel(session, lane);
  signal.throwIfAborted();
  switch (request.type) {
    case 'home':
    case 'realpath': {
      const resolved = await client.realpath(file, { signal });
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(resolved);
      return { type: 'path', path: remotePath.parse(text) };
    }
    case 'stat': {
      const attributes = request.follow
        ? await client.stat(file, { signal })
        : await client.lstat(file, { signal });
      return { type: 'stat', attributes };
    }
    case 'list':
      return list(client, file, signal);
    case 'read':
      return read(client, file, request, signal);
    case 'write':
      return write(client, file, request, signal);
  }
}

/** The next request on a lane opens a fresh channel through the same master. */
function closeChannels(session: Session): void {
  for (const opened of session.opened) {
    closeChannel(opened);
  }
  session.opened.clear();
  session.channels.clear();
}

function disconnect(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  sessions.delete(id);
  session.stopped = true;
  for (const request of requests.values()) {
    if (request.connectionID === id) {
      request.controller.abort();
    }
  }
  closeChannels(session);
  for (const lane of remoteLanes) {
    schedulers.delete(id + ':' + lane);
  }
}

function configure(configuration: RemoteSessionConfiguration): void {
  configuration.connection = remoteConnection.parse(configuration.connection);
  sshArguments(configuration.connection, {
    kind: 'sftp',
    controlPath: configuration.controlPath,
  });
  testSSHExecutable(configuration.sshExecutable);
  disconnect(configuration.connection.id);
  if (sessions.size >= remoteLimits.connections) {
    throw new RemoteRequestError('VIEWER_REMOTE_LIMIT', 'Server connection limit reached.');
  }
  sessions.set(configuration.connection.id, {
    configuration,
    channels: new Map(),
    opened: new Set(),
    stopped: false,
  });
}

async function request(
  requestID: string,
  [id, lane, primitive, thumbnail]: RemoteMethods['request']['args'],
): Promise<RemotePrimitiveReply> {
  if (!remoteLanes.includes(lane)) {
    throw new RemoteRequestError('VIEWER_REMOTE_INVALID_REQUEST', 'Unknown server request lane.');
  }
  const session = sessions.get(id);
  if (!session) {
    throw new RemoteRequestError('VIEWER_REMOTE_DISCONNECTED', 'Connect to this server first.');
  }
  const controller = new AbortController();
  requests.set(requestID, { connectionID: id, controller });
  const key = id + ':' + lane;
  let scheduler = schedulers.get(key);
  if (!scheduler) {
    scheduler = new LaneScheduler();
    schedulers.set(key, scheduler);
  }
  try {
    return await scheduler.run(controller.signal, !!thumbnail, () =>
      perform(session, lane, primitive, controller.signal),
    );
  } finally {
    requests.delete(requestID);
  }
}

/** SFTP codes and the server's bounded, sanitized message pass through; nothing else does. */
function failure(error: unknown): { error: string; code: string } {
  if (
    error instanceof SFTPError ||
    error instanceof SSHConnectionError ||
    error instanceof RemoteRequestError
  ) {
    return { error: error.message, code: error.code };
  }
  if (error instanceof ZodError) {
    return {
      error: 'Use a normalized absolute server path.',
      code: 'VIEWER_REMOTE_INVALID_LOCATION',
    };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { error: 'The server request was cancelled.', code: 'ABORT_ERR' };
  }
  return {
    error: 'The server request failed. Reconnect and try again.',
    code: 'VIEWER_REMOTE_REQUEST_FAILED',
  };
}

function requireEnabled(): void {
  if (!remoteFeatureEnabled(process.env)) {
    throw new RemoteRequestError(
      'VIEWER_REMOTE_DISABLED',
      'Server connections are not available in this build.',
    );
  }
}

workerPort?.on('message', (event) => {
  const message = event.data as WorkerRequest<RemoteMethods & ClientMethods>;
  void (async (): Promise<unknown> => {
    switch (message.method) {
      case 'cancel':
        requests.get(message.args[0])?.controller.abort();
        return;
      case 'close':
        for (const id of [...sessions.keys()]) {
          disconnect(id);
        }
        return;
      case 'release': {
        const session = sessions.get(message.args[0]);
        if (session) {
          closeChannels(session);
        }
        return;
      }
      case 'disconnect':
        disconnect(message.args[0]);
        return;
      case 'configure':
        requireEnabled();
        configure(message.args[0]);
        return;
      case 'request':
        requireEnabled();
        return request(message.id, message.args);
    }
  })().then(
    (value) => workerPort?.postMessage({ id: message.id, value }),
    (error: unknown) => workerPort?.postMessage({ id: message.id, ...failure(error) }),
  );
});
