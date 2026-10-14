/** Packaged reviewed rename/checkpoint path and an adversarial worker deadline. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SavedState, OperationJob } from '../src/domain/contracts';
import type { ActionPlan } from '../src/domain/services';
import type { CheckpointRecord } from '../src/domain/change-plan';
import { ownedApp, until } from './owned-app';
const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-native-review-'));
const profile = root + '/Profile',
  source = root + '/Source',
  restored = root + '/Restored';
await Promise.all([profile, source, restored].map((file) => mkdir(file)));
const files = [source + '/A.txt', source + '/B.txt'];
await writeFile(files[0], 'Original A.');
await writeFile(files[1], 'Original B.');
const state: SavedState = {
  version: 4,
  favorites: [],
  recents: [],
  look: 'dark',
  activeWorkspace: 'work',
  workspaces: [
    {
      id: 'work',
      name: 'Change review',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: source,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [source],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(profile + '/viewer-state-v1.json', JSON.stringify(state));
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const checks: string[] = [];
const output = path.resolve('out/change-review-acceptance');
await mkdir(output, { recursive: true });
try {
  connection = await viewer.connect();
  const evaluate = connection.evaluate;
  await until(
    () => evaluate<number>(`document.querySelectorAll('.folder-explorer').length`),
    Boolean,
    'source renderer',
  );
  const context = {
    workspaceID: 'work',
    rootID: 'folder',
    paneID: 'folder',
    actor: 'user',
    sources: files,
  };
  const id = await evaluate<string>(
    `window.viewer.actionStart(${JSON.stringify({
      recipeID: 'batch-rename',
      context,
      options: {
        prefix: 'Cut-',
        case: 'lower',
        padding: 2,
        template: '{number}_{name}{extension}',
      },
    })})`,
  );
  const plan = await until(
    () => evaluate<ActionPlan>(`window.viewer.actionGet(${JSON.stringify(id)})`),
    (plan) => plan.status !== 'planning',
    'prepared naming proposal',
  );
  assert.equal(plan.status, 'review');
  assert.equal(plan.version, 1);
  assert.equal(await readFile(files[0], 'utf8'), 'Original A.');
  await evaluate(`window.dispatchEvent(new Event('viewer:tasks'))`);
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.task-list button')`),
    Boolean,
    'rendered task list',
  );
  await evaluate(`document.querySelector('.task-list button').click()`);
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.checkpoint-choice input')`),
    Boolean,
    'review checkpoint control',
  );
  await evaluate(`document.querySelector('.checkpoint-choice input').click()`);
  await until(
    () => evaluate<string>(`document.querySelector('.checkpoint-choice')?.textContent || ''`),
    (text) => text.includes('available'),
    'storage preflight',
  );
  const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(output + '/review.png', Buffer.from(shot.data, 'base64'));
  const clicked =
    await evaluate<boolean>(`(() => { const b=[...document.querySelectorAll('.task-dialog button')]
    .find(b => /^Apply 2 changes$/.test(b.textContent.trim())); if (!b || b.disabled) return false; b.click(); return true; })()`);
  assert.equal(clicked, true);
  const completed = await until(
    () => evaluate<ActionPlan>(`window.viewer.actionGet(${JSON.stringify(id)})`),
    (plan) => ['completed', 'partial', 'failed'].includes(plan.status),
    'reviewed apply',
  );
  assert.equal(completed.status, 'completed');
  assert.ok(completed.checkpointID);
  assert.equal(await readFile(source + '/01_Cut-a.txt', 'utf8'), 'Original A.');
  assert.equal(await readFile(source + '/02_Cut-b.txt', 'utf8'), 'Original B.');
  checks.push(
    'Rendered review estimates an opt-in checkpoint before applying the revisioned rename.',
  );
  const list = await evaluate<{ records: CheckpointRecord[]; budgetBytes: number }>(
    `window.viewer.checkpoints({kind:'list'})`,
  );
  assert.equal(list.budgetBytes, 5 * 1024 ** 3);
  assert.equal(list.records.length, 1);
  const restore = await evaluate<{ jobs: string[] }>(
    `window.viewer.checkpoints(${JSON.stringify({
      kind: 'restore',
      id: completed.checkpointID,
      destination: restored,
    })})`,
  );
  await until(
    () => evaluate<OperationJob[]>(`window.viewer.jobs()`),
    (jobs) =>
      restore.jobs.every((id) => jobs.some((job) => job.id === id && job.status === 'completed')),
    'guarded restore jobs',
  );
  assert.equal(await readFile(restored + '/A.txt', 'utf8'), 'Original A.');
  assert.equal(await readFile(restored + '/B.txt', 'utf8'), 'Original B.');
  checks.push('Retained snapshots restore original contents through ordinary journaled copy jobs.');
  const slow = source + '/' + 'a'.repeat(220) + '!.txt';
  await writeFile(slow, 'Worker deadline fixture.');
  const started = Date.now();
  const deadlineID = await evaluate<string>(
    `window.viewer.actionStart(${JSON.stringify({
      recipeID: 'batch-rename',
      context: { ...context, sources: [slow] },
      options: { regex: true, find: '^(a+)+$', replace: 'x' },
    })})`,
  );
  const deadline = await until(
    () => evaluate<ActionPlan>(`window.viewer.actionGet(${JSON.stringify(deadlineID)})`),
    (plan) => plan.status !== 'planning',
    'bounded adversarial regex',
  );
  assert.equal(deadline.status, 'failed');
  assert.match(deadline.error || '', /timed out/);
  assert.ok(Date.now() - started < 10000);
  assert.equal(await readFile(slow, 'utf8'), 'Worker deadline fixture.');
  assert.equal(
    (
      (await evaluate(`window.viewer.stat(${JSON.stringify(source + '/01_Cut-a.txt')})`)) as {
        name: string;
      }
    ).name,
    '01_Cut-a.txt',
  );
  checks.push(
    'A pathological regex is terminated in its dedicated worker; app file services and sources stay usable.',
  );
  console.log(checks.map((check) => 'PASS ' + check).join('\n'));
  await writeFile(
    output + '/result.json',
    JSON.stringify(
      {
        checks,
        scope: 'Generated files and hidden packaged app; native pickers/signing are separate.',
      },
      null,
      2,
    ),
  );
} finally {
  await viewer.close(connection);
  await rm(root, { recursive: true, force: true });
}
