/** Generated worktree and packaged renderer qualification. Task delivery is injected at the
 * renderer event boundary; native confirmations, real microphones and accounts are not exercised. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { SpeechStatus } from '../../src/domain/speech/recognition';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { AgentTaskWorkflows } from '../../src/desktop/agents/task-workflow';
import { Notes } from '../../src/desktop/editing/notes';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await realpath(await temporaryRoot('viewer-native-task-speech-'));
const profile = path.join(root, 'Profile'),
  repo = path.join(root, 'Project');
await Promise.all([profile, repo].map((directory) => mkdir(directory)));
const run = promisify(execFile);
const git = (...args: string[]) =>
  run(
    '/usr/bin/git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-C', repo, ...args],
    {
      env: {
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Generated fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Generated fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    },
  );
await git('init', '--initial-branch=main', '--template=');
await writeFile(path.join(repo, 'Hello.txt'), 'Generated live task.\n', { flag: 'wx' });
await git('add', '--', 'Hello.txt');
await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
const ui = normalizePreferences(),
  settings = defaultSettings(repo);
ui.space.opening = 'dock';
settings.hotkey.enabled = false;
settings.providers = [];
settings.git.enabled = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'start',
  favorites: [],
  recents: [],
  look: 'dark',
  ui,
  workspaces: [
    {
      id: 'start',
      name: 'Start workspace',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: repo,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [repo],
          historyIndex: 0,
        },
      ],
    },
    { id: 'target', name: 'Task workspace', roots: [], panes: [], arrangement: {} },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const captures: string[] = [],
  checks: string[] = [];
const captureRoot = path.resolve('../../../.impeccable/review/task-speech-' + path.basename(root));
await mkdir(captureRoot, { recursive: true });
const secret = 'GENERATED_METADATA_KEY';
let mode: 'available' | 'missing' | 'auth' = 'available',
  requests = 0;
const server = createServer(async (request, response) => {
  assert.equal(request.method, 'GET');
  assert.equal(request.url, '/v1/models');
  assert.equal(request.headers.authorization, 'Bearer ' + secret);
  for await (const bytes of request) assert.equal(bytes.length, 0);
  requests++;
  response.writeHead(mode === 'auth' ? 401 : 200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify(
      mode === 'auth'
        ? { error: secret + ' must not appear' }
        : { data: [{ id: mode === 'available' ? 'generated-speech' : 'other-model' }] },
    ),
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/v1`;
const app = await ownedApp(binary, profile, { mode: 'foreground' });
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
let tasks: AgentTaskWorkflows | undefined;
const providerID = randomUUID();
try {
  connection = await app.connect();
  const page = connection;
  await page.command('Page.enable');
  // The app's frozen API remains unchanged in production. This owned debugger substitutes
  // only synthetic event delivery and its acknowledgement, retaining actual persistence IPC.
  await page.command('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
    window.generatedTaskInstrumentation = true;
    const define = Object.defineProperty, listeners = new Set();
    Object.defineProperty = function(target, name, descriptor) {
      if (target === window && name === 'viewer' && descriptor.value) {
        const actual = descriptor.value;
        window.generatedTaskDelivery = { dispatch(event) { for (const listener of [...listeners]) listener(event); }, ack: null };
        descriptor = { ...descriptor, value: Object.freeze({ ...actual,
          onEvent(listener) { listeners.add(listener); const stop = actual.onEvent(listener); return () => { listeners.delete(listener); stop(); }; },
          agentCommandResult(id, error) { window.generatedTaskDelivery.ack = { id, error }; return Promise.resolve(); }
        }) };
        Object.defineProperty = define;
      }
      return define(target, name, descriptor);
    };
  })()`,
  });
  await page.command('Page.reload', { ignoreCache: true });
  await until(
    () =>
      page
        .evaluate<{ fixture: boolean; folder: boolean; body: string }>(
          '({fixture:!!window.generatedTaskDelivery,folder:!!document.querySelector(".folder-explorer"),body:document.body.innerText.slice(0,1000)})',
        )
        .catch(() => ({ fixture: false, folder: false, body: 'Loading' })),
    (value) => value.fixture && value.folder,
    'Owned renderer fixture ready',
  );
  const notes = new Notes(profile);
  const authorize = async (file: string) => {
    assert.ok(file === root || file.startsWith(root + path.sep));
    return file;
  };
  const catalog = {
    activeWorkspace: 'start',
    workspaces: state.workspaces.map((space) => ({
      id: space.id,
      name: space.name,
      panes: [],
      roots: [],
    })),
  };
  tasks = new AgentTaskWorkflows({
    available: () => true,
    authorize,
    workspaceState: () => catalog,
    window: () => ({ id: 1, originID: 'generated-window' }),
    profile: () => 'default',
    note: async (directory) => {
      const result = await notes.request({ kind: 'create', format: 'note', directory });
      assert.equal(result.kind, 'document');
      if (result.kind !== 'document') throw new Error('No note');
      return result.document;
    },
    present: async (bundle) => {
      const id = randomUUID();
      await page.evaluate(
        `window.generatedTaskDelivery.dispatch(${JSON.stringify({ type: 'agent-task', id, bundle, deadline: Date.now() + 24000 })})`,
      );
      const ack = await until(
        () =>
          page.evaluate<{ id: string; error?: string } | null>('window.generatedTaskDelivery.ack'),
        (value) => value?.id === id,
        'Durable live task acknowledgement',
      );
      assert.equal(ack?.error, undefined);
    },
  });
  const setup = await tasks.prepare(
    {
      name: 'Generated live task',
      repo,
      path: path.join(root, 'Feature'),
      branch: 'feature/live',
      workspace: 'target',
      existing: false,
    },
    {
      signal: new AbortController().signal,
      authorize,
      require: async () => {},
      workspaceState: async () => catalog,
    },
  );
  assert.equal((await tasks.execute(setup, () => {})).stage, 'ready');
  const saved = JSON.parse(
    await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
  ) as SavedState;
  assert.equal(saved.activeWorkspace, 'target');
  assert.equal(saved.workspaces[1]?.taskAreas?.[0]?.members.length, 4);
  assert.deepEqual(saved.workspaces[1]?.panes.map((pane) => pane.type).sort(), [
    'folder',
    'git-changes',
    'note',
    'task',
    'terminal',
  ]);
  assert.equal(
    await readFile(path.join(root, 'Feature/Hello.txt'), 'utf8'),
    'Generated live task.\n',
  );
  checks.push(
    'Real safe worktree writer delivers a typed task to the live canvas, switches workspace, mounts all tools and persists before acknowledgement',
  );
  const actions = new NativeInteractions({ evaluate: page.evaluate, command: page.command, until });
  await until(
    () => page.evaluate<boolean>('!document.querySelector("[data-plurid-motion]")'),
    Boolean,
    'Task camera settled',
  );
  await page.command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await actions.palette('Command line…');
  await actions.text(
    'input[aria-label="Command line"]',
    `task-new "Review the next change" --repo "${repo}" --branch feature/next --path "${path.join(root, 'Next')}" --workspace target`,
  );
  await until(
    () =>
      page.evaluate<{ row: string; input: string; active: string }>(
        '({row:document.querySelector(".command-result[aria-selected=true]")?.textContent || "",input:document.querySelector(\'[aria-label="Command line"]\')?.value || "",active:document.activeElement?.outerHTML.slice(0,400) || ""})',
      ),
    (value) => value.row.includes('task-new'),
    'Task command rendered',
  );
  await actions.key('Enter', 'Enter');
  await until(
    () =>
      page.evaluate<{ form: boolean; body: string }>(
        '({form:!!document.querySelector(".task-request-dialog"),body:document.body.innerText.slice(-2200)})',
      ),
    (value) => value.form,
    'Typed task form',
  );
  await actions.field('Task branch', 'feature/edited');
  const capture = async (target: typeof page, name: string, width: number, height: number) => {
    await target.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await target.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const image = await target.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    const file = path.join(captureRoot, name + '.png');
    await writeFile(file, Buffer.from(image.data, 'base64'), { flag: 'wx' });
    captures.push(file);
  };
  for (const [label, width, height] of [
    ['desktop', 1000, 760],
    ['minimum', 760, 540],
  ] as const) {
    await page.evaluate('document.querySelector(".task-request-fields").scrollTop=0');
    await capture(page, 'task-form-' + label, width, height);
    await page.evaluate('document.querySelector(".task-request-fields").scrollTop=100000');
    await capture(page, 'task-form-fields-' + label, width, height);
    assert.equal(
      await page.evaluate<boolean>(
        '(()=>{const el=document.querySelector(".task-request-dialog footer");const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0&&document.documentElement.scrollWidth<=innerWidth})()',
      ),
      true,
    );
  }
  await actions.button('Cancel', 'document.querySelector(".task-request-dialog")');
  checks.push(
    'Typed task command opens editable parameters; scrolling retains reachable actions at desktop and minimum size; cancel makes no second worktree',
  );
  await page.evaluate('window.viewer.openSettings("settings.speech")');
  const preferences = await app.connect(true);
  await until(
    () => preferences.evaluate<boolean>('!!document.querySelector(".speech-preferences")'),
    Boolean,
    'Speech settings',
  );
  await preferences.evaluate(
    `window.viewer.speech({kind:'provider-save',provider:{id:${JSON.stringify(providerID)},kind:'compatible',name:'Generated loopback speech',endpoint:${JSON.stringify(endpoint)},model:'generated-speech'}})`,
  );
  await preferences.evaluate(
    `window.viewer.speech({kind:'provider-key',id:${JSON.stringify(providerID)},key:${JSON.stringify(secret)}})`,
  );
  await preferences.evaluate(
    `window.viewer.speech({kind:'preferences',preferences:{backend:'hosted',providerID:${JSON.stringify(providerID)},language:'en',microphone:''}})`,
  );
  const settingsActions = new NativeInteractions({
    evaluate: preferences.evaluate,
    command: preferences.command,
    until,
  });
  for (const current of ['available', 'missing', 'auth'] as const) {
    mode = current;
    await settingsActions.button('Check connection and model');
    await until(
      () => preferences.evaluate<SpeechStatus>('window.viewer.speech({kind:"status"})'),
      (status) =>
        status.hosted?.providers[0]?.check?.outcome ===
        (current === 'available'
          ? 'available'
          : current === 'missing'
            ? 'model-unavailable'
            : 'auth-error'),
      'Metadata check ' + current,
    );
    const status = await preferences.evaluate<SpeechStatus>(
      'window.viewer.speech({kind:"status"})',
    );
    assert.equal(status.hosted?.providers[0]?.allowed, false);
    assert.ok(!JSON.stringify(status).includes(secret));
    if (current !== 'missing')
      for (const [label, width, height] of [
        ['desktop', 1000, 760],
        ['minimum', 760, 540],
      ] as const) {
        await preferences.evaluate(
          '[...document.querySelectorAll(".speech-hosted h3")].find(el=>el.textContent==="Connection and model").scrollIntoView({block:"start"})',
        );
        await capture(preferences, 'speech-check-' + current + '-' + label, width, height);
        assert.equal(
          await preferences.evaluate<boolean>('document.documentElement.scrollWidth<=innerWidth'),
          true,
        );
      }
  }
  assert.equal(requests, 3);
  checks.push(
    'Packaged Settings checks an OS-encrypted fixture key through metadata GETs, distinguishes unavailable models and authentication errors, never grants audio access or exposes the key',
  );
  await app.close(page);
  connection = undefined;
  const restored = await ownedApp(binary, profile),
    resumed = await restored.connect();
  try {
    await until(
      () => resumed.evaluate<string>('document.body.textContent || ""'),
      (text) => text.includes('Generated live task'),
      'Live task restored',
    );
    const status = await resumed.evaluate<SpeechStatus>('window.viewer.speech({kind:"status"})');
    assert.equal(status.hosted?.providers[0]?.check, undefined);
    assert.equal(status.hosted?.providers[0]?.allowed, false);
    assert.equal(requests, 3);
    checks.push(
      'Restart restores task tools and speech choice without recording, repeating checks or replaying task creation',
    );
  } finally {
    await restored.close(resumed);
  }
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ checks, captures }, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify({ passed: true, root, checks, captures }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), checks, captures }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  tasks?.close();
  await app.close(connection);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
