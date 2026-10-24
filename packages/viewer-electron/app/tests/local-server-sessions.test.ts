import { describe, expect, it, vi } from 'vitest';
import type { ServerPane, ViewerAPI } from '../src/domain/contracts';
import type { LocalServer, LocalServerDetail, LocalServerLog } from '../src/domain/previews/web';
import { LocalServerSessions } from '../src/renderer/local-servers/sessions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const pane: ServerPane = {
  id: 'server-pane',
  type: 'server',
  path: '/fixture/site',
  sourceIdentity: '1:2',
};
const server = (id = 'native-server'): LocalServer => ({
  id,
  paneID: pane.id,
  root: pane.path,
  url: 'http://127.0.0.1:43110/',
  port: 43110,
  started: 1000,
  state: 'running',
});
const log = (sequence: number): LocalServerLog => ({
  sequence,
  timestamp: 1000 + sequence,
  method: 'GET',
  path: `/file-${sequence}.html`,
  status: 200,
  durationMs: 1,
  bytes: 20,
});

function fixture() {
  let current = server();
  let logs: LocalServerLog[] = [];
  const api = {
    localServerStart: vi.fn<ViewerAPI['localServerStart']>(async () => current),
    localServers: vi.fn<ViewerAPI['localServers']>(async () => []),
    localServerInspect: vi.fn<ViewerAPI['localServerInspect']>(async () => ({
      server: current,
      logs,
    })),
    localServerAction: vi.fn<ViewerAPI['localServerAction']>(async (_id, action) => {
      if (action === 'stop') current = { ...current, state: 'stopped' };
      if (action === 'restart')
        current = { ...current, state: 'running', started: current.started + 1 };
      if (action === 'clear-log') logs = [];
    }),
  };
  const report = vi.fn();
  const sessions = new LocalServerSessions(api, report);
  sessions.retain([pane]);
  return {
    api,
    sessions,
    report,
    setLogs: (next: LocalServerLog[]) => {
      logs = next;
    },
  };
}

describe('local server pane runtime ownership', () => {
  it('reopens a saved pane stopped and starts only through an explicit request', async () => {
    const { api, sessions } = fixture();
    await sessions.load();
    expect(sessions.snapshot(pane.id).server).toBeUndefined();
    expect(api.localServerStart).not.toHaveBeenCalled();
    await Promise.all([sessions.start(pane.id), sessions.start(pane.id)]);
    expect(api.localServerStart).toHaveBeenCalledExactlyOnceWith(pane.path, pane.id, '1:2');
    expect(sessions.snapshot(pane.id).server?.state).toBe('running');
    expect(Object.keys(pane)).toEqual(['id', 'type', 'path', 'sourceIdentity']);
  });

  it('survives view unsubscription and retains at most 200 log entries', async () => {
    const { api, sessions, setLogs } = fixture();
    const listener = vi.fn();
    const unsubscribe = sessions.subscribe(pane.id, listener);
    await sessions.start(pane.id);
    unsubscribe();
    listener.mockClear();
    setLogs(Array.from({ length: 250 }, (_, index) => log(index + 1)));
    await sessions.refresh(pane.id);
    expect(listener).not.toHaveBeenCalled();
    expect(api.localServerAction).not.toHaveBeenCalledWith(expect.anything(), 'close');
    expect(sessions.snapshot(pane.id).logs).toHaveLength(200);
    expect(sessions.snapshot(pane.id).logs[0]?.sequence).toBe(51);
  });

  it('disposes late native completion before an undone pane can explicitly start again', async () => {
    const { api, sessions } = fixture();
    const first = deferred<LocalServer>();
    api.localServerStart.mockReturnValueOnce(first.promise).mockResolvedValueOnce(server('second'));
    const oldStart = sessions.start(pane.id);
    await vi.waitFor(() => expect(api.localServerStart).toHaveBeenCalledTimes(1));
    sessions.receive([server('first')]);
    sessions.retain([]);
    sessions.retain([pane]);
    const nextStart = sessions.start(pane.id);
    sessions.receive([server('first')]);
    expect(sessions.snapshot(pane.id).server).toBeUndefined();
    expect(api.localServerStart).toHaveBeenCalledTimes(1);
    first.resolve(server('first'));
    await Promise.all([oldStart, nextStart]);
    expect(api.localServerAction).toHaveBeenCalledWith('first', 'close');
    expect(api.localServerStart).toHaveBeenCalledTimes(2);
    expect(sessions.snapshot(pane.id).server?.id).toBe('second');
    expect(api.localServerAction.mock.invocationCallOrder[0]).toBeLessThan(
      api.localServerStart.mock.invocationCallOrder[1]!,
    );
  });

  it('cannot replace a freshly started session with an older empty list response', async () => {
    const { api, sessions } = fixture();
    const loading = deferred<LocalServer[]>();
    api.localServers.mockReturnValueOnce(loading.promise);
    const read = sessions.load();
    await sessions.start(pane.id);
    loading.resolve([]);
    await read;
    expect(sessions.snapshot(pane.id).server?.id).toBe('native-server');
  });

  it('ignores old inspect replies after a pane closes and is restored', async () => {
    const { api, sessions } = fixture();
    await sessions.start(pane.id);
    const oldDetail = deferred<LocalServerDetail>();
    api.localServerInspect.mockReturnValueOnce(oldDetail.promise);
    const refreshing = sessions.refresh(pane.id);
    sessions.retain([]);
    sessions.retain([pane]);
    api.localServerStart.mockResolvedValueOnce(server('restored'));
    await sessions.start(pane.id);
    oldDetail.resolve({ server: server(), logs: [log(1)] });
    await refreshing;
    expect(sessions.snapshot(pane.id).server?.id).toBe('restored');
    expect(sessions.snapshot(pane.id).logs).toEqual([]);
  });

  it('waits out a stale inspect and refreshes the authoritative result after Stop', async () => {
    const { api, sessions } = fixture();
    await sessions.start(pane.id);
    const oldDetail = deferred<LocalServerDetail>();
    api.localServerInspect.mockReturnValueOnce(oldDetail.promise);
    const oldRefresh = sessions.refresh(pane.id);
    const stopping = sessions.action(pane.id, 'stop');
    await vi.waitFor(() =>
      expect(api.localServerAction).toHaveBeenCalledWith('native-server', 'stop'),
    );
    oldDetail.resolve({ server: server(), logs: [log(1)] });
    await Promise.all([oldRefresh, stopping]);
    expect(api.localServerInspect).toHaveBeenCalledTimes(2);
    expect(sessions.snapshot(pane.id).server?.state).toBe('stopped');
    expect(sessions.snapshot(pane.id).logs).toEqual([]);
  });

  it('keeps failed starts retryable and uses native Restart for a stopped record', async () => {
    const { api, sessions } = fixture();
    api.localServerStart.mockRejectedValueOnce(new Error('Folder changed'));
    await expect(sessions.start(pane.id)).rejects.toThrow('Folder changed');
    expect(sessions.snapshot(pane.id)).toMatchObject({ pending: null, error: 'Folder changed' });
    await sessions.start(pane.id);
    await sessions.action(pane.id, 'stop');
    await sessions.start(pane.id);
    expect(api.localServerStart).toHaveBeenCalledTimes(2);
    expect(api.localServerAction).toHaveBeenCalledWith('native-server', 'restart');
    expect(sessions.snapshot(pane.id)).toMatchObject({
      pending: null,
      error: null,
      server: { state: 'running' },
    });
  });
});
