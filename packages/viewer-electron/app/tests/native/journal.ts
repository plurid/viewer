/** Packaged Journal acceptance, confined to a fresh profile and generated files. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_STATE_VERSION,
  type OperationJob,
  type SavedState,
} from '../../src/domain/contracts';
import type { JournalPage } from '../../src/domain/journal/events';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

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
const app = await ownedApp(binary, profile);
let main: Awaited<ReturnType<typeof app.connect>> | undefined;
let failure: unknown;
try {
  main = await app.connect();
  const connection = main;
  const { evaluate, command } = connection;
  await until(
    () => evaluate<boolean>('!!document.querySelector(".folder-plane")'),
    Boolean,
    'folder loaded',
  );
  const palette = async (label: string) => {
    await evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
    await until(
      () =>
        evaluate<boolean>(
          'document.activeElement?.getAttribute("aria-label") === "Search commands"',
        ),
      Boolean,
      'palette ready',
    );
    await command('Input.insertText', { text: label });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent ?? ""',
        ),
      (text) => text.includes(label),
      label,
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  const query = () => evaluate<JournalPage>('window.viewer.journalQuery({filter:{},limit:200})');
  const operation = await evaluate<string>(
    `window.viewer.operate(${JSON.stringify({ kind: 'copy', sources: [source], destination })})`,
  );
  await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
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
    `window.viewer.gitAction(${JSON.stringify({
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
    })})`,
  );
  await until(
    query,
    (page) =>
      page.records.some((record) => record.taskID === gitID && record.phase === 'succeeded'),
    'actual read-only Git process completion',
  );
  checks.push('real hardened Git status process start/exit in one trace');
  const server = await evaluate<{ id: string }>(
    `window.viewer.localServerStart(${JSON.stringify(folder)},'folder')`,
  );
  await evaluate(`window.viewer.localServerAction(${JSON.stringify(server.id)},'stop')`);
  const chat = await evaluate<{ id: string }>(
    `window.viewer.chat({kind:'create',paths:[${JSON.stringify(folder)}]})`,
  );
  await evaluate(
    `window.viewer.chat({kind:'send',id:${JSON.stringify(chat.id)},text:'Synthetic test request',providerID:'absent-fixture-provider'}).catch(()=>null)`,
  );
  await until(
    query,
    (page) => page.records.some((record) => record.source === 'chat' && record.phase === 'failed'),
    'safe model failure',
  );
  checks.push('local server start/stop and a rejected model request, no provider network');
  await palette('Open Journal');
  await until(
    () => evaluate<number>('document.querySelectorAll(".journal-event").length'),
    (count) => count > 0,
    'virtualized Journal rows',
  );
  await palette('Dock plane');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".journal-plane")'),
    Boolean,
    'docked Journal',
  );
  await evaluate('document.querySelector(".journal-event").click()');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".journal-details")'),
    Boolean,
    'event inspector',
  );
  assert.equal(await evaluate<boolean>('window.viewer.journalAppend === undefined'), true);
  const rowsBefore = await evaluate<string>('document.querySelector(".journal-rows").textContent');
  await evaluate(`window.viewer.localServerAction(${JSON.stringify(server.id)},'restart')`);
  await until(
    () => evaluate<string>('document.querySelector(".journal-follow").textContent'),
    (text) => text.includes('new'),
    'paused unread indicator',
  );
  assert.equal(
    await evaluate<string>('document.querySelector(".journal-rows").textContent'),
    rowsBefore,
  );
  checks.push('paused rows remain stable; unseen activity is explicit; no renderer append API');
  const bounds = async () => {
    let previous = '';
    let stable = 0;
    await until(
      () =>
        evaluate<number[]>(`(() => {
        const rect = document.querySelector('.journal-plane').getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height, innerWidth, innerHeight];
      })()`),
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
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
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
  const revision = await evaluate<number>(
    'window.viewer.settingsGet().then(snapshot=>snapshot.revision)',
  );
  await evaluate(
    `window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],${revision})`,
  );
  await capture('desktop-light.png', 1440, 900);
  checks.push('dark/light and narrow native renderer captures');
  await evaluate('document.querySelector(".journal-follow").click()');
  const preview = await evaluate<{ text: string; count: number }>(
    'window.viewer.journalExportPreview({filter:{},limit:200})',
  );
  assert.ok(preview.count > 0);
  assert.ok(!preview.text.includes(source) && !preview.text.includes('Synthetic test request'));
  checks.push('bounded exact export preview excludes paths and request content');
  await evaluate(`window.viewer.localServerAction(${JSON.stringify(server.id)},'stop')`);
  const final = await query();
  const fileTrace = final.records.filter((record) => record.taskID === operation);
  assert.equal(fileTrace.length, 2);
  assert.equal(fileTrace[0]?.traceID, fileTrace[1]?.traceID);
  assert.equal(fileTrace[0]?.origin.workspaceID, initial.activeWorkspace);
  assert.equal(fileTrace[0]?.origin.planeID, 'folder');
  checks.push('actual desktop service origin and correlation agree with the generated workspace');
  await evaluate('document.querySelector(\'[aria-label="Event source"]\').click()');
  await until(
    () => evaluate<boolean>('!!document.querySelector(\'[data-menu-id="choice:git"]\')'),
    Boolean,
    'Git source choice',
  );
  await evaluate('document.querySelector(\'[data-menu-id="choice:git"]\').click()');
  await until(
    () => evaluate<string>('document.querySelector(\'[aria-label="Event source"]\').textContent'),
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
      () =>
        read.evaluate<string>(
          'document.querySelector(\'.journal-plane [aria-label="Event source"]\')?.textContent ?? ""',
        ),
      (text) => text.includes('Git'),
      'cold restored Journal filter',
    );
    const history = await read.evaluate<JournalPage>(
      'window.viewer.journalQuery({filter:{source:"git"},limit:200})',
    );
    assert.equal(history.records.filter((record) => record.phase === 'started').length, 1);
    assert.equal(history.records.filter((record) => record.phase === 'succeeded').length, 1);
    assert.equal((await read.evaluate<OperationJob[]>('window.viewer.jobs()')).length, 1);
    assert.deepEqual(await read.evaluate('window.viewer.localServers()'), []);
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
