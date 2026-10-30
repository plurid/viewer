/** Packaged Journal acceptance, confined to a fresh profile and generated files. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { GitActionRequest } from '../../src/domain/comparison/git-actions';
import type { ChatDocument } from '../../src/domain/models/chat';
import type { LocalServerAction } from '../../src/domain/previews/web';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { animationFrames, click, countOf, exists, patchSettings, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary && path.isAbsolute(binary), 'Choose an explicit packaged Viewer binary.');
const root = await realpath(await temporaryRoot('viewer-native-journal-'));
const profile = path.join(root, 'Profile');
const folder = path.join(root, 'Generated files');
const destination = path.join(folder, 'Copies');
const screenshots = path.join(root, 'Screenshots');
const templates = path.join(root, 'Empty Git templates');
await Promise.all(
  [profile, folder, screenshots, templates].map((file) => mkdir(file, { mode: 0o700 })),
);
await promisify(execFile)(
  '/usr/bin/git',
  [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    'init',
    '--initial-branch=main',
    '--template=' + templates,
    folder,
  ],
  {
    env: {
      PATH: '/usr/bin:/bin',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    timeout: 10_000,
    maxBuffer: 65536,
  },
);
await mkdir(destination, { mode: 0o700 });
const source = path.join(folder, 'journal-fixture.txt');
await writeFile(source, 'Generated Journal acceptance fixture.\n', { flag: 'wx', mode: 0o600 });
const settings = defaultSettings(folder);
settings.hotkey.enabled = false;
settings.providers = [];
settings.agents.enabled = false;
const ui = normalizePreferences();
ui.space.minimap = false;
const initial: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'journal-acceptance',
  look: 'dark',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'journal-acceptance',
      name: 'Generated acceptance',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: folder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [folder],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  mode: 0o600,
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial), {
  mode: 0o600,
});
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const checks: string[] = [];
const candidate = {
  binary,
  executable: await hash(binary),
  archive: await hash(path.join(path.dirname(path.dirname(binary)), 'Resources/app.asar')),
};

const searchFocused = () =>
  document.activeElement?.getAttribute('aria-label') === 'Search commands';

/** The text of the first match; refuses a missing element. */
function requiredText(selector: string): string {
  const element = document.querySelector(selector);
  if (!element) throw new Error('Nothing matches: ' + selector);
  return element.textContent;
}

const journalPage = () => window.viewer.journalQuery({ filter: {}, limit: 200 });

const copy = (sources: string[], destination: string) =>
  window.viewer.operate({ kind: 'copy', sources, destination });

const serverAction = (id: string, action: LocalServerAction) =>
  window.viewer.localServerAction(id, action);

/** Chat answers `create` with the new conversation. */
const createChat = (paths: string[]) =>
  window.viewer.chat({ kind: 'create', paths }) as Promise<ChatDocument>;

/** A request to a provider that does not exist, so nothing reaches the network. */
const sendToAbsentProvider = (id: string) =>
  window.viewer
    .chat({
      kind: 'send',
      id,
      text: 'Synthetic test request',
      providerID: 'absent-fixture-provider',
    })
    .catch(() => null);

/** The renderer has no route to write Journal records itself. */
const noJournalAppend = () =>
  (window.viewer as unknown as Record<string, unknown>).journalAppend === undefined;

function journalGeometry(): number[] {
  const rect = document.querySelector('.journal-plane')!.getBoundingClientRect();
  return [rect.x, rect.y, rect.width, rect.height, innerWidth, innerHeight];
}

