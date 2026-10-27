/** Real branch task, hunk staging, typed workflow and reported-session navigation.
 * All fixtures remain. Note Trash is inspected and cancelled, never approved. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { CustomAction } from '../../src/domain/automation/actions';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { AgentSessions } from '../../src/desktop/agents/sessions';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await realpath(await temporaryRoot('viewer-native-task-workflows-'));
const profile = path.join(root, 'Profile');
const repository = path.join(root, 'Main checkout');
const checkout = path.join(root, 'Task checkout');
const templates = path.join(root, 'Templates');
await Promise.all([profile, repository, templates].map((directory) => mkdir(directory)));
const execute = promisify(execFile);
const git = async (directory: string, ...args: string[]) =>
  (
    await execute(
      '/usr/bin/git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgSign=false',
        '-C',
        directory,
        ...args,
      ],
      {
        env: {
          PATH: '/usr/bin:/bin',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_AUTHOR_NAME: 'Viewer fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Viewer fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      },
    )
  ).stdout;
await git(repository, 'init', '--initial-branch=main', '--template=' + templates);
const original = Array.from({ length: 30 }, (_, index) => 'line ' + (index + 1)).join('\n') + '\n';
await writeFile(path.join(repository, 'source.txt'), original, { flag: 'wx' });
await git(repository, 'add', '--', 'source.txt');
await git(repository, 'commit', '--no-verify', '--no-gpg-sign', '-m', 'Generated baseline');
const settings = defaultSettings(repository),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.git.enabled = true;
ui.space.opening = 'dock';
ui.sidebar.inNewPlanes = false;
const processAction = (id: string, script: string): CustomAction => ({
  id: id.toLowerCase().replaceAll(' ', '-'),
  name: id,
  aliases: [],
  icon: 'command',
  shortcut: '',
  order: 0,
  pinned: false,
  folder: ['Development', 'Checks'],
  when: { target: 'any', extensions: [], min: 0, max: 100 },
  executor: { kind: 'shell', executable: '/bin/sh', script, perItem: false },
});
const testScript = [
  'set -eu',
  'test "$(sed -n \'2p\' source.txt)" = "first edit"',
  'test "$(sed -n \'27p\' source.txt)" = "second edit"',
  'test "$(wc -l < source.txt)" -eq 30',
  'printf "%s\\n" "$VIEWER_INPUT_LABEL" > test-result.txt',
  'printf "test\\n" >> order.txt',
].join('\n');
// Prove this is a real check of the edits before using it in the app's workflow.
await assert.rejects(execute('/bin/sh', ['-c', testScript], { cwd: repository }), { code: 1 });
settings.customActions = [
  processAction('Generated test', testScript),
  processAction(
    'Generated build',
    [
      'set -eu',
      'test "$(cat order.txt)" = "test"',
      'test -s test-result.txt',
      'printf "build\\n" >> order.txt',
    ].join('\n'),
  ),
];
settings.customActions[0]!.inputs = [
  { name: 'label', label: 'Run label', kind: 'text', required: true },
];
settings.customActions.push({
  ...processAction('Generated workflow', ''),
  executor: {
    kind: 'workflow',
    steps: [
      { kind: 'action', actionID: settings.customActions[0]!.id },
      { kind: 'action', actionID: settings.customActions[1]!.id },
    ],
  },
});
// Only these exact fixture checks are preconfirmed in this owned QA profile.
await writeFile(
  path.join(profile, 'confirmed-actions-v1.json'),
  JSON.stringify(
    settings.customActions
      .slice(0, 2)
      .map((action) => createHash('sha256').update(JSON.stringify(action.executor)).digest('hex')),
  ),
  { flag: 'wx' },
);
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'workflow',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'workflow',
      name: 'Task workflow acceptance',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: repository,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [repository],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const app = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } });
const captures: string[] = [];
const checks: string[] = [];
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;

async function verifyRestoredTask(
  binary: string,
  taskID: string,
  sessionID: string,
  workingText: string,
): Promise<void> {
  const resumed = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } });
  let connection: Awaited<ReturnType<typeof resumed.connect>> | undefined;
  try {
    connection = await resumed.connect();
    const { evaluate, command } = connection;
    const actions = new NativeInteractions({ evaluate, command, until });
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1560,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const state = JSON.parse(
      await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8'),
    ) as SavedState;
    const task = state.workspaces[0]?.taskAreas?.find((task) => task.id === taskID);
    assert.ok(task);
    assert.equal(task.checkout.path, checkout);
    assert.equal(task.members.length, 5);
    assert.ok(
      task.members.some(
        (member) =>
          member.reference.kind === 'chat' && member.reference.externalSessionID === sessionID,
      ),
    );
    assert.equal(await readFile(path.join(checkout, 'source.txt'), 'utf8'), workingText);
    assert.equal(await git(checkout, 'show', ':source.txt'), original);
    assert.equal(await readFile(path.join(checkout, 'order.txt'), 'utf8'), 'test\nbuild\n');
    assert.equal(
      (await git(checkout, 'branch', '--show-current')).trim(),
      'feature/generated-task',
    );
    await actions.palette('Generated branch task');
    await until(
      () => evaluate<boolean>('!!document.querySelector(".task-plane")'),
      Boolean,
      'Restored task',
    );
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.task-tool-row')].find(row => row.textContent.includes('Git changes'));
      row.querySelector('button').click();
    })()`);
    await until(
      () => evaluate<boolean>('!!document.querySelector(".git-review")'),
      Boolean,
      'Restored Git tool',
    );
    await actions.click('[aria-label="Review changes"]');
    await actions.button('Unstaged', 'document.querySelector(".choice-menu")');
    await until(
      () => evaluate<number>('document.querySelectorAll(".git-review-hunk").length'),
      (count) => count === 2,
      'Restored working edits',
    );
    await actions.visible('.git-review');
    await actions.capture(path.join(root, 'restored-git-review.png'));
    await actions.palette('Generated branch task');
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.task-tool-row')].find(row => row.textContent.includes('Generated review conversation'));
      row.querySelector('button').click();
    })()`);
    await until(
      () =>
        evaluate<string>('document.querySelector(".session-reported-status")?.textContent || ""'),
      (text) => text.includes('Reported waiting'),
      'Restored reported session',
    );
    await actions.visible('.chat-plane[aria-label="Agent session"]');
    await actions.capture(path.join(root, 'restored-agent-session.png'));
    assert.equal(
      await readFile(path.join(checkout, 'order.txt'), 'utf8'),
      'test\nbuild\n',
      'Reopening tools must not replay the workflow',
    );
  } finally {
    await resumed.close(connection);
  }
}

try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1560,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const actions = new NativeInteractions({ evaluate, command, until });
  const capture = async (name: string) => {
    const file = path.join(root, name + '.png');
    await actions.capture(file);
    captures.push(file);
  };
  const saved = async () =>
    JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState;
  await until(
    () => evaluate<boolean>('!!document.querySelector(".folder-explorer")'),
    Boolean,
    'Folder',
  );
  await actions.palette('New task from branch');
  await actions.field('Branch task name', 'Generated branch task');
  await actions.field('New branch name', 'feature/generated-task');
  await actions.field('Worktree destination', checkout);
  await capture('branch-task-form');
  await actions.button('Create task', 'document.querySelector("dialog")');
  await until(
    async () => (await saved()).workspaces[0]?.taskAreas?.[0]?.members.length,
    (count) => count === 4,
    'Four task tools',
    30000,
  );
  assert.equal((await git(checkout, 'branch', '--show-current')).trim(), 'feature/generated-task');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".task-plane")'),
    Boolean,
    'Task overview',
  );
  await capture('task-tools');
  checks.push('One action creates a worktree, task and four durable tools');
  const changed = original
    .replace('line 2\n', 'first edit\n')
    .replace('line 27\n', 'second edit\n');
  await writeFile(path.join(checkout, 'source.txt'), changed);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-tool-row')].find(row => row.textContent.includes('Git changes'));
    row.querySelector('button').click();
  })()`);
  await actions.button('Refresh', 'document.querySelector(".git-review")');
  await until(
    () => evaluate<number>('document.querySelectorAll(".git-review-hunk").length'),
    (count) => count === 2,
    'Two review hunks',
  );
  await capture('hunk-review');
  await actions.button('Stage hunk 1', 'document.querySelector(".git-review")');
  await until(
    async () => git(checkout, 'show', ':source.txt'),
    (text) => text === original.replace('line 2\n', 'first edit\n'),
    'One hunk staged',
  );
  assert.equal(await readFile(path.join(checkout, 'source.txt'), 'utf8'), changed);
  await until(
    () =>
      evaluate<boolean>(
        `document.querySelector('[aria-label="Review changes"]')?.disabled === false`,
      ),
    Boolean,
    'Review ready after staging',
  );
  await evaluate(`document.querySelector('[aria-label="Review changes"]').click()`);
  await actions.button('Staged', 'document.querySelector(".choice-menu")');
  await actions.button('Unstage hunk 1', 'document.querySelector(".git-review")');
  await until(
    async () => git(checkout, 'show', ':source.txt'),
    (text) => text === original,
    'Hunk unstaged',
  );
  checks.push('Real Git stages and unstages one hunk without changing the working file');
  await actions.palette('Generated branch task');
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-tool-row')].find(row => row.querySelector('strong')?.textContent === 'Checkout');
    row.querySelector('button').click();
  })()`);
  await actions.palette('Generated workflow');
  await actions.field('Run label', 'literal $(touch marker) {directory}');
  await capture('workflow-parameters');
  await actions.button('Run', 'document.querySelector(".command-parameters")');
  await until(
    async () => readFile(path.join(checkout, 'order.txt'), 'utf8').catch(() => ''),
    (text) => text === 'test\nbuild\n',
    'Sequential workflow',
  );
  assert.equal(
    await readFile(path.join(checkout, 'test-result.txt'), 'utf8'),
    'literal $(touch marker) {directory}\n',
  );
  await assert.rejects(readFile(path.join(checkout, 'marker')), { code: 'ENOENT' });
  checks.push(
    'Fixture tests reject the baseline and pass the edits before build; typed parameters remain literal',
  );
  const sessions = new AgentSessions(profile, () => {});
  const reported = await sessions.report(
    'generated-adapter',
    'Generated local adapter',
    {
      sessionID: 'generated-session',
      directory: checkout,
      title: 'Generated review conversation',
      sequence: 1,
      status: 'waiting',
      entries: [
        {
          id: 'message-one',
          role: 'assistant',
          text: 'The change is ready to review.',
          links: [
            { kind: 'file', path: path.join(checkout, 'source.txt'), line: 2 },
            { kind: 'git-diff', path: path.join(checkout, 'source.txt') },
          ],
        },
      ],
    },
    realpath,
  );
  await actions.palette('Generated branch task');
  await actions.button('Attach conversation…', 'document.querySelector(".task-plane")');
  await actions.button('Attach', 'document.querySelector(".session-library")');
  await until(
    () => evaluate<string>('document.querySelector(".session-reported-status")?.textContent'),
    (text) => text?.includes('Reported waiting'),
    'Reported status',
  );
  const observeSession = () =>
    evaluate<{
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
      paneWidth: number;
      paneHeight: number;
      hit: boolean;
      ancestors: unknown[];
    }>(`(() => {
    const element = document.querySelector('.chat-plane[aria-label="Agent session"]');
    const rect = element.getBoundingClientRect();
    const hit = element.contains(document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2));
    const ancestors = [];
    let parent = element;
    while (parent && ancestors.length < 12) {
      const style = getComputedStyle(parent);
      ancestors.push({ class: parent.className, display: style.display, visibility: style.visibility, opacity: style.opacity, transform: style.transform });
      parent = parent.parentElement;
    }
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, paneWidth: rect.width, paneHeight: rect.height, hit, ancestors };
  })()`);
  const projected = await until(
    observeSession,
    (rect) =>
      rect.left >= 0 &&
      rect.top >= 55 &&
      rect.right <= rect.width &&
      rect.bottom <= rect.height &&
      rect.paneWidth > 300 &&
      rect.paneHeight > 200 &&
      rect.hit,
    'Session readable and unobstructed',
    20000,
  );
  await writeFile(path.join(root, 'session-projection.json'), JSON.stringify(projected, null, 2), {
    flag: 'wx',
  });
  await capture('agent-session');
  await actions.button('Open current file: source.txt:2');
  await until(
    async () =>
      (await saved()).workspaces[0]?.panes.find(
        (pane) => pane.type === 'preview' && pane.path === path.join(checkout, 'source.txt'),
      ),
    Boolean,
    'Linked source',
  );
  await actions.palette('Generated branch task');
  await until(
    async () =>
      (await saved()).workspaces[0]?.taskAreas?.[0]?.members.some(
        (member) =>
          member.reference.kind === 'chat' && member.reference.externalSessionID === reported.id,
      ),
    Boolean,
    'Durable session link',
  );
  await actions.palette('Notes…');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".notes-library-row")'),
    Boolean,
    'Saved note',
  );
  await evaluate(
    `document.querySelector('.notes-library-row button[aria-label^="Move "][aria-label$=" to Trash"]').click()`,
  );
  await until(
    () => evaluate<boolean>(`!!document.querySelector('dialog[aria-label="Move to Trash?"]')`),
    Boolean,
    'Note Trash presenter',
  );
  await capture('note-trash-cancel');
  await actions.button('Cancel', `document.querySelector('dialog[aria-label="Move to Trash?"]')`);
  checks.push(
    'Agent session attaches to task, shows reported status and opens linked source; note Trash presenter cancelled',
  );
  const taskID = (await saved()).workspaces[0]!.taskAreas![0]!.id;
  await app.close(connection);
  connection = undefined;
  await verifyRestoredTask(binary, taskID, reported.id, changed);
  checks.push(
    'Cold restart keeps task membership, worktree edits, Git staging, receipts and reported conversation without replaying commands',
  );
  assert.equal(await readFile(path.join(repository, 'source.txt'), 'utf8'), original);
  assert.equal(await readFile(path.join(checkout, 'order.txt'), 'utf8'), 'test\nbuild\n');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ checks, captures, profile, checkout, reported: reported.id }, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ ok: true, root, checks, captures }, null, 2));
} catch (error) {
  console.error('Workflow acceptance failed:', error);
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), captures, checks }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  await app.close(connection);
}
