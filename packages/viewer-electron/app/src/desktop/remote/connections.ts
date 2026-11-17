import path from 'node:path';
import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { remoteConnection } from '../../domain/remote/connections';
import type { RemoteConnection } from '../../domain/remote/connections';
import { parseRemoteAddress } from '../../domain/remote/address';
import type {
  RemoteConnectionSnapshot,
  RemoteReply,
  RemoteRequest,
} from '../../domain/remote/contracts';
import { remoteRequest } from '../../domain/remote/contracts';
import { remoteFeatureEnabled } from '../../domain/remote/feature';
import { connectionID, remoteScheme } from '../../domain/remote/location';
import { remoteLimits } from '../../domain/remote/limits';
import type { RemoteConnectionState } from '../../domain/remote/status';
import { SSHConnectionError } from '../../domain/remote/ssh-errors';
import type { SSHHostKey } from '../../domain/remote/ssh-errors';
import { DocumentStore } from '../persistence/document-store';
import type { WorkerBackend } from '../workers/utility-client';
import { AskpassRelay } from './askpass';
import type { AskpassAttempt, PromptAnswer } from './askpass';
import { RemoteControl } from './control';
import type { SSHRunner } from './control';
import { remoteEnvironment } from './environment';
import { RemoteSessions } from './session';
import type {
  RemoteSessionPort,
  RemotePrimitive,
  RemotePrimitiveReply,
  RemoteLane,
} from './session';
import { readSSHConfigHosts } from './ssh-config';

const document = z
  .object({
    version: z.literal(1),
    connections: z.array(remoteConnection).max(remoteLimits.savedConnections),
  })
  .strict()
  .refine(
    (value) => new Set(value.connections.map((item) => item.id)).size === value.connections.length,
  );

type ConnectionDocument = z.infer<typeof document>;

/** States in which the master runs and requests may be sent. */
const usable: readonly RemoteConnectionState[] = ['ready', 'slow'];
/** States that count toward the eight connections at once. */
const active: readonly RemoteConnectionState[] = ['ready', 'slow', 'connecting', 'reconnecting'];

interface LiveConnection {
  state: RemoteConnectionState;
  since: number;
  attempt: number;
  home?: string;
  hostKey?: SSHHostKey;
  controller?: AbortController;
  retry?: ReturnType<typeof setTimeout>;
  health?: ReturnType<typeof setTimeout>;
  cleanup?: Promise<void>;
  running?: Promise<void>;
  stopping?: Promise<void>;
  slowRequests?: Set<symbol>;
  /** Idle: its channels closed, its master left to ControlPersist. */
  released?: boolean;
  waking?: Promise<void>;
  checking?: Promise<void>;
}

export interface RemoteCaller {
  owner: number;
  role: 'viewer' | 'settings' | 'agent';
  agentDriven: boolean;
}

export interface RemoteConnectionsOptions {
  dataPath: string;
  worker: string;
  helper: string;
  prompt: PromptAnswer;
  event(connections: RemoteConnectionSnapshot[]): void;
  quiesce?(id: string): Promise<void>;
  backend?: WorkerBackend;
  sshExecutable?: string;
  runner?: SSHRunner;
  sessions?: RemoteSessionPort;
  temporaryDirectory?: string;
  sshDirectory?: string;
}

const disconnectedError = () =>
  Object.assign(new Error('Connect to this server first.'), {
    code: 'VIEWER_REMOTE_DISCONNECTED',
  });

/** Fields ssh connects with. A new name, starting folder or preference keeps the connection. */
function sameEndpoint(left: RemoteConnection, right: RemoteConnection): boolean {
  return (
    left.host === right.host &&
    left.user === right.user &&
    left.port === right.port &&
    left.identityFile === right.identityFile &&
    (left.jump ?? []).join(',') === (right.jump ?? []).join(',')
  );
}

