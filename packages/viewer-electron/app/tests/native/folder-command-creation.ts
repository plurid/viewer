/** Real folder creation through a modal and a 26-step line. All fixtures remain. */
import assert from 'node:assert/strict';
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, exists, pressButton, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await realpath(await temporaryRoot('viewer-native-folder-commands-'));
const folder = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(folder), mkdir(profile)]);
if (process.env.VIEWER_TEST_COLLISION === '1') await mkdir(path.join(folder, 'a'));
const settings = defaultSettings(folder);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.space.opening = process.env.VIEWER_TEST_OPENING === 'face-on' ? 'face-on' : 'dock';
if (process.env.VIEWER_TEST_OPENING === 'face-on') {
  ui.space.backdrop = 'clear';
  ui.space.grid = false;
}
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'creation',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'creation',
      name: 'Folder creation',
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
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const listJobs = () => window.viewer.jobs();
const focusedLabel = () => document.activeElement?.getAttribute('aria-label');

/** The centre of the New folder form's Create button, for a real pointer click. */
function createButtonCentre() {
  const dialog = document.querySelector('dialog[aria-label="New folder"]')!;
  const button = [...dialog.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === 'Create',
  )!;
  const bounds = button.getBoundingClientRect();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function pageDiagnostic() {
  return {
    text: document.body.innerText,
    dialogs: [...document.querySelectorAll('dialog')].map((dialog) => ({
      label: dialog.getAttribute('aria-label'),
      open: dialog.open,
    })),
  };
}

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1970,
    height: 1280,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(() => evaluate(exists('.folder-explorer')), Boolean, 'Folder explorer');
  const openPalette = async (query: string) => {
    await evaluate(click('[aria-label="Commands (⌘K)"]'));
    await until(
      () => evaluate(pageCall(focusedLabel)),
      (label) => label === 'Search commands',
      'Command search',
    );
    await command('Input.insertText', { text: query });
  };
  await openPalette('New folder');
  await until(
    () => evaluate(textOf('.command-result[aria-selected=true]')),
    (text) => text.includes('New folder'),
    'New folder command',
  );
  await evaluate(click('.command-result[aria-selected=true]'));
  await until(
    () => evaluate(exists('dialog[aria-label="New folder"] input')),
    Boolean,
    'New folder form',
  );
  await command('Input.insertText', { text: 'Manual folder' });
  const createButton = await evaluate(pageCall(createButtonCentre));
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...createButton });
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...createButton,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...createButton,
    button: 'left',
    clickCount: 1,
  });
  await until(
    () => readdir(folder),
    (names) => names.includes('Manual folder'),
    'Manual folder appears on disk',
  );
  console.log('Manual New folder passed.');
  const line = Array.from(
    { length: 26 },
    (_, index) => 'mkdir ' + String.fromCharCode(97 + index),
  ).join(' | ');
  await openPalette(':' + line);
  await until(
    () => evaluate(pageCall(focusedLabel)),
    (label) => label === 'Command line',
    'Command line',
  );
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  if (process.env.VIEWER_TEST_COLLISION === '1') {
    await until(
      () => evaluate(exists('.operations-panel .collision')),
      Boolean,
      'Collision decision is visible',
    );
    const jobs = await evaluate(pageCall(listJobs));
    assert.equal(
      jobs.filter((job) => ['queued', 'running', 'collision'].includes(job.status)).length,
      1,
      'The command line waits instead of flooding the queue with its remaining steps.',
    );
    await evaluate(pressButton('Skip', '.operations-panel'));
  }
  await until(
    () => readdir(folder),
    (names) => names.filter((name) => /^[a-z]$/.test(name)).length === 26,
    'All a–z folders',
    15000,
  );
  const names = await readdir(folder);
  assert.equal(names.filter((name) => /^[a-z]$/.test(name)).length, 26);
  console.log('All 26 folders created through the line runner.');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ pass: true, binary, root, names }, null, 2),
    { flag: 'wx' },
  );
} catch (error) {
  if (connection) {
    const diagnostic = await connection.evaluate(pageCall(pageDiagnostic)).catch(() => undefined);
    console.log(
      JSON.stringify({
        diagnostic,
        files: await readdir(folder),
        jobs: await connection.evaluate(pageCall(listJobs)).catch(() => undefined),
      }),
    );
  }
  throw error;
} finally {
  if (connection) {
    const jobs = await connection.evaluate(pageCall(listJobs));
    for (const job of jobs)
      if (['queued', 'running', 'collision'].includes(job.status))
        await connection.evaluate(pageCall((id: string) => window.viewer.cancelJob(id), job.id));
  }
  await app.close(connection);
  console.log('Preserved:', root);
}
