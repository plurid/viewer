import { afterEach, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import type { FoundWorkspaces } from '../src/desktop/workspaces/found-workspaces';
import { Desktop } from '../src/desktop/bridge';
import { DefinedWorkspaces } from '../src/desktop/workspaces/defined-workspaces';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { stateSchema } from '../src/desktop/persistence/storage';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from '../tools/temporary';
import { sampleWorkspace } from './workspace-definition-fixtures';

vi.mock('electron', () => ({ app: { getPath: () => '/fixtures' } }));
const services: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.restoreAllMocks();
});

it('the desktop Clear port preserves remembered entries older than ninety days', async () => {
  const directory = await temporaryRoot('viewer-found-desktop-');
  const home = directory + '/home';
  const root = home + '/code/sample';
  const now = 1_800_000_000_000;
  const old = now - 200 * 86_400_000;
  const workspace = sampleWorkspace('remembered', {
    definition: { key: 'code/sample', basis: 'a'.repeat(64), source: 'found' },
  });
  const state = stateSchema.parse({
    version: 13,
    workspaces: [workspace],
    activeWorkspace: workspace.id,
    favorites: [],
    recents: [],
    look: 'dark',
  });
  const memory = new DefinedWorkspaces(directory + '/memory');
  services.push(memory);
  vi.spyOn(Date, 'now').mockReturnValue(old);
  await memory.remember(workspace, state);
  vi.mocked(Date.now).mockReturnValue(now);
  const sessions = new WorkspaceSessions();
  sessions.seed({ ...state, workspaces: [sampleWorkspace()], activeWorkspace: 'open' });
  const desktop = Object.create(Desktop.prototype) as Desktop;
  Object.assign(desktop, {
    home,
    folderFacts: { pass: () => ({ relaunches: 0, exhausted: false }), probe: vi.fn() },
    workspaceSessions: sessions,
    definedWorkspaces: memory,
    settings: { snapshot: () => ({ settings: defaultSettings(home) }) },
    fileAccess: { historyScope: () => ({}), historyScopeRoot: () => undefined },
  });
  await writeFile(
    directory + '/found-workspaces-v1.json',
    JSON.stringify({
      version: 1,
      entries: [{ key: 'code/sample', root, realpath: root, identity: '1:2', names: [], at: old }],
      hidden: [],
      probes: [],
    }),
  );
  const create = Reflect.get(desktop, 'createFoundWorkspaces') as (path: string) => FoundWorkspaces;
  const found = create.call(desktop, directory);
  services.push(found);
  await found.clearHistory();
  const stored = JSON.parse(await readFile(found.store.file, 'utf8'));
  expect(stored.entries).toMatchObject([{ key: 'code/sample', root }]);
});