/** Main owns connection authority. Construction neither reads SSH configuration nor connects. */
export class RemoteConnections {
  private store: DocumentStore<ConnectionDocument>;
  private records = new Map<string, RemoteConnection>();
  private live = new Map<string, LiveConnection>();
  private generations = new Map<string, number>();
  private loading?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private blockedStore = false;
  private closed = false;
  private quiescers = new Set<(id: string) => Promise<void>>();
  private relay: AskpassRelay;
  private control: RemoteControl;
  readonly sessions: RemoteSessionPort;

  constructor(private options: RemoteConnectionsOptions) {
    this.store = new DocumentStore(
      path.join(options.dataPath, 'remote-connections-v1.json'),
      (value) => document.parse(value),
      remoteLimits.sshConfigBytes,
    );
    this.relay = new AskpassRelay(options.helper, options.prompt, options.temporaryDirectory);
    this.control = new RemoteControl({
      runner: options.runner,
      sshExecutable: options.sshExecutable,
      temporaryDirectory: options.temporaryDirectory,
      idle: (id) => this.idle(id),
    });
    this.sessions =
      options.sessions ??
      new RemoteSessions(options.worker, {
        backend: options.backend,
        lost: (id) => this.channelLost(id),
      });
    if (options.quiesce) {
      this.quiescers.add(options.quiesce);
    }
  }

  private requireEnabled(): void {
    if (!remoteFeatureEnabled(process.env) || process.mas || this.closed) {
      throw Object.assign(new Error('Server connections are not available in this build.'), {
        code: 'VIEWER_REMOTE_DISABLED',
      });
    }
  }

  private fresh(): LiveConnection {
    return { state: 'saved', since: Date.now(), attempt: 0 };
  }

  private async load(): Promise<void> {
    this.requireEnabled();
    this.loading ??= (async () => {
      let saved: ConnectionDocument | null;
      try {
        saved = await this.store.load();
      } catch {
        // Kept beside the store, so a later save never overwrites what could not be read.
        try {
          await rename(this.store.file, this.store.file + '.unreadable-' + randomUUID());
        } catch {
          this.blockedStore = true;
        }
        saved = null;
      }
      for (const record of saved?.connections ?? []) {
        this.records.set(record.id, record);
        this.live.set(record.id, this.fresh());
      }
    })();
    return this.loading;
  }

  snapshot(): RemoteConnectionSnapshot[] {
    return [...this.records.values()].map((connection) => {
      const live = this.live.get(connection.id) ?? this.fresh();
      return {
        connection: structuredClone(connection),
        state: live.state,
        attempt: live.attempt,
        since: live.since,
        ...(live.home === undefined ? {} : { home: live.home }),
        ...(live.hostKey === undefined ? {} : { hostKey: { ...live.hostKey } }),
      };
    });
  }

  private emit(): void {
    this.options.event(this.snapshot());
  }

  private state(id: string, state: RemoteConnectionState): void {
    const live = this.live.get(id);
    if (!live) {
      return;
    }
    if (live.state !== state) {
      live.since = Date.now();
    }
    live.state = state;
    this.emit();
  }

  private record(id: string): RemoteConnection {
    const record = this.records.get(connectionID.parse(id));
    if (!record) {
      throw new Error('Choose a saved server connection.');
    }
    return record;
  }

