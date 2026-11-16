import { Desktop } from '../src/desktop/bridge';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { BackgroundFolderHistory } from '../src/desktop/files/folder-history';
import type { SavedState } from '../src/domain/contracts';
import type { FolderVisitSave } from '../src/domain/files/folder-visit-changes';
import { afterEach, expect, it, vi } from 'vitest';
import type { CheckedFolder } from '../src/domain/files/folder-checks';
import { FolderHistoryChecks } from '../src/desktop/windows/folder-history-checks';
import { checkFolderCandidates } from '../src/domain/files/folder-checks';

const workers = vi.hoisted(
  () =>
    [] as {
      receive?: (reply: { value: CheckedFolder }) => void;
      request?: string;
      postMessage: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock('../src/desktop/workers/utility-client', () => ({
  launchWorker: vi.fn(() => {
    const worker: (typeof workers)[number] = {
      postMessage: vi.fn((path: string) => {
        worker.request = path;
        if (!path.startsWith('/Volumes/Sleeping/') && !path.endsWith('/slow'))
          queueMicrotask(() => worker.receive?.({ value: { directory: true, path } }));
      }),
    };
    workers.push(worker);
    return {
      postMessage: worker.postMessage,
      message: (listener: typeof worker.receive) => {
        worker.receive = listener;
      },
      exit: () => {},
      thread: { terminate: async () => {}, on: () => {} },
    };
  }),
}));
afterEach(() => {
  workers.length = 0;
  vi.useRealTimers();
});

it('shares the desktop pool across launch and windows, quarantines a slow volume, and leaves other disks usable', async () => {
  vi.useFakeTimers();
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const result = checkFolderCandidates(
    [
      ...Array.from({ length: 45 }, (_, i) => `/Volumes/Sleeping/${i}`),
      ...Array.from({ length: 455 }, (_, i) => `/fixtures/${i}`),
    ],
    checks.check,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(151);
  expect(await result).toHaveLength(8);
  expect(workers.length).toBeLessThanOrEqual(4);
  expect(workers.length).toBeGreaterThan(2);
  const sent = workers.flatMap((worker) => worker.postMessage.mock.calls.map(([path]) => path));
  expect(sent.filter((path) => path.startsWith('/Volumes/Sleeping/'))).toHaveLength(2);
  expect(await checks.check('/Volumes/Sleeping/another')).toMatchObject({ timedOut: true });
  expect(workers.flatMap((worker) => worker.postMessage.mock.calls)).toHaveLength(sent.length);
  expect(await checks.check('/fixtures/next')).toMatchObject({ directory: true });
  for (const worker of workers)
    if (worker.request?.startsWith('/Volumes/Sleeping/'))
      worker.receive?.({ value: { directory: true } });
  checks.close();
});

it('clears checked paths and ignores a late pre-clear check when a later window reads the cache', async () => {
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  await checks.check('/fixtures/known');
  const pending = checks.check('/Volumes/Sleeping/late');
  await Promise.resolve();
  await Promise.resolve();
  expect(checks.paths).toEqual(['/fixtures/known']);
  checks.clear();
  const worker = workers.find((item) => item.request === '/Volumes/Sleeping/late')!;
  worker.receive?.({ value: { directory: true, path: '/Volumes/Sleeping/late' } });
  await pending;
  expect(checks.paths).toEqual([]);
  checks.close();
});

it('skips a scope that is not already active without dispatching metadata', async () => {
  const scope = vi.fn(() => undefined);
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs', scope);
  expect(await checks.check('/fixtures/Saved')).toMatchObject({ unavailable: true });
  expect(workers).toHaveLength(0);
  checks.close();
});

it('shares two active desktop reads across independent window and launch requests', async () => {
  vi.useFakeTimers();
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const requests = Array.from({ length: 4 }, (_, i) => checks.check(`/Volumes/Sleeping/${i}`));
  await vi.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(301);
  await Promise.all(requests);
  expect(workers.length).toBeLessThanOrEqual(4);
  for (const worker of workers) worker.receive?.({ value: { directory: true } });
  checks.close();
});

it('does not quarantine the local filesystem when an unclassified folder read times out', async () => {
  vi.useFakeTimers();
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const slow = checks.check('/fixtures/slow');
  await vi.advanceTimersByTimeAsync(151);
  expect(await slow).toMatchObject({ timedOut: true });
  expect(await checks.check('/fixtures/Downloads')).toMatchObject({ directory: true });
  for (const worker of workers)
    if (worker.request === '/fixtures/slow') worker.receive?.({ value: { directory: true } });
  checks.close();
});

it('does not quarantine a healthy volume for time spent waiting for a lane', async () => {
  vi.useFakeTimers();
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const sleeping = [checks.check('/Volumes/Sleeping/a'), checks.check('/Volumes/Sleeping/b')];
  const healthy = checks.check('/Volumes/Healthy/Projects');
  await vi.advanceTimersByTimeAsync(151);
  expect(await healthy).toMatchObject({ directory: true });
  expect(await checks.check('/Volumes/Healthy/Projects')).toMatchObject({ directory: true });
  await Promise.all(sleeping);
  for (const worker of workers)
    worker.receive?.({ value: { directory: true, path: worker.request } });
  checks.close();
});

it('keeps normal lanes available after four reads never answer, within a six-read allowance', async () => {
  vi.useFakeTimers();
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const sleeping = Array.from({ length: 4 }, (_, i) => checks.check(`/Volumes/Sleeping/${i}`));
  await vi.advanceTimersByTimeAsync(301);
  await Promise.all(sleeping);
  expect(await checks.check('/fixtures/Downloads')).toMatchObject({ directory: true });
  expect(workers.length).toBeLessThanOrEqual(6);
  for (const worker of workers)
    worker.receive?.({ value: { directory: true, path: worker.request } });
  checks.close();
});

it('the actual save handler clears main cache entries for the cleared records only', async () => {
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  await checks.check('/fixtures/A');
  await checks.check('/fixtures/Unrelated');
  const sessions = new WorkspaceSessions();
  const state = sessions.open(1, '/fixtures');
  state.visits = { '/fixtures/A': { count: 1, last: 1 } };
  sessions.save(1, state, {
    id: 'seed',
    base: {},
    clear: false,
    revision: 0,
    clearRevision: 0,
    restored: {},
  });
  const desktop = Object.create(Desktop.prototype) as Desktop;
  Object.assign(desktop, {
    workspaceSessions: sessions,
    folderChecks: checks,
    folderHistoryPrepared: new BackgroundFolderHistory(),
    chats: { retain: () => {} },
    storage: { save: async () => {} },
    activity: {
      at: (_context: unknown, work: () => Promise<unknown>) => work(),
      run: (_kind: string, _name: string, work: () => Promise<unknown>) => work(),
    },
    withPreferences: (value: unknown) => value,
    emit: () => {},
    assignWorkspace: () => {},
    options: {},
  });
  const save = Reflect.get(desktop, 'saveWorkspaces') as (
    input: SavedState,
    owner: number,
    metadata: FolderVisitSave,
  ) => Promise<unknown>;
  await save.call(desktop, { ...state, visits: {}, recents: [] }, 1, {
    id: 'clear',
    base: state.visits,
    clear: true,
    revision: 0,
    clearRevision: 0,
    restored: {},
    forgotten: ['/fixtures/A'],
  });
  expect(checks.paths).toEqual(['/fixtures/Unrelated']);
  checks.close();
});
