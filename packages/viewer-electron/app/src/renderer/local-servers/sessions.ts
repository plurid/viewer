import type { ServerPane, ViewerAPI } from '../../domain/contracts';
import type {
  LocalServer,
  LocalServerAction,
  LocalServerDetail,
  LocalServerLog,
} from '../../domain/previews/web';
import { errorMessage } from '../../domain/errors';

type ServerAPI = Pick<
  ViewerAPI,
  'localServerStart' | 'localServers' | 'localServerInspect' | 'localServerAction'
>;

export interface LocalServerSnapshot {
  server?: LocalServer;
  logs: readonly LocalServerLog[];
  pending: 'start' | LocalServerAction | null;
  refreshing: boolean;
  error: string | null;
}

interface Session {
  pane: ServerPane;
  snapshot: LocalServerSnapshot;
  revision: number;
  operation?: Promise<unknown>;
  starting?: Promise<LocalServer | undefined>;
  inspecting?: { revision: number; work: Promise<void> };
}

const stopped: LocalServerSnapshot = {
  logs: [],
  pending: null,
  refreshing: false,
  error: null,
};

const sameServer = (left: LocalServer | undefined, right: LocalServer) =>
  left?.id === right.id &&
  left.root === right.root &&
  left.url === right.url &&
  left.port === right.port &&
  left.started === right.started &&
  left.state === right.state;