  private mutate(work: () => Promise<void>): Promise<void> {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (this.blockedStore) {
          throw new Error(
            'The unreadable server record could not be preserved. Check its file permissions before saving.',
          );
        }
        await work();
      });
    this.writes = task;
    return task;
  }

  private async save(record: RemoteConnection): Promise<void> {
    const valid = remoteConnection.parse(record);
    await this.mutate(async () => {
      const previous = this.records.get(valid.id);
      const reconnect = !!previous && !sameEndpoint(previous, valid);
      if (reconnect) {
        await this.disconnect(valid.id);
      }
      const records = new Map(this.records);
      records.set(valid.id, valid);
      await this.store.save({ version: 1, connections: [...records.values()] });
      this.records = records;
      if (!previous || reconnect) {
        this.live.set(valid.id, this.fresh());
      }
      this.emit();
    });
  }

  private async remove(id: string): Promise<void> {
    await this.mutate(async () => {
      this.record(id);
      await this.disconnect(id);
      const records = new Map(this.records);
      records.delete(id);
      await this.store.save({ version: 1, connections: [...records.values()] });
      this.records = records;
      this.live.delete(id);
      this.emit();
    });
  }

  async request(input: RemoteRequest, caller: RemoteCaller): Promise<RemoteReply> {
    this.requireEnabled();
    if (caller.role === 'agent' || caller.agentDriven) {
      throw Object.assign(
        new Error('Server connections are available only to the person using Viewer.'),
        { code: 'VIEWER_REMOTE_AGENT_REFUSED' },
      );
    }
    const request = remoteRequest.parse(input);
    if ((request.type === 'save' || request.type === 'remove') && caller.role !== 'settings') {
      throw new Error('Edit saved servers in Settings.');
    }
    await this.load();
    switch (request.type) {
      case 'list':
        break;
      case 'save':
        await this.save(request.connection);
        break;
      case 'remove':
        await this.remove(request.id);
        break;
      case 'connect':
        await this.connect(request.id, caller.owner);
        break;
      case 'disconnect':
        await this.disconnect(request.id);
        break;
      case 'resolve-address':
        return {
          connections: this.snapshot(),
          address: parseRemoteAddress(
            request.address,
            [...this.records.values()].map((item) => item.name),
          ),
        };
      case 'ssh-config-hosts': {
        const record = this.record(request.id);
        const consent = request.consent ? 'allowed' : 'declined';
        if (record.sshConfig !== consent) {
          await this.save({ ...record, sshConfig: consent });
        }
        return {
          connections: this.snapshot(),
          hosts: request.consent ? await readSSHConfigHosts(this.options.sshDirectory) : [],
        };
      }
    }
    return { connections: this.snapshot() };
  }

  /** A click: the only way a connection may ask the person anything. */
  async connect(id: string, owner: number): Promise<void> {
    const generation = this.generations.get(id) ?? 0;
    await this.load();
    await this.writes.catch(() => {});
    const record = this.record(id);
    const live = this.live.get(id)!;
    await live.cleanup;
    await live.stopping;
    if (generation !== (this.generations.get(id) ?? 0)) {
      return;
    }
    if (live.controller && live.state === 'reconnecting') {
      // A click replaces an automatic attempt, which could not ask for anything.
      live.controller.abort();
      await live.running?.catch(() => {});
    }
    if (live.controller) {
      throw new Error('This server is already connecting.');
    }
    if (usable.includes(live.state)) {
      return;
    }
    const busy = [...this.live.values()].filter((item) => active.includes(item.state)).length;
    if (busy >= remoteLimits.connections) {
      throw new Error('Disconnect a server before connecting another.');
    }
    clearTimeout(live.retry);
    live.attempt = 0;
    await this.start(record, live, owner);
  }

  private start(record: RemoteConnection, live: LiveConnection, owner?: number): Promise<void> {
    const running = this.establish(record, live, owner);
    live.running = running;
    void running
      .finally(() => {
        if (live.running === running) {
          live.running = undefined;
        }
      })
      .catch(() => {});
    return running;
  }

  /** `owner` is the window that clicked; without one this is a reconnect in BatchMode. */
  private async establish(
    record: RemoteConnection,
    live: LiveConnection,
    owner?: number,
  ): Promise<void> {
    const controller = new AbortController();
    live.controller = controller;
    live.released = false;
    this.state(record.id, owner === undefined ? 'reconnecting' : 'connecting');
    let attempt: AskpassAttempt | undefined;
    try {
      if (owner !== undefined) {
        attempt = await this.relay.begin(record.id, record.name, owner);
        attempt.signal.addEventListener('abort', () => controller.abort(), { once: true });
        if (attempt.signal.aborted) {
          controller.abort();
        }
      }
      const controlPath = await this.control.connect(
        record,
        remoteEnvironment(attempt?.environment),
        owner !== undefined,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      await this.sessions.configure({
        connection: record,
        controlPath,
        sshExecutable: this.options.sshExecutable,
      });
      const home = await this.sessions.request(
        record.id,
        'browse',
        { type: 'home' },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (home.type !== 'path') {
        throw new Error('The server did not return its home folder.');
      }
      live.home = home.path;
      live.hostKey = undefined;
      live.attempt = 0;
      this.state(record.id, 'ready');
      this.control.armIdle(record.id);
      this.health(record.id, live);
    } catch (error) {
      await this.sessions.disconnect(record.id).catch(() => {});
      await this.control.disconnect(record.id);
      if (controller.signal.aborted || this.closed) {
        if (live.controller === controller && !this.closed) {
          this.state(record.id, 'disconnected');
        }
      } else {
        const state = error instanceof SSHConnectionError ? error.state : 'unreachable';
        live.hostKey = error instanceof SSHConnectionError ? error.hostKey : undefined;
        this.state(record.id, state);
        // Sign-in and a changed identity need the person; only an unreachable server is retried.
        if (owner === undefined && state === 'unreachable') {
          this.retry(record.id, live);
        }
      }
    } finally {
      attempt?.cancel();
      if (live.controller === controller) {
        live.controller = undefined;
      }
    }
  }

  private health(id: string, live: LiveConnection): void {
    clearTimeout(live.health);
    live.health = setTimeout(() => {
      const lost = () => {
        if (live.released) {
          void this.expire(id, live);
        } else {
          this.offline(id);
        }
      };
      void this.control.check(id).then((alive) => {
        if (!usable.includes(live.state) || this.closed) {
          return;
        }
        if (alive) {
          this.health(id, live);
        } else {
          lost();
        }
      }, lost);
    }, remoteLimits.sshServerAliveIntervalSeconds * 1000).unref();
  }

  /** Nothing has held the connection for five minutes: close its channels, keep its master. */
  private async idle(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live || live.released || live.controller || !usable.includes(live.state)) {
      return;
    }
    live.released = true;
    await this.sessions.release(id);
  }

  /** The master of an idle connection ended after ControlPersist: not connected, no retries. */
  private async expire(id: string, live: LiveConnection): Promise<void> {
    if (!live.released || !usable.includes(live.state)) {
      return;
    }
    clearTimeout(live.health);
    live.released = false;
    live.home = undefined;
    this.control.forget(id);
    this.state(id, 'saved');
    await this.quiesceConnection(id).catch(() => {});
  }

  /** An idle connection's channels reopen through its master, never by a new sign-in. */
  private async wake(id: string, live: LiveConnection): Promise<void> {
    live.waking ??= (async () => {
      const alive = await this.control.check(id).catch(() => false);
      if (!alive) {
        await this.expire(id, live);
        throw disconnectedError();
      }
      live.released = false;
      this.control.armIdle(id);
    })().finally(() => {
      live.waking = undefined;
    });
    return live.waking;
  }

  /**
   * A channel ended without being closed, or the worker did. A master that still answers keeps
   * the connection: the next request on that lane opens a channel through it, with no new sign-in.
   */
  private channelLost(id: string): void {
    const live = this.live.get(id);
    if (!live || !usable.includes(live.state) || this.closed || live.checking) {
      return;
    }
    live.checking = (async () => {
      const alive = await this.control.check(id).catch(() => false);
      if (!alive && usable.includes(live.state) && !this.closed) {
        this.offline(id);
      }
    })().finally(() => {
      live.checking = undefined;
    });
  }

  /** The master is gone: stop the connection's work, then reconnect in BatchMode. */
  offline(id: string): void {
    const live = this.live.get(id);
    if (!live || !usable.includes(live.state) || this.closed) {
      return;
    }
    clearTimeout(live.health);
    live.released = false;
    this.state(id, 'offline');
    const cleanup = this.quiesceConnection(id).then(() => this.control.disconnect(id));
    live.cleanup = cleanup;
    void cleanup
      .then(
        () => {
          if (live.state === 'offline' && !this.closed) {
            this.retry(id, live);
          }
        },
        () => {
          if (live.state === 'offline' && !this.closed) {
            this.state(id, 'unreachable');
          }
        },
      )
      .finally(() => {
        if (live.cleanup === cleanup) {
          live.cleanup = undefined;
        }
      });
  }

  private retry(id: string, live: LiveConnection): void {
    if (live.attempt >= remoteLimits.reconnectAttempts || this.closed) {
      return;
    }
    clearTimeout(live.retry);
    const delays = remoteLimits.reconnectDelayMs;
    const delay = delays[Math.min(live.attempt, delays.length - 1)]!;
    live.retry = setTimeout(() => {
      if (this.closed || live.controller || live.state === 'disconnected') {
        return;
      }
      live.attempt++;
      void this.start(this.record(id), live);
    }, delay).unref();
  }

  /** Later packages stop their own work for a connection here: watches, search, terminals. */
  addQuiescer(quiesce: (id: string) => Promise<void>): () => void {
    this.quiescers.add(quiesce);
    return () => this.quiescers.delete(quiesce);
  }

  /** Remote work stops without touching local roots, revocation or file coordination. */
  async quiesceConnection(id: string): Promise<void> {
    connectionID.parse(id);
    await Promise.all([...this.quiescers].map((quiesce) => quiesce(id)));
    await this.sessions.disconnect(id);
  }

  /** By the person: cancels a prompt or attempt, stops the connection's work, then the master. */
  async disconnect(id: string): Promise<void> {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const live = this.live.get(id);
    if (!live) {
      return;
    }
    if (live.stopping) {
      return live.stopping;
    }
    clearTimeout(live.retry);
    clearTimeout(live.health);
    live.controller?.abort();
    live.released = false;
    this.relay.cancel(id);
    this.control.cancel(id);
    this.state(id, 'disconnected');
    const stopping = (async () => {
      try {
        await live.cleanup;
        await this.quiesceConnection(id);
        await live.running;
      } finally {
        await this.control.disconnect(id);
      }
    })();
    live.stopping = stopping;
    try {
      await stopping;
    } finally {
      if (live.stopping === stopping) {
        live.stopping = undefined;
      }
    }
  }

  ownerClosed(owner: number): void {
    this.relay.cancelOwner(owner);
  }

  /** Held by a plane, terminal or request; the connection idles five minutes after the last. */
  retain(id: string): () => void {
    this.requireEnabled();
    this.record(id);
    return this.control.retain(id);
  }

  /** The control socket of a ready connection, for sessions that reuse its master. */
  controlPath(id: string): string | undefined {
    const live = this.live.get(id);
    return live && usable.includes(live.state) ? this.control.controlPath(id) : undefined;
  }

  async perform(
    id: string,
    lane: RemoteLane,
    request: RemotePrimitive,
    signal?: AbortSignal,
    thumbnail = false,
  ): Promise<RemotePrimitiveReply> {
    this.requireEnabled();
    const live = this.live.get(id);
    if (!live || !usable.includes(live.state)) {
      throw disconnectedError();
    }
    const release = this.retain(id);
    const token = Symbol();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (live.released) {
        await this.wake(id, live);
      }
      if (lane === 'browse' && !thumbnail) {
        timer = setTimeout(() => {
          if (usable.includes(live.state)) {
            (live.slowRequests ??= new Set()).add(token);
            this.state(id, 'slow');
          }
        }, remoteLimits.metadataSlowMs).unref();
      }
      return await this.sessions.request(id, lane, request, signal, thumbnail);
    } finally {
      clearTimeout(timer);
      release();
      live.slowRequests?.delete(token);
      if (live.state === 'slow' && !live.slowRequests?.size) {
        this.state(id, 'ready');
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [id, live] of this.live) {
      clearTimeout(live.retry);
      clearTimeout(live.health);
      live.controller?.abort();
      this.relay.cancel(id);
      this.control.cancel(id);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const quiesced = [...this.records.keys()].map((id) =>
      Promise.all([...this.quiescers].map((quiesce) => quiesce(id))),
    );
    // Quit waits at most two seconds; ControlPersist ends any master left behind.
    await Promise.race([
      Promise.allSettled([
        this.control.close(),
        this.sessions.close(),
        this.relay.close(),
        this.writes,
        ...quiesced,
      ]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remoteLimits.quitTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }
}

export const remoteConnectionRoot = (id: string): string => remoteScheme + connectionID.parse(id);
