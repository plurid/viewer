import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { checkHistoryFolder } from '../src/desktop/files/folder-history';
import { afterEach, expect, it, vi } from 'vitest';
import { Desktop } from '../src/desktop/bridge';
import { BackgroundFolderHistory } from '../src/desktop/files/folder-history';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { defaultSettings } from '../src/domain/services';
import type { Bootstrap, DesktopEvent } from '../src/domain/contracts';
import type { DefinitionCatalog } from '../src/domain/workspaces/definitions/schema';

vi.mock('electron', () => ({ app: { getPath: () => '/fixtures' } }));
afterEach(() => vi.useRealTimers());

export function launchFixture(
  check: (path: string) => Promise<{ directory: boolean }>,
  paths = ['/fixtures/never'],
  cached: string[] = [],
) {
  const sessions = new WorkspaceSessions();
  const state = sessions.open(1, '/fixtures');
  sessions.close(1);
  state.visits = Object.fromEntries(paths.map((path) => [path, { count: 1, last: 1 }]));
  const preparation = new BackgroundFolderHistory();
  const desktop = Object.create(Desktop.prototype) as Desktop;
  const events: DesktopEvent[] = [];
  const settings = { settings: defaultSettings('/fixtures') };
  const record = { paths: [], launches: [], window: { isDestroyed: () => false } };
  Object.assign(desktop, {
    home: '/fixtures',
    storage: { load: async () => ({ state }) },
    fileAccess: { load: async () => {}, require: async () => {} },
    settings: { load: async () => {}, seedFolders: async () => {}, snapshot: () => settings },
    definitions: {
      load: async () => {},
      snapshot: (): DefinitionCatalog => ({
        revision: 0,
        file: { path: '/fixtures/workspaces.jsonc', state: 'absent' },
        projectManager: {
          path: '/fixtures/projects.json',
          state: 'absent',
          projects: 0,
          missing: 0,
          disabled: 0,
          remote: 0,
          duplicateKeys: 0,
        },
        definitions: [],
        diagnostics: [],
      }),
    },
    credentials: { load: async () => {}, ids: () => [] },
    folderHistoryPrepared: preparation,
    folderChecks: { check, paths: cached },
    workspaceSessions: new WorkspaceSessions(),
    windows: new Map([[1, record]]),
    assignWorkspace: () => {},
    initialFolder: () => '/fixtures',
    withPreferences: (value: unknown) => value,
    reconfigureIndex: async () => {},
    files: { warmPreviews: async () => {} },
    actions: { load: async () => {} },
    watchRules: { start: async () => {} },
    configureAgents: async () => {},
    requireRecord: () => record,
    emit: (event: DesktopEvent) => events.push(event),
    openPaths: [],
    options: {},
  });
  return Object.assign(
    () =>
      (Reflect.get(desktop, 'bootstrap') as (sender: number) => Promise<Bootstrap>).call(
        desktop,
        1,
      ),
    { stop: () => preparation.clear(), events },
  );
}

it('returns the real bootstrap before a remembered folder check can answer', async () => {
  vi.useFakeTimers();
  const check = vi.fn(() => new Promise<{ directory: boolean }>(() => {}));
  const launch = launchFixture(check);
  const result = await launch();
  expect(result.state?.visits).toHaveProperty('/fixtures/never');
  expect(check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(check).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(151);
});

it('measures bootstrap independently of local and delayed remembered-folder checks', async () => {
  const root = await temporaryRoot('viewer-history-launch-');
  const local = Array.from({ length: 500 }, (_, i) => path.join(root, String(i)));
  for (let start = 0; start < local.length; start += 20)
    await Promise.all(local.slice(start, start + 20).map((file) => mkdir(file)));
  const cases = [
    { label: '500 local', paths: local, delay: 0 },
    {
      label: '400 local plus 100 NAS at 40 ms',
      paths: [
        ...local.slice(0, 400),
        ...Array.from({ length: 100 }, (_, i) => `/Volumes/NAS/${i}`),
      ],
      delay: 40,
    },
    {
      label: '500 network-home folders at 40 ms',
      paths: Array.from({ length: 500 }, (_, i) => `/Volumes/Home/${i}`),
      delay: 40,
    },
    {
      label: '500 folders at 140 ms',
      paths: Array.from({ length: 500 }, (_, i) => `/Volumes/Slow/${i}`),
      delay: 140,
    },
  ];
  const measurements = [];
  for (const scenario of cases) {
    const values = [];
    for (let sample = 0; sample < 7; sample++) {
      const check = vi.fn(async (file: string) => {
        if (!file.startsWith(root))
          await new Promise((resolve) => setTimeout(resolve, scenario.delay));
        return file.startsWith(root) ? checkHistoryFolder(file) : { directory: true };
      });
      const launch = launchFixture(check, scenario.paths);
      const start = performance.now();
      const result = await launch();
      values.push(performance.now() - start);
      expect(Object.keys(result.state?.visits ?? {})).toHaveLength(500);
      expect(check).not.toHaveBeenCalled();
      launch.stop();
    }
    values.sort((a, b) => a - b);
    measurements.push({
      case: scenario.label,
      medianBootstrapMs: Number(values[3]!.toFixed(3)),
      folderChecksWaitedFor: 0,
    });
  }
  console.log(
    JSON.stringify({
      evidence: 'real bootstrap, local fixture folders, injected remote latency',
      measurements,
    }),
  );
});

it('keeps cleared cached paths out of a subsequently bootstrapped window', async () => {
  const launch = launchFixture(async () => ({ directory: true }), [], ['/fixtures/Cleared']);
  expect((await launch()).checkedFolders).toEqual([]);
  launch.stop();
});

it('broadcasts the background checked folders to windows that are already open', async () => {
  vi.useFakeTimers();
  const launch = launchFixture(
    async (path) => ({ directory: true, path }),
    ['/fixtures/Downloads'],
  );
  expect((await launch()).checkedFolders).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  const event = launch.events.find((event) => event.type === 'workspaces');
  expect(event?.type === 'workspaces' && event.checkedFolders).toEqual(['/fixtures/Downloads']);
  launch.stop();
});