const app = await ownedApp(binary, profile);
let main: Awaited<ReturnType<typeof app.connect>> | undefined;
let failure: unknown;
try {
  main = await app.connect();
  const connection = main;
  const { evaluate, command } = connection;
  await until(() => evaluate(exists('.folder-plane')), Boolean, 'folder loaded');
  const palette = async (label: string) => {
    await evaluate(click('[aria-label="Commands (⌘K)"]'));
    await until(() => evaluate(pageCall(searchFocused)), Boolean, 'palette ready');
    await command('Input.insertText', { text: label });
    await until(
      () => evaluate(textOf('.command-result[aria-selected=true]')),
      (text) => text.includes(label),
      label,
    );
    await evaluate(click('.command-result[aria-selected=true]'));
  };
  const query = () => evaluate(pageCall(journalPage));
  const operation = await evaluate(pageCall(copy, [source], destination));
  await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) => jobs.some((job) => job.id === operation && job.status === 'completed'),
    'real copy completed',
  );
  await until(
    query,
    (page) =>
      page.records.some((record) => record.source === 'files' && record.phase === 'succeeded'),
    'file lifecycle recorded',
  );
  assert.equal(
    await readFile(path.join(destination, path.basename(source)), 'utf8'),
    await readFile(source, 'utf8'),
  );
  checks.push('real file copy, start/completion trace and retained source');
  const gitID = crypto.randomUUID();
  await evaluate(
    pageCall((request: GitActionRequest) => window.viewer.gitAction(request), {
      id: gitID,
      kind: 'status',
      target: {
        workspaceID: initial.activeWorkspace,
        rootID: 'folder',
        paneID: 'folder',
        panePath: folder,
        directory: folder,
        selection: [],
      },
    }),
  );
  await until(
    query,
    (page) =>
      page.records.some((record) => record.taskID === gitID && record.phase === 'succeeded'),
    'actual read-only Git process completion',
  );
  checks.push('real hardened Git status process start/exit in one trace');
  const server = await evaluate(
    pageCall((root: string) => window.viewer.localServerStart(root, 'folder'), folder),
  );
  await evaluate(pageCall(serverAction, server.id, 'stop'));
  const chat = await evaluate(pageCall(createChat, [folder]));
  await evaluate(pageCall(sendToAbsentProvider, chat.id));
  await until(
    query,
    (page) => page.records.some((record) => record.source === 'chat' && record.phase === 'failed'),
    'safe model failure',
  );
  checks.push('local server start/stop and a rejected model request, no provider network');
  await palette('Open Journal');
  await until(
    () => evaluate(countOf('.journal-event')),
    (count) => count > 0,
    'virtualized Journal rows',
  );
  await palette('Dock plane');
  await until(() => evaluate(exists('.journal-plane')), Boolean, 'docked Journal');
  await evaluate(click('.journal-event'));
  await until(() => evaluate(exists('.journal-details')), Boolean, 'event inspector');
  assert.equal(await evaluate(pageCall(noJournalAppend)), true);
  const rowsBefore = await evaluate(pageCall(requiredText, '.journal-rows'));
  await evaluate(pageCall(serverAction, server.id, 'restart'));
  await until(
    () => evaluate(textOf('.journal-follow')),
    (text) => text.includes('new'),
    'paused unread indicator',
  );
  assert.equal(await evaluate(pageCall(requiredText, '.journal-rows')), rowsBefore);
  checks.push('paused rows remain stable; unseen activity is explicit; no renderer append API');
  const bounds = async () => {
    let previous = '';
    let stable = 0;
    await until(
      () => evaluate(pageCall(journalGeometry)),
      (geometry) => {
        const current = JSON.stringify(geometry.map((value) => Math.round(value * 10)));
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        return (
          stable >= 4 &&
          geometry[2]! > 300 &&
          geometry[0]! >= -2 &&
          geometry[0]! + geometry[2]! <= geometry[4]! + 2 &&
          geometry[1]! + geometry[3]! <= geometry[5]! + 2
        );
      },
      'Journal geometry',
    );
    await evaluate(animationFrames(2));
  };
  const capture = async (name: string, width: number, height: number) => {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await palette('Frame plane');
    await bounds();
    const image = await command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(path.join(screenshots, name), Buffer.from(image.data, 'base64'), {
      mode: 0o600,
    });
  };
  await capture('desktop-dark.png', 1440, 900);
  await capture('minimum-dark.png', 760, 650);
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await capture('desktop-light.png', 1440, 900);
  checks.push('dark/light and narrow native renderer captures');
  await evaluate(click('.journal-follow'));
  const preview = await evaluate(
    pageCall(() => window.viewer.journalExportPreview({ filter: {}, limit: 200 })),
  );
  assert.ok(preview.count > 0);
  assert.ok(!preview.text.includes(source) && !preview.text.includes('Synthetic test request'));
  checks.push('bounded exact export preview excludes paths and request content');
  await evaluate(pageCall(serverAction, server.id, 'stop'));
  const final = await query();
  const fileTrace = final.records.filter((record) => record.taskID === operation);
  assert.equal(fileTrace.length, 2);
  assert.equal(fileTrace[0]?.traceID, fileTrace[1]?.traceID);
  assert.equal(fileTrace[0]?.origin.workspaceID, initial.activeWorkspace);
  assert.equal(fileTrace[0]?.origin.planeID, 'folder');
  checks.push('actual desktop service origin and correlation agree with the generated workspace');
  await evaluate(click('[aria-label="Event source"]'));
  await until(() => evaluate(exists('[data-menu-id="choice:git"]')), Boolean, 'Git source choice');
  await evaluate(click('[data-menu-id="choice:git"]'));
  await until(
    () => evaluate(textOf('[aria-label="Event source"]')),
    (text) => text.includes('Git'),
    'saved source filter',
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await app.close(main);
  } catch (error) {
    failure ??= error;
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        version: 1,
        root,
        profile,
        screenshots,
        candidate,
        checks,
        retained: true,
        noRemoval: true,
        error: failure instanceof Error ? failure.stack : failure,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
if (!failure) {
  const restored = await ownedApp(binary, profile);
  let connection: Awaited<ReturnType<typeof restored.connect>> | undefined;
  try {
    connection = await restored.connect();
    const read = connection;
    await until(
      () => read.evaluate(textOf('.journal-plane [aria-label="Event source"]')),
      (text) => text.includes('Git'),
      'cold restored Journal filter',
    );
    const history = await read.evaluate(
      pageCall(() => window.viewer.journalQuery({ filter: { source: 'git' }, limit: 200 })),
    );
    assert.equal(history.records.filter((record) => record.phase === 'started').length, 1);
    assert.equal(history.records.filter((record) => record.phase === 'succeeded').length, 1);
    assert.equal((await read.evaluate(pageCall(() => window.viewer.jobs()))).length, 1);
    assert.deepEqual(await read.evaluate(pageCall(() => window.viewer.localServers())), []);
    checks.push(
      'cold restore retains filters/history without replaying Git, file operations or servers',
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      await restored.close(connection);
    } catch (error) {
      failure ??= error;
    }
  }
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        version: 1,
        root,
        profile,
        screenshots,
        candidate,
        checks,
        retained: true,
        noRemoval: true,
        error: failure instanceof Error ? failure.stack : failure,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
console.log(JSON.stringify({ root, screenshots, checks }));
if (failure) throw failure;
