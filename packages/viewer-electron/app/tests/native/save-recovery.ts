/** Operator acceptance for a real Save. Preparation is read-only with respect to removals;
 * the operator approves exact generated paths and clicks Save themselves. Fixtures stay. */
import assert from 'node:assert/strict';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import {
  inspectReviewedFile,
  sameReviewedFile,
  type ReviewedFile,
} from '../../src/desktop/native/reviewed-file';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { countOf, focus, textOf } from './runtime/page';

assert.equal(process.platform, 'darwin');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(
  process.argv.includes('--interactive') && process.stdin.isTTY,
  'This acceptance needs an operator and a terminal.',
);
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary, 'Choose the packaged candidate.');
const root = await realpath(await temporaryRoot('viewer-save-operator-', path.resolve('out')));
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const name = 'Saved note ' + path.basename(root).split('-').at(-1) + '.txt';
const file = path.join(files, name);
const original = 'Generated original version. Keep this version recoverable.\n';
const edited = 'Saved edit, verified after a cold restart.\n' + original;
await writeFile(file, original, { flag: 'wx', mode: 0o600 });
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.space.opening = 'dock';
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'save-recovery',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'save-recovery',
      name: 'Generated save and recovery acceptance',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
        },
      ],
    },
  ],
};
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(state), { flag: 'wx' });
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const input = createInterface({ input: process.stdin, output: process.stdout });
const resultFile = path.join(root, 'result.json');
const result: Record<string, unknown> = { passed: false, retained: true, stages: [] };
const record = async (stage: string, detail: unknown = {}) => {
  result.stage = stage;
  (result.stages as unknown[]).push({ stage, detail });
  await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n');
  console.log(stage);
};
type Application = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Application['connect']>>;
let app: Application | undefined;
let connection: Connection | undefined;
let actions: NativeInteractions;
const launch = async (foreground = false) => {
  app = await ownedApp(
    binary,
    profile,
    foreground ? { mode: 'foreground', environment: { VIEWER_TEST_NO_REMOVAL: '0' } } : {},
  );
  connection = await app.connect();
  actions = new NativeInteractions({ ...connection, until });
  await connection.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 940,
    deviceScaleFactor: 1,
    mobile: false,
  });
};
const close = async () => {
  if (app) await app.close(connection);
  app = undefined;
  connection = undefined;
};
const verifyScope = async (reviewed: ReviewedFile) => {
  const relative = path.relative(root, reviewed.path);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  for (let current = path.dirname(reviewed.path); ; current = path.dirname(current)) {
    const info = await lstat(current);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    if (current === root) break;
    assert.notEqual(current, path.dirname(current));
  }
  const info = await lstat(reviewed.path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
  assert.ok(
    sameReviewedFile(reviewed, (await inspectReviewedFile(reviewed.path, 16_000_000)).reviewed),
  );
};

try {
  await launch();
  const selector = '[data-file-path=' + JSON.stringify(file) + ']';
  await actions!.click('.folder-explorer ' + selector);
  await connection!.evaluate(focus('.folder-explorer'));
  await actions!.key(' ', 'Space');
  await actions!.button('Open linked plane', '.quick-preview-dialog');
  await actions!.palette('Edit text');
  await actions!.text('.text-editing .cm-content', edited);
  const pane = await until(
    async () =>
      (await saved()).workspaces[0]!.panes.find(
        (item) => item.type === 'preview' && item.path === file && item.bufferID,
      ),
    Boolean,
    'Persisted draft reference',
  );
  assert.ok(pane?.type === 'preview' && pane.bufferID);
  const draftFile = path.join(profile, 'text-buffers', pane.bufferID + '.json');
  await until(
    async () =>
      readFile(draftFile, 'utf8')
        .then(JSON.parse)
        .catch(() => undefined),
    (value) => value?.text === edited,
    'Persisted generated draft',
  );
  await close();
  const reviewed = await Promise.all(
    [file, draftFile].map(
      async (target) => (await inspectReviewedFile(target, 16_000_000)).reviewed,
    ),
  );
  for (const item of reviewed) await verifyScope(item);
  assert.equal(await readFile(file, 'utf8'), original);
  const trashFiles = reviewed.map((item) =>
    path.join(os.homedir(), '.Trash', path.basename(item.path)),
  );
  for (const target of trashFiles) await assert.rejects(lstat(target), { code: 'ENOENT' });
  result.reviewed = reviewed;
  const archiveHash = createHash('sha256');
  for await (const chunk of createReadStream(path.resolve(binary, '../../Resources/app.asar')))
    archiveHash.update(chunk);
  result.candidate = archiveHash.digest('hex');
  await record(
    'READY exact-path approval',
    reviewed.map((item) => ({
      path: path.relative(process.cwd(), item.path),
      bytes: item.version.size,
      sha256: item.sha256,
    })),
  );
  console.log(
    JSON.stringify({
      review: reviewed.map((item) => path.relative(process.cwd(), item.path)),
      result: path.relative(process.cwd(), resultFile),
    }),
  );
  // Stdin is only a supervisor gate. It cannot grant permission or answer a native review.
  assert.equal(
    (await input.question('After exact-path user approval, type approved: ')).trim(),
    'approved',
  );
  for (const item of reviewed) await verifyScope(item);
  await launch(true);
  await actions!.palette(name);
  await until(
    () => connection!.evaluate(textOf('.text-editing .cm-content')),
    (text) => text.includes('Saved edit, verified'),
    'Restored generated draft',
  );
  await actions!.visible('.text-editing');
  await record('READY operator Save');
  // The operator clicks Save. This driver never clicks a removal approval or starts the save.
  const savedText = await until(
    () => readFile(file, 'utf8'),
    (text) => text !== original,
    'Operator saved the generated file',
    600_000,
  );
  await until(
    () => connection!.evaluate(countOf('.text-editing-toolbar .primary')),
    (count) => count === 0,
    'Editor acknowledged the completed save',
    30_000,
  );
  const savedPane = (await saved()).workspaces[0]!.panes.find((item) => item.id === pane.id);
  assert.ok(savedPane?.type === 'preview' && savedPane.bufferID === undefined);
  await assert.rejects(lstat(draftFile), { code: 'ENOENT' });
  assert.ok(
    sameReviewedFile(
      reviewed[0]!,
      (await inspectReviewedFile(trashFiles[0]!, 16_000_000)).reviewed,
    ),
    'The native Trash holds the exact original version.',
  );
  const retired = JSON.parse(await readFile(trashFiles[1]!, 'utf8'));
  assert.equal(retired.id, pane.bufferID);
  assert.equal(retired.file, file);
  // The operator can edit the generated draft before Save; verify those actual bytes.
  assert.equal(retired.text, savedText);
  result.savedSHA256 = createHash('sha256').update(savedText).digest('hex');
  const recovered = path.join(root, 'Recovered original.txt');
  await copyFile(trashFiles[0]!, recovered, constants.COPYFILE_EXCL);
  assert.equal(await readFile(recovered, 'utf8'), original);
  await actions!.capture(path.join(root, 'saved-edit.png'));
  await record('PASS save and recoverable originals', {
    recovered: path.relative(root, recovered),
  });
  await close();
  await launch();
  await actions!.palette(name);
  await until(
    () => connection!.evaluate(textOf('.preview-plane')),
    (text) => text.includes(savedText.split('\n')[0]!),
    'Saved bytes restored after cold restart',
  );
  assert.equal(await readFile(file, 'utf8'), savedText);
  assert.equal(await connection!.evaluate(countOf('.text-editing-toolbar .primary')), 0);
  assert.equal(
    (await saved()).workspaces[0]!.panes.filter(
      (item) => item.type === 'preview' && item.bufferID === pane.bufferID,
    ).length,
    0,
  );
  await actions!.capture(path.join(root, 'restored-save.png'));
  result.passed = true;
  await record('PASS cold restart without recovered draft or repeated save');
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  await record('FAILED');
  throw error;
} finally {
  input.close();
  await close();
  console.log('Retained save acceptance: ' + path.relative(process.cwd(), resultFile));
}
