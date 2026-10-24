/** Real packaged watch service and renderer, generated files, no native picker or Store qualification claim. */
import assert from 'node:assert/strict';
import { mkdir, realpath, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ownedApp, until } from './owned-app';
import { workflowDefinitionSchema, type WorkflowRun } from '../src/domain/automation/workflows';
import type { WatchRule } from '../src/domain/automation/watch-rules';
import type { SavedState } from '../src/domain/contracts';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const root = await realpath(await temporaryRoot('viewer-native-watch-'));
const profile = path.join(root, 'Profile'),
  inbox = path.join(root, 'Inbox'),
  destination = path.join(root, 'Output');
const output = path.resolve('out/watch-rule-acceptance');
await Promise.all(
  [profile, inbox, destination, output].map((folder) => mkdir(folder, { recursive: true })),
);
await writeFile(path.join(inbox, 'Existing.txt'), 'Do not process on enable.');
const file = path.join(root, 'viewer.workflow.jsonc');
const definition = workflowDefinitionSchema.parse({
  version: 1,
  id: 'native-incoming',
  name: 'Incoming drawings',
  inputs: { output: { path: 'Output' } },
  steps: [
    { id: 'inspect', kind: 'inspect', sources: [{ kind: 'selection' }] },
    {
      id: 'copy',
      kind: 'copy',
      needs: ['inspect'],
      sources: [{ kind: 'step', id: 'inspect' }],
      destination: { kind: 'input', name: 'output' },
    },
  ],
});
await writeFile(
  file,
  '// Generated incoming-file workflow.\n' + JSON.stringify(definition, null, 2),
);
const state: SavedState = {
  version: 4,
  look: 'dark',
  favorites: [],
  recents: [],
  activeWorkspace: 'watch',
  workspaces: [
    {
      id: 'watch',
      name: 'Watch checks',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: inbox,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [inbox],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
let viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const evidence: string[] = [];
try {
  connection = await viewer.connect();
  let evaluate = connection.evaluate;
  const capture = async (name: string) => {
    const shot = await connection!.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const scope = {
    file,
    root: inbox,
    bindings: {},
    extensions: ['txt'],
    recursive: false,
    allowContent: false,
    cooldownSeconds: 30,
  };
  const rule = await evaluate<WatchRule>(
    `(async()=>{const document=await window.viewer.workflow({kind:'read',file:${JSON.stringify(file)}});return window.viewer.watchRules({kind:'approve',scope:{...${JSON.stringify(scope)},fileRevision:document.revision}})})()`,
  );
  assert.equal(rule.enabled, true);
  assert.deepEqual(await evaluate('window.viewer.workflow({kind:"list"})'), []);
  const context = {
    scope: 'folder',
    workspaceID: 'watch',
    paneID: 'folder',
    directory: inbox,
    path: inbox,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  await evaluate(
    `window.dispatchEvent(new CustomEvent('viewer:workflows',{detail:${JSON.stringify({ file, context })}}))`,
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".watch-rule-row")'),
    Boolean,
    'actual watch rule controls',
  );
  assert.equal(
    await evaluate<boolean>(
      'Array.from(document.querySelectorAll(".workflow-definition button")).find(button=>button.textContent==="Run workflow").disabled',
    ),
    true,
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".watch-rule-row button")).find(button=>button.textContent==="Pause").click()',
  );
  await until(
    () => evaluate<WatchRule[]>('window.viewer.watchRules({kind:"list"})'),
    (rules) => !rules[0].enabled,
    'actual Pause control',
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".watch-rule-row button")).find(button=>button.textContent==="Review and enable…").click()',
  );
  await until(
    () =>
      evaluate<boolean>(
        '!!document.querySelector(".watch-rule-form")?.getClientRects().length && document.querySelector(".watch-rule-form").closest("details").open',
      ),
    Boolean,
    'explicit approval form',
  );
  await evaluate('document.querySelector(".watch-rule-form").scrollIntoView({block:"center"})');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await capture('approval-dark');
  await evaluate(
    'window.viewer.settingsGet().then(snapshot=>window.viewer.settingsPatch([{path:"settings.appearance",value:"light"}],snapshot.revision))',
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (look) => look === 'light',
    'light workflow scope',
  );
  await capture('approval-light');
  await evaluate('document.querySelector(".watch-rule-form").requestSubmit()');
  await until(
    () => evaluate<WatchRule[]>('window.viewer.watchRules({kind:"list"})'),
    (rules) => rules[0].enabled,
    'actual Enable watch rule control',
  );
  evidence.push(
    'Actual renderer Pause, Review and Enable controls preserve the scope, require explicit reapproval, and leave existing files unprocessed. Initial generated scope was seeded through the real private API; native folder picking was not tested.',
  );
  const incoming = path.join(inbox, 'Generated.txt');
  await writeFile(incoming, 'Real directory-watch event.');
  const runs = await until(
    () => evaluate<WorkflowRun[]>('window.viewer.workflow({kind:"list"})'),
    (runs) => runs[0]?.status === 'waiting-review',
    'real FSEvents-triggered workflow',
  );
  assert.deepEqual(runs[0].context.sources, [incoming]);
  assert.deepEqual(await readdir(destination), []);
  const ruleAfter = await until(
    () => evaluate<WatchRule[]>('window.viewer.watchRules({kind:"list"})'),
    (rules) => rules[0].runStatus === 'waiting-review',
    'review notification',
  );
  await evaluate(
    `window.dispatchEvent(new CustomEvent('viewer:workflows',{detail:{runID:${JSON.stringify(runs[0].id)}}}))`,
  );
  await until(
    () => evaluate<string>('document.querySelector(".workflow-run")?.textContent||""'),
    (text) => text.includes('Review copy'),
    'watched run review',
  );
  await capture('waiting-review-light');
  evidence.push(
    'A real macOS directory event processes only the new selection, prepares a normal copy review, publishes review status, and leaves the destination untouched.',
  );
  await viewer.close(connection);
  connection = undefined;
  viewer = await ownedApp(binary, profile);
  connection = await viewer.connect();
  evaluate = connection.evaluate;
  const restored = await evaluate<WatchRule[]>('window.viewer.watchRules({kind:"list"})');
  assert.equal(restored[0].id, ruleAfter[0].id);
  assert.equal(restored[0].runID, runs[0].id);
  await writeFile(path.join(inbox, 'Second.txt'), 'Wait behind the existing review.');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal((await evaluate<WorkflowRun[]>('window.viewer.workflow({kind:"list"})')).length, 1);
  assert.deepEqual(await readdir(destination), []);
  evidence.push(
    'Cold process restores the approved watch and pending review without replaying it or creating a second run while its first review remains pending.',
  );
  await writeFile(
    file,
    '// External edit\n' + JSON.stringify({ ...definition, name: 'Updated public definition' }),
  );
  await writeFile(path.join(inbox, 'Third.txt'), 'Trigger approval revalidation.');
  await until(
    () => evaluate<WatchRule[]>('window.viewer.watchRules({kind:"list"})'),
    (rules) => !rules[0].enabled,
    'changed definition pauses rule',
  );
  assert.equal((await evaluate<WorkflowRun[]>('window.viewer.workflow({kind:"list"})')).length, 1);
  assert.deepEqual(await readdir(destination), []);
  evidence.push(
    'Editing the public workflow invalidates its private approval and pauses the restored rule before another proposal is created.',
  );
  await viewer.close(connection);
  connection = undefined;
  const privateRecord = JSON.parse(
    await readFile(path.join(profile, 'watch-rules-v1.json'), 'utf8'),
  );
  assert.equal(privateRecord[0].enabled, false);
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      { binary, evidence, storeQualification: false, nativePickers: false, passed: true },
      null,
      2,
    ),
  );
  process.stdout.write(evidence.map((line) => 'PASS ' + line).join('\n') + '\n');
} finally {
  await viewer.close(connection).catch(() => {});
  await trashTemporary(root);
}
