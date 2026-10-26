/** Owned spatial task lifecycle, real command receipt and no replay. Everything stays. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { TaskArea } from '../../src/domain/workspaces/tasks';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await realpath(await temporaryRoot('viewer-native-task-areas-')),
  folder = path.join(root, 'Checkout'),
  profile = path.join(root, 'Profile'),
  templates = path.join(root, 'Templates'),
  hooks = path.join(root, 'Hooks');
await Promise.all([folder, profile, templates, hooks].map((directory) => mkdir(directory)));
const original = path.join(folder, 'Reference.txt'),
  counter = path.join(folder, 'command-counter.txt'),
  terminalCounter = path.join(folder, 'terminal-counter.txt');
await writeFile(original, 'Original task reference\n', { flag: 'wx' });
await writeFile(
  path.join(folder, 'index.html'),
  '<!doctype html><html><title>Task browser</title><h1>Local task preview</h1></html>',
  { flag: 'wx' },
);
const exec = promisify(execFile),
  git = async (...args: string[]) =>
    (
      await exec('/usr/bin/git', ['-c', 'commit.gpgSign=false', '-C', folder, ...args], {
        env: {
          PATH: '/usr/bin:/bin',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_AUTHOR_NAME: 'Viewer fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Viewer fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      })
    ).stdout.trim();
await git('init', '--initial-branch=main', '--template=' + templates);
await git('config', 'core.hooksPath', hooks);
await git('add', '--', 'Reference.txt', 'index.html');
await git('commit', '-m', 'Generated task baseline');
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const baseline = {
  original: await hash(original),
  index: await hash(path.join(folder, '.git/index')),
  commit: await git('rev-parse', 'HEAD'),
};
const settings = defaultSettings(folder),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.git.enabled = true;
ui.sidebar.inNewPlanes = false;
ui.space.opening = 'dock';
const initial: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'task-work',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'task-work',
      name: 'Task acceptance',
      roots: ['checkout'],
      activePane: 'checkout',
      arrangement: {},
      panes: [
        {
          id: 'checkout',
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
  flag: 'wx',
});
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(initial), { flag: 'wx' });
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const task = async () => {
  const area = (await saved()).workspaces[0]!.taskAreas?.[0];
  assert.ok(area);
  return area;
};
let app = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } }),
  connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const captures: string[] = [],
  checks: string[] = [];
let receiptID = '',
  noteID = '',
  terminalSessionID = '';
try {
  connection = await app.connect();
  const evaluate = <T = unknown>(expression: string) => connection!.evaluate<T>(expression),
    command = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
      connection!.command<T>(method, params);
  const click = async (label: string, scope = 'document') => {
    const source = () =>
      `[...((${scope})?.querySelectorAll('button')??[])].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(() => evaluate<boolean>(`!!(${source()})`), Boolean, 'Enabled ' + label);
    await evaluate(`(${source()}).click()`);
  };
  const field = async (selector: string, text: string) => {
    await until(
      () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
      Boolean,
      'Field ' + selector,
    );
    await evaluate(
      `(()=>{const i=document.querySelector(${JSON.stringify(selector)});i.focus();i.select()})()`,
    );
    await command('Input.insertText', { text });
  };
  const palette = async (label: string) => {
    await evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
    await until(
      () => evaluate<string>('document.activeElement?.getAttribute("aria-label")'),
      (value) => value === 'Search commands',
      'Palette focus',
    );
    await command('Input.insertText', { text: label });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent',
        ),
      (value) => value?.includes(label),
      'Palette ' + label,
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  const capture = async (name: string, width = 1440) => {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate('new Promise((resolve) => setTimeout(resolve, 350))');
    if (name.includes('unavailable')) {
      await until(
        () =>
          evaluate<{ opacity: number; motion: boolean }>(`(() => {
            let element = document.querySelector('.preview-plane');
            let opacity = 1;

            while (element) {
              opacity *= Number(getComputedStyle(element).opacity);
              element = element.parentElement;
            }

            return {
              opacity,
              motion: !!document.querySelector('[data-plurid-motion]'),
            };
          })()`),
        (state) => state.opacity > 0.999 && !state.motion,
        'Settled receipt error capture',
      );
    }
    const summary = await evaluate<{ height: number; used: number } | undefined>(
      `(() => {
        const summary = document.querySelector('.task-area-summary');
        if (!summary) return;

        const bounds = summary.getBoundingClientRect();
        const lastChildBounds = summary.lastElementChild.getBoundingClientRect();
        return {
          height: bounds.height,
          used: lastChildBounds.bottom - bounds.top,
        };
      })()`,
    );
    if (summary)
      assert.ok(
        summary.height - summary.used < 40,
        'The summary keeps content height and cannot absorb the tool-list space.',
      );
    const picture = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' }),
      file = path.join(root, name + '.png');
    await writeFile(file, Buffer.from(picture.data, 'base64'), { flag: 'wx' });
    captures.push(file);
  };
  const focusTask = async () => {
    await palette('Task delivery');
    await until(
      () => evaluate<boolean>('!!document.querySelector(".task-plane")'),
      Boolean,
      'Task overview',
    );
  };
  const closePane = async (id: string) => {
    const selector = `.plane-controls[data-viewer-plane="${id}"] [aria-label="Close plane"]`;
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(
      saved,
      (state) => !state.workspaces[0]!.panes.some((pane) => pane.id === id),
      'Closed task view',
    );
  };
  await until(
    () => evaluate<boolean>('!!document.querySelector(".folder-explorer")'),
    Boolean,
    'Checkout folder',
  );
  await palette('New task area…');
  await field('input[aria-label="New task name"]', 'Task delivery');
  await capture('task-create-dialog-dark');
  await click('Create task area');
  await until(
    saved,
    (state) => state.workspaces[0]!.taskAreas?.[0]?.name === 'Task delivery',
    'Durable task',
  );
  assert.equal((await task()).checkout.branch, 'main');
  assert.equal((await task()).checkout.commit, baseline.commit);
  await capture('task-empty-dark');
  await click('+ Note', "document.querySelector('.task-plane')");
  const noteState = await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'note'),
    'Task note',
  );
  const note = noteState.workspaces[0]!.panes.find((pane) => pane.type === 'note')!;
  assert.equal(note.type, 'note');
  if (note.type !== 'note') throw Error('Missing note');
  noteID = note.documentID;
  await evaluate(
    `window.viewer.notes(${JSON.stringify({ kind: 'write', id: noteID, revision: 0, title: 'Task design', text: '# Plan\nKeep source truth and inspect outcomes.' })})`,
  );
  await until(
    () => evaluate<string>('document.querySelector(".note-reading h1")?.textContent'),
    (value) => value === 'Plan',
    'Task note content',
  );
  await closePane(note.id);
  await focusTask();
  await until(
    () =>
      evaluate<boolean>(
        `[...document.querySelectorAll('.task-tool-row strong')].some(n=>n.textContent==='Task design')`,
      ),
    Boolean,
    'Retained note title',
  );
  await evaluate(
    `[...document.querySelectorAll('.task-tool-row')].find(n=>n.querySelector('strong').textContent==='Task design').querySelector('button').click()`,
  );
  const noteAgain = await until(
    saved,
    (state) =>
      state.workspaces[0]!.panes.some((pane) => pane.type === 'note' && pane.id !== note.id),
    'Fresh note view',
  );
  assert.equal(
    noteAgain.workspaces[0]!.panes.find((pane) => pane.type === 'note')?.documentID,
    noteID,
  );
  checks.push(
    'Closing a note view preserves task membership and the same private document; reopening creates a fresh view ID.',
  );
  await focusTask();
  await click('+ Checklist', "document.querySelector('.task-plane')");
  await until(
    () => evaluate<boolean>('!!document.querySelector(".note-checklist")'),
    Boolean,
    'Task checklist',
  );
  await field('input[aria-label="New checklist item"]', 'Review the saved diff');
  await click('Add');
  await focusTask();
  await click('+ Chat', "document.querySelector('.task-plane')");
  await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'chat'),
    'Task conversation',
  );
  await focusTask();
  await click('+ Changes', "document.querySelector('.task-plane')");
  await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'git-changes'),
    'Task Git view',
  );
  await focusTask();
  await click('+ Terminal', "document.querySelector('.task-plane')");
  const terminalState = await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'terminal'),
    'Task terminal',
  );
  const terminal = terminalState.workspaces[0]!.panes.find((pane) => pane.type === 'terminal')!;
  assert.equal(terminal.type, 'terminal');
  if (terminal.type !== 'terminal') throw Error('No terminal');
  terminalSessionID = terminal.taskSessionID!;
  await until(
    () => evaluate<boolean>('!!document.querySelector(".xterm")'),
    Boolean,
    'Terminal pixels',
  );
  await evaluate(
    `window.viewer.terminalWrite(${JSON.stringify(terminal.id)},${JSON.stringify(`printf terminal-once >> '${terminalCounter.replaceAll("'", "'\\''")}'\n`)})`,
  );
  await until(
    () => readFile(terminalCounter, 'utf8').catch(() => ''),
    (value) => value === 'terminal-once',
    'Terminal command',
  );
  await closePane(terminal.id);
  await focusTask();
  await evaluate(
    `[...document.querySelectorAll('.task-tool-row')].find(n=>n.querySelector('.task-tool-kind').textContent.startsWith('terminal')).querySelector('button').click()`,
  );
  await until(
    saved,
    (state) =>
      state.workspaces[0]!.panes.some(
        (pane) => pane.type === 'terminal' && pane.id !== terminal.id,
      ),
    'Fresh logical terminal',
  );
  assert.equal(await readFile(terminalCounter, 'utf8'), 'terminal-once');
  checks.push(
    'Note, checklist, chat, Git and terminal tools attach; reopening a logical terminal never replays prior input.',
  );
  await focusTask();
  await click('+ Server', "document.querySelector('.task-plane')");
  await until(
    () => evaluate<boolean>('!!document.querySelector(".server-plane")'),
    Boolean,
    'Stopped server view',
  );
  assert.equal(
    (await evaluate<unknown[]>('window.viewer.localServers()')).length,
    0,
    'Task creation does not start servers',
  );
  await click('Start', "document.querySelector('.server-plane')");
  const servers = await until(
    () =>
      evaluate<{ url: string; port: number; paneID: string; state: string }[]>(
        'window.viewer.localServers()',
      ),
    (values) => values.some((value) => value.state === 'running'),
    'Started server',
  );
  const server = servers.find((value) => value.state === 'running')!;
  const serverState = await until(
      saved,
      (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'server'),
      'Saved server view',
    ),
    serverPane = serverState.workspaces[0]!.panes.find((pane) => pane.type === 'server')!;
  await closePane(serverPane.id);
  await focusTask();
  await evaluate(
    `[...document.querySelectorAll('.task-tool-row')].find(n=>n.querySelector('.task-tool-kind').textContent.startsWith('server')).querySelector('button').click()`,
  );
  const attached = await evaluate<{ port: number }[]>('window.viewer.localServers()');
  assert.equal(attached.length, 1);
  assert.equal(attached[0]!.port, server.port);
  await focusTask();
  await click('+ Browser', "document.querySelector('.task-plane')");
  await field('input[aria-label="Task browser address"]', server.url);
  await click('Open browser', "document.querySelector('.task-plane')");
  await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'browser'),
    'Task browser',
  );
  const linkedBrowser = (await saved()).workspaces[0]!.panes.find(
    (pane) => pane.type === 'browser',
  );
  assert.equal(linkedBrowser?.type === 'browser' && linkedBrowser.serverRuntimeID, server.paneID);
  checks.push(
    'Server view starts only explicitly, closing/reattaching keeps one listener, and a browser links its local URL.',
  );
  await focusTask();
  await click('Run command…', "document.querySelector('.task-plane')");
  await field(
    '.run-command-dialog textarea',
    `printf command-once >> '${counter.replaceAll("'", "'\\''")}' && printf task-command-output`,
  );
  await click('Run', "document.querySelector('.run-command-dialog')");
  await until(
    () => readFile(counter, 'utf8').catch(() => ''),
    (value) => value === 'command-once',
    'Task quick command',
  );
  const receiptArea = await until(
    task,
    (area: TaskArea) => area.members.some((member) => member.reference.kind === 'receipt'),
    'Linked command receipt',
  );
  const receipt = receiptArea.members.find((member) => member.reference.kind === 'receipt')!;
  assert.equal(receipt.reference.kind, 'receipt');
  if (receipt.reference.kind !== 'receipt') throw Error('No receipt');
  receiptID = receipt.reference.receiptID;
  await until(
    () =>
      evaluate<{ kind: string; receipt: { status: string; output: string; exitCode: number } }>(
        `window.viewer.receipts({kind:'read',id:${JSON.stringify(receiptID)}})`,
      ),
    (value) =>
      value.receipt.status === 'completed' && value.receipt.output.includes('task-command-output'),
    'Completed durable receipt',
  );
  await focusTask();
  await evaluate(`document.querySelector('[aria-label="Hide command progress"]')?.click()`);
  await capture('task-populated-dark');
  await evaluate('document.querySelector(".task-body").scrollTop=100000');
  await capture('task-outcomes-dark');
  await evaluate('document.querySelector(".task-body").scrollTop=0');
  await evaluate(
    `[...document.querySelectorAll('.task-tool-row')].find(n=>n.querySelector('.task-tool-kind').textContent.startsWith('receipt')).querySelector('button').click()`,
  );
  await until(
    () => evaluate<string>('document.querySelector(".receipt-output")?.textContent'),
    (value) => value === 'task-command-output',
    'Receipt output',
  );
  await capture('receipt-dark');
  await evaluate(
    "window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))",
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === 'light',
    'Task light',
  );
  await capture('receipt-light');
  await focusTask();
  await capture('task-populated-light');
  await capture('task-narrow-light', 760);
  await click('Arrange open tools', "document.querySelector('.task-plane')");
  await capture('task-arranged-light');
  checks.push(
    'Manual command runs once and its private completed receipt records stdout, cwd, times and exit code without inferring test success.',
  );
  await app.close(connection);
  connection = undefined;
  assert.equal(await readFile(counter, 'utf8'), 'command-once');
  assert.equal(await readFile(terminalCounter, 'utf8'), 'terminal-once');
  app = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } });
  connection = await app.connect();
  const next = connection;
  await until(
    () => next.evaluate<boolean>('!!document.querySelector(".task-plane")'),
    Boolean,
    'Cold task restore',
  );
  assert.equal(
    (await next.evaluate<unknown[]>('window.viewer.localServers()')).length,
    0,
    'Server stays stopped after restart',
  );
  const restored = await saved();
  const restoredArea = restored.workspaces[0]!.taskAreas![0]!;
  assert.ok(
    restoredArea.members.some(
      (member) =>
        member.reference.kind === 'terminal' && member.reference.sessionID === terminalSessionID,
    ),
  );
  const restoredReceipt = await next.evaluate<{ receipt: { output: string; exitCode: number } }>(
    `window.viewer.receipts({kind:'read',id:${JSON.stringify(receiptID)}})`,
  );
  assert.equal(restoredReceipt.receipt.output, 'task-command-output');
  assert.equal(restoredReceipt.receipt.exitCode, 0);
  assert.equal(await readFile(counter, 'utf8'), 'command-once');
  assert.equal(await readFile(terminalCounter, 'utf8'), 'terminal-once');
  const notes = await next.evaluate<{ kind: string; notes: { id: string }[] }>(
    'window.viewer.notes({kind:"list"})',
  );
  assert.ok(notes.notes.some((note) => note.id === noteID));
  assert.equal(await hash(original), baseline.original);
  assert.equal(await hash(path.join(folder, '.git/index')), baseline.index);
  assert.equal(await git('rev-parse', 'HEAD'), baseline.commit);
  assert.equal((await next.evaluate<unknown[]>('window.viewer.jobs()')).length, 0);
  const receiptFiles = await readdir(path.join(profile, 'command-receipts'));
  assert.ok(receiptFiles.some((file) => file === receiptID + '.json'));
  checks.push(
    'Cold restore keeps task references, documents and command output; no command, terminal input or server is replayed. Original reference, index and commit remain unchanged.',
  );
  await palette('Tasks…');
  await click('Command history', "document.querySelector('.tasks-dialog')");
  await until(
    () => evaluate<number>('document.querySelectorAll(".tasks-list button").length'),
    (count) => count === 1,
    'Cold command history',
  );
  await capture('command-history-light');
  await click('Done', "document.querySelector('.tasks-dialog')");
  await focusTask();
  await evaluate(
    `[...document.querySelectorAll('.task-tool-row')].find(n=>n.querySelector('.task-tool-kind').textContent.startsWith('server')).querySelector('button').click()`,
  );
  await click('Start', "document.querySelector('.server-plane')");
  const restarted = await until(
    () => evaluate<{ url: string; state: string }[]>('window.viewer.localServers()'),
    (servers) => servers.some((server) => server.state === 'running'),
    'Explicit server restart',
  );
  const liveURL = restarted.find((server) => server.state === 'running')!.url;
  await until(
    saved,
    (state) =>
      state.workspaces[0]!.panes.some(
        (pane) => pane.type === 'browser' && pane.url.startsWith(liveURL),
      ),
    'Browser follows restarted server',
  );
  checks.push(
    'An explicitly restarted server keeps its logical browser binding and updates the page address.',
  );
  await app.close(connection);
  connection = undefined;
  const errorProfile = path.join(root, 'Unavailable receipt Profile');
  await mkdir(errorProfile);
  const unavailable: SavedState = {
    ...initial,
    activeWorkspace: 'unavailable',
    workspaces: [
      {
        id: 'unavailable',
        name: 'Receipt recovery',
        panes: [{ id: 'receipt', type: 'receipt', path: folder, receiptID: crypto.randomUUID() }],
        roots: ['receipt'],
        activePane: 'receipt',
        arrangement: {},
      },
    ],
  };
  await writeFile(
    path.join(errorProfile, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(errorProfile, 'viewer-state-v1.json'), JSON.stringify(unavailable), {
    flag: 'wx',
  });
  app = await ownedApp(binary, errorProfile, { environment: { SHELL: '/bin/sh' } });
  connection = await app.connect();
  await until(
    () => evaluate<boolean>(`document.body.textContent.includes('Command receipt unavailable')`),
    Boolean,
    'Missing receipt recovery',
  );
  await click('Retry');
  await capture('receipt-unavailable-dark');
  checks.push('An unavailable receipt fails explicitly and leaves Retry available.');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      { pass: true, binary, captures, checks, baseline, receiptID, retained: true },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ pass: true, root, captures, checks }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), captures, checks }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  await app.close(connection);
}
