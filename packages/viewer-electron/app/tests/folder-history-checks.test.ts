import { Desktop } from '../src/desktop/bridge';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceDefinitions } from '../src/desktop/workspaces/definitions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
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
      onError?: (error: Error) => void;
      onExit?: (code: number) => void;
      request?: string;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    }[],
);
const workerControls = vi.hoisted(() => ({
  failNextSend: undefined as Error | undefined,
  terminateNext: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('../src/desktop/workers/utility-client', () => ({
  launchWorker: vi.fn(() => {
    const terminateImpl = workerControls.terminateNext;
    workerControls.terminateNext = undefined;
    const worker: (typeof workers)[number] = {
      postMessage: vi.fn((path: string) => {
        if (workerControls.failNextSend) {
          const error = workerControls.failNextSend;
          workerControls.failNextSend = undefined;
          throw error;
        }
        worker.request = path;
        if (!path.startsWith('/Volumes/Sleeping/') && !path.endsWith('/slow'))
          queueMicrotask(() => worker.receive?.({ value: { directory: true, path } }));
      }),
      terminate: vi.fn(async () => {
        if (terminateImpl) await terminateImpl();
      }),
    };
    workers.push(worker);
    return {
      postMessage: worker.postMessage,
      message: (listener: typeof worker.receive) => {
        worker.receive = listener;
      },
      exit: (listener: (code: number) => void) => {
        worker.onExit = listener;
      },
      thread: {
        terminate: worker.terminate,
        on: (event: string, listener: (error: Error) => void) => {
          if (event === 'error') worker.onError = listener;
        },
      },
    };
  }),
}));
afterEach(() => {
  workers.length = 0;
  workerControls.failNextSend = undefined;
  workerControls.terminateNext = undefined;
  vi.useRealTimers();
});

it('keeps definition roots in their own lanes and cache while folder history remains immediately usable', async () => {
  const history = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const definitions = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const desktop = Object.create(Desktop.prototype) as Desktop;
  Object.assign(desktop, {
    home: '/home/sample',
    folderChecks: history,
    definitionRootChecks: definitions,
    settings: { snapshot: () => ({ settings: defaultSettings('/home/sample') }) },
  });
  const directory = await temporaryRoot('viewer-definition-checker-wiring-');
  await writeFile(
    path.join(directory, 'workspaces.jsonc'),
    JSON.stringify({
      version: 1,
      sources: { projectManager: { enabled: false } },
      workspaces: {
        sleepingOne: { root: '/Volumes/Sleeping/one' },
        sleepingTwo: { root: '/Volumes/Sleeping/two' },
        ...Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => [
            'definition-' + index,
            { root: '/fixtures/definition-' + index },
          ]),
        ),
      },
    }),
  );
  const create = Reflect.get(desktop, 'createWorkspaceDefinitions') as (
    directory: string,
    access: () => Promise<void>,
    emit: () => void,
  ) => WorkspaceDefinitions;
  const service = create.call(
    desktop,
    directory,
    async () => {},
    () => {},
  );
  try {
    await service.load();
    vi.useFakeTimers();
    const check = (key: string) => service.checkRoot(key);
    await history.check('/fixtures/recent');
    const pending = [check('sleepingOne'), check('sleepingTwo')];
    await vi.advanceTimersByTimeAsync(0);
    const recent = history.check('/fixtures/another');
    await vi.advanceTimersByTimeAsync(0);
    let finished = false;
    void recent.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    expect(await recent).toMatchObject({ directory: true });
    await vi.advanceTimersByTimeAsync(151);
    await Promise.all(pending);
    for (let index = 0; index < 501; index++) await check('definition-' + index);
    expect(history.paths).toEqual(['/fixtures/recent', '/fixtures/another']);
  } finally {
    for (const worker of workers)
      worker.receive?.({ value: { directory: true, path: worker.request } });
    await service.close();
    history.close();
    definitions.close();
  }
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

it('defers a scope that is not already active without dispatching metadata', async () => {
  const scope = vi.fn(() => undefined);
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs', scope);
  expect(await checks.check('/fixtures/Saved')).toMatchObject({ unchecked: true });
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

it.each([
  { clear: true, failed: '' },
  { clear: false, failed: '' },
  { clear: true, failed: 'declared' },
  { clear: true, failed: 'found' },
])(
  'the actual save handler finishes Clear with every private store ($clear, $failed)',
  async ({ clear, failed }) => {
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
    const emitted = vi.fn();
    const clearDeclared = vi.fn(async () => {
      if (failed === 'declared') throw new Error('Declared store EACCES');
    });
    const clearFound = vi.fn(async () => {
      if (failed === 'found') throw new Error('Found store EACCES');
    });
    const diagnose = vi.fn();
    Object.assign(desktop, {
      workspaceSessions: sessions,
      folderChecks: checks,
      folderHistoryPrepared: new BackgroundFolderHistory(),
      declaredCommands: { clearHistory: clearDeclared },
      foundWorkspaces: { clearHistory: clearFound, historyChanged: vi.fn() },
      chats: { retain: () => {} },
      storage: { save: async () => {} },
      activity: {
        at: (_context: unknown, work: () => Promise<unknown>) => work(),
        run: (_kind: string, _name: string, work: () => Promise<unknown>) => work(),
      },
      withPreferences: (value: unknown) => value,
      emit: emitted,
      assignWorkspace: () => {},
      options: { diagnose },
    });
    const save = Reflect.get(desktop, 'saveWorkspaces') as (
      input: SavedState,
      owner: number,
      metadata: FolderVisitSave,
    ) => Promise<unknown>;
    const reply = await save.call(desktop, { ...state, visits: {}, recents: [] }, 1, {
      id: 'clear',
      base: state.visits,
      clear,
      revision: 0,
      clearRevision: 0,
      restored: {},
      forgotten: ['/fixtures/A'],
    });
    expect(checks.paths).toEqual(['/fixtures/Unrelated']);
    expect(clearDeclared).toHaveBeenCalledTimes(clear ? 1 : 0);
    expect(clearFound).toHaveBeenCalledTimes(clear ? 1 : 0);
    expect(diagnose).toHaveBeenCalledTimes(failed ? 1 : 0);
    if (clear) {
      expect(reply).toHaveProperty('clearID', 'clear');
      expect(emitted.mock.calls[0]?.[0]).toHaveProperty('folderClearID', 'clear');
    }
    checks.close();
  },
);

it('remaps checked paths so a later clear removes the renamed folder only', async () => {
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  await checks.check('/fixtures/A/Child');
  await checks.check('/fixtures/Other');
  checks.remap([{ source: '/fixtures/A', destination: '/fixtures/A2' }]);
  expect(checks.paths).toEqual(['/fixtures/A2/Child', '/fixtures/Other']);
  checks.clear(['/fixtures/A2/Child']);
  expect(checks.paths).toEqual(['/fixtures/Other']);
  checks.close();
});

it('lists unchecked folders past an unused Store volume root without reporting a failed check', async () => {
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs', () => undefined);
  const incomplete = vi.fn();
  const paths = ['/Volumes/Unused/Projects', '/Volumes/Unused/Projects archive'];
  expect(
    await checkFolderCandidates(paths, checks.check, new AbortController().signal, {
      onIncomplete: incomplete,
    }),
  ).toEqual(paths);
  expect(incomplete).not.toHaveBeenCalled();
  expect(workers).toHaveLength(0);
  expect(checks.paths).toEqual([]);
  checks.close();
});

it('keeps a checked missing folder hidden when its Store grant stops being active', async () => {
  let active = true;
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs', () =>
    active ? { allows: () => true } : undefined,
  );
  const path = '/Volumes/Sleeping/Gone';
  const result = checks.check(path);
  await vi.waitFor(() => expect(workers.some((worker) => worker.request === path)).toBe(true));
  workers
    .find((worker) => worker.request === path)!
    .receive?.({ value: { directory: false, unavailable: true, missing: true } });
  await result;
  active = false;
  expect(await checks.check(path)).toEqual({ directory: false, unavailable: true, missing: true });
  expect(await checkFolderCandidates([path], checks.check, new AbortController().signal)).toEqual(
    [],
  );
  checks.close();
});

it('stops spawning workers after close and awaits worker termination', async () => {
  let finishTerminate!: () => void;
  workerControls.terminateNext = () =>
    new Promise<void>((resolve) => {
      finishTerminate = resolve;
    });
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  expect(await checks.check('/fixtures/before-close')).toMatchObject({ directory: true });
  expect(workers).toHaveLength(1);

  let closed = false;
  const closing = Promise.resolve(checks.close()).then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(await checks.check('/fixtures/after-close')).toEqual({
    directory: false,
    unavailable: true,
  });
  expect(workers).toHaveLength(1);
  finishTerminate();
  await closing;
  expect(closed).toBe(true);
});

it('retires an errored thread slot before exit and releases a slot when postMessage throws', async () => {
  const checks = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  const slow = checks.check('/fixtures/slow');
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  // Thread error fires before exit: the dying slot must be retired immediately.
  workers[0]!.onError?.(new Error('worker crashed'));
  expect(await slow).toEqual({ directory: false, unavailable: true });
  expect(await checks.check('/fixtures/healthy')).toMatchObject({
    directory: true,
    path: '/fixtures/healthy',
  });
  expect(workers).toHaveLength(2);
  expect(workers[0]!.postMessage).toHaveBeenCalledTimes(1);
  await checks.close();

  workers.length = 0;
  const checksTwo = new FolderHistoryChecks('/fixtures/history-worker.cjs');
  workerControls.failNextSend = new Error('MessagePort closed');
  expect(await checksTwo.check('/fixtures/broken')).toEqual({
    directory: false,
    unavailable: true,
  });
  expect(await checksTwo.check('/fixtures/recovered')).toMatchObject({
    directory: true,
    path: '/fixtures/recovered',
  });
  expect(workers).toHaveLength(2);
  await checksTwo.close();
});