/** Native sessions belong to saved panes, independently of React mounting or engine culling. */
export class LocalServerSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly starting = new Map<string, { session: Session; work: Promise<unknown> }>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly closed = new Set<string>();
  private revision = 0;
  private loading?: Promise<void>;

  constructor(
    private readonly api: ServerAPI,
    private readonly report: (error: unknown) => void,
  ) {}

  snapshot(paneID: string): LocalServerSnapshot {
    return this.sessions.get(paneID)?.snapshot ?? stopped;
  }

  subscribe(paneID: string, listener: () => void): () => void {
    const listeners = this.listeners.get(paneID) ?? new Set();
    this.listeners.set(paneID, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(paneID);
    };
  }

  retain(panes: readonly ServerPane[]): void {
    const wanted = new Map(panes.map((pane) => [pane.id, pane]));
    for (const [id, session] of this.sessions) {
      const pane = wanted.get(id);
      if (
        pane &&
        pane.path === session.pane.path &&
        pane.sourceIdentity === session.pane.sourceIdentity
      )
        continue;
      this.sessions.delete(id);
      this.revision++;
      if (session.snapshot.server) void this.close(session.snapshot.server.id).catch(this.report);
      this.notify(id);
    }
    for (const pane of panes)
      if (!this.sessions.has(pane.id)) {
        this.sessions.set(pane.id, { pane, snapshot: stopped, revision: 0 });
        this.notify(pane.id);
      }
  }

  /** Events are lifecycle metadata only; request logs are read separately and remain bounded. */
  receive(servers: readonly LocalServer[]): void {
    this.revision++;
    const present = new Set<string>();
    for (const server of servers) {
      const session = this.sessions.get(server.paneID);
      const earlier = this.starting.get(server.paneID);
      if (!session || this.closed.has(server.id) || (earlier && earlier.session !== session)) {
        void this.close(server.id).catch(this.report);
        continue;
      }
      present.add(server.id);
      if (sameServer(session.snapshot.server, server)) continue;
      session.revision++;
      this.publish(session, {
        server,
        logs: session.snapshot.server?.id === server.id ? session.snapshot.logs : [],
      });
    }
    for (const session of this.sessions.values())
      if (session.snapshot.server && !present.has(session.snapshot.server.id)) {
        session.revision++;
        this.publish(session, { server: undefined, logs: [] });
      }
  }

  load(): Promise<void> {
    if (this.loading) return this.loading;
    const revision = this.revision;
    const work = this.api.localServers().then((servers) => {
      if (revision === this.revision) this.receive(servers);
    });
    this.loading = work;
    void work.then(
      () => {
        if (this.loading === work) this.loading = undefined;
      },
      (error) => {
        if (this.loading === work) this.loading = undefined;
        for (const session of this.sessions.values())
          this.publish(session, { error: errorMessage(error) });
      },
    );
    return work;
  }

  start(paneID: string): Promise<LocalServer | undefined> {
    const session = this.require(paneID);
    if (session.starting) return session.starting;
    if (session.snapshot.server?.state === 'running')
      return Promise.resolve(session.snapshot.server);
    const earlier = this.starting.get(paneID)?.work;
    const work: Promise<LocalServer | undefined> = this.run(session, 'start', async () => {
      // An arrangement Undo may restore the same pane while its old start is still
      // resolving. Dispose that generation before allowing another native start.
      await earlier?.catch(() => {});
      if (!this.current(session)) return;
      this.starting.set(paneID, { session, work });
      const previous = session.snapshot.server;
      if (previous) {
        await this.api.localServerAction(previous.id, 'restart');
        await this.inspect(session);
        return session.snapshot.server;
      }
      this.revision++;
      const eventRevision = session.revision;
      const server = await this.api.localServerStart(
        session.pane.path,
        session.pane.id,
        session.pane.sourceIdentity,
      );
      if (!this.current(session)) {
        await this.close(server.id);
        return;
      }
      if (session.revision === eventRevision || !session.snapshot.server)
        this.publish(session, { server, logs: [] });
      return session.snapshot.server;
    });
    session.starting = work;
    const finished = () => {
      if (session.starting === work) session.starting = undefined;
      if (this.starting.get(paneID)?.work === work) this.starting.delete(paneID);
    };
    void work.then(finished, finished);
    return work;
  }

  action(paneID: string, action: Exclude<LocalServerAction, 'close'>): Promise<void | undefined> {
    const session = this.require(paneID);
    return this.run(session, action, async () => {
      const server = session.snapshot.server;
      if (!server) throw new Error('Start this server before using its controls.');
      await this.api.localServerAction(server.id, action);
      if (['stop', 'restart', 'clear-log'].includes(action)) await this.inspect(session);
    });
  }

  async refresh(paneID: string): Promise<void> {
    const session = this.require(paneID);
    if (!session.snapshot.server) await this.load();
    if (this.current(session)) await this.inspect(session);
  }

  private async inspect(session: Session): Promise<void> {
    const pending = session.inspecting;
    if (pending) {
      if (pending.revision === session.revision) return pending.work;
      await pending.work.catch(() => {});
      if (this.current(session)) await this.inspect(session);
      return;
    }
    const server = session.snapshot.server;
    if (!server || !this.current(session)) return;
    const revision = session.revision;
    this.publish(session, { refreshing: true });
    const work = this.api
      .localServerInspect(server.id)
      .then((detail: LocalServerDetail) => {
        if (!this.current(session) || session.revision !== revision) return;
        if (detail.server.id !== server.id || detail.server.paneID !== session.pane.id)
          throw new Error('The server reply no longer belongs to this plane. Refresh again.');
        const logs = detail.logs.slice(-200);
        const unchanged =
          logs.length === session.snapshot.logs.length &&
          logs.every((log, index) => log.sequence === session.snapshot.logs[index]?.sequence);
        this.publish(session, {
          server: sameServer(session.snapshot.server, detail.server)
            ? session.snapshot.server
            : detail.server,
          logs: unchanged ? session.snapshot.logs : logs,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!this.current(session) || session.revision !== revision) return;
        this.publish(session, { error: errorMessage(error) });
        throw error;
      })
      .finally(() => {
        if (session.inspecting?.work === work) session.inspecting = undefined;
        this.publish(session, { refreshing: false });
      });
    session.inspecting = { revision, work };
    return work;
  }

  private run<T>(
    session: Session,
    action: 'start' | LocalServerAction,
    run: () => Promise<T>,
  ): Promise<T | undefined> {
    const work = (session.operation ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.current(session)) return;
        this.revision++;
        session.revision++;
        this.publish(session, { pending: action, error: null });
        try {
          return await run();
        } catch (error) {
          if (!this.current(session)) return;
          this.publish(session, { error: errorMessage(error) });
          throw error;
        } finally {
          this.publish(session, { pending: null });
        }
      });
    session.operation = work;
    const finished = () => {
      if (session.operation === work) session.operation = undefined;
    };
    void work.then(finished, finished);
    return work;
  }

  private close(id: string): Promise<void> {
    if (this.closed.has(id)) return this.closing.get(id) ?? Promise.resolve();
    this.closed.add(id);
    while (this.closed.size > 256) this.closed.delete(this.closed.values().next().value!);
    const work = this.api.localServerAction(id, 'close').catch((error: unknown) => {
      this.closed.delete(id);
      throw error;
    });
    this.closing.set(id, work);
    const finished = () => {
      if (this.closing.get(id) === work) this.closing.delete(id);
    };
    void work.then(finished, finished);
    return work;
  }

  private current(session: Session): boolean {
    return this.sessions.get(session.pane.id) === session;
  }

  private require(paneID: string): Session {
    const session = this.sessions.get(paneID);
    if (!session) throw new Error('This server plane has closed.');
    return session;
  }

  private publish(session: Session, patch: Partial<LocalServerSnapshot>): void {
    if (!this.current(session)) return;
    const next = { ...session.snapshot, ...patch };
    if (
      (Object.keys(next) as (keyof LocalServerSnapshot)[]).every(
        (key) => next[key] === session.snapshot[key],
      )
    )
      return;
    session.snapshot = next;
    this.notify(session.pane.id);
  }

  private notify(paneID: string): void {
    for (const listener of this.listeners.get(paneID) ?? []) listener();
  }
}
