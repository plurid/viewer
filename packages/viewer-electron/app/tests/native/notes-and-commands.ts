/** Hidden owned acceptance; all generated inputs, profiles, runs and captures stay preserved. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { ExecutionTask } from '../../src/domain/automation/actions';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-notes-commands-');
const files = path.join(root, "Files ' literal"),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
await writeFile(path.join(files, 'Reference.txt'), 'Keep this original intact.\n', { flag: 'wx' });
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.space.opening = 'dock';
const state: SavedState = {
  version: 8,
  look: 'dark',
  activeWorkspace: 'work',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'work',
      name: 'Notes and commands',
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
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const app = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } });
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const captures: string[] = [];
let noteID = '',
  checklistID = '';
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 940,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const click = async (text: string) => {
    await until(
      () =>
        evaluate<boolean>(
          `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
        ),
      Boolean,
      'enabled ' + text,
    );
    await evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);button.click()})()`,
    );
  };
  const field = async (selector: string, text: string) => {
    await until(
      () =>
        evaluate<boolean>(
          `(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].at(-1);if(!el)return false;const marker=el.closest('[data-viewer-pane]');if(!marker)return true;const view=document.querySelector('[data-plurid-entity="PluridView"]');return !!view?.getAttribute('data-plurid-docked')?.includes(marker.dataset.viewerPane)&&!view.hasAttribute('data-plurid-motion')})()`,
        ),
      Boolean,
      'settled field ' + selector,
    );
    await evaluate(
      `(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].at(-1);el.focus();el.select?.()})()`,
    );
    await command('Input.insertText', { text });
    await until(
      () =>
        evaluate<boolean>(
          `(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].at(-1);return !!el&&(!('value' in el)||el.value===${JSON.stringify(text)})})()`,
        ),
      Boolean,
      'entered ' + selector,
    );
  };
  const run = async (name: string) => {
    await evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
    await until(
      () => evaluate<string>('document.activeElement?.getAttribute("aria-label")||""'),
      (value) => value === 'Search commands',
      'command search',
    );
    await command('Input.insertText', { text: name });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent||""',
        ),
      (value) => value.startsWith(name),
      name,
    );
    console.log(
      'Command:',
      name,
      await evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]").textContent',
      ),
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  const capture = async (name: string) => {
    await evaluate('new Promise(resolve=>setTimeout(resolve,200))');
    const screenshot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const file = path.join(root, name + '.png');
    await writeFile(file, Buffer.from(screenshot.data, 'base64'), { flag: 'wx' });
    captures.push(file);
  };
  await until(
    () => evaluate<boolean>('!!document.querySelector(".folder-explorer")'),
    Boolean,
    'folder',
  );
  await evaluate(`document.querySelector('[aria-label="Folder actions"]').click()`);
  await until(
    () => evaluate<number>('document.querySelectorAll(".context-menu .command-result").length'),
    (value) => value > 0,
    'context menu',
  );
  assert.equal(
    await evaluate('!!document.querySelector(".context-menu .command-result[title]")'),
    false,
  );
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".context-menu .command-result")].some(row=>row.textContent.trim()==="Layout")',
    ),
    true,
  );
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await run('Run command');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".run-command-dialog textarea")'),
    Boolean,
    'run prompt',
  );
  await field('.run-command-dialog textarea', 'printf "viewer-native-command\\n"; git init -q');
  await capture('run-command-dark');
  await click('Run');
  await until(
    () => evaluate<ExecutionTask[]>('window.viewer.executionList()'),
    (tasks) => tasks.length === 1 && tasks[0]!.status === 'completed',
    'background run',
  );
  const tasks = await evaluate<ExecutionTask[]>('window.viewer.executionList()');
  assert.equal(tasks[0]!.directory, await realpath(files));
  assert.equal(tasks[0]!.exitCode, 0);
  assert.match(tasks[0]!.output, /viewer-native-command/);
  assert.equal(await evaluate('!!document.querySelector(".xterm")'), false);
  await run('Command progress');
  await until(
    () => evaluate<string>('document.querySelector(".execution-panel").textContent'),
    (value) => value.includes('exit 0'),
    'expanded command result',
  );
  await evaluate('document.querySelector(\'[aria-label="Hide command progress"]\').click()');
  await run('Run command');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".run-command-dialog textarea")'),
    Boolean,
    'saved-action prompt',
  );
  await field('.run-command-dialog textarea', 'printf "saved action\\n"');
  await click('Save as action…');
  await field('[aria-label="Action name"]', 'Generated saved action');
  await click('Review in Settings');
  const configuration = await app.connect(true);
  await until(
    () =>
      configuration.evaluate<boolean>(`!!document.querySelector('[aria-label="Command draft"]')`),
    Boolean,
    'Settings command draft',
  );
  const draftCapture = await configuration.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const draftImage = path.join(root, 'command-draft.png');
  await writeFile(draftImage, Buffer.from(draftCapture.data, 'base64'), { flag: 'wx' });
  captures.push(draftImage);
  await configuration.evaluate(
    '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Add command").click()',
  );
  await until(
    () =>
      configuration.evaluate<{ settings: { customActions: { name: string }[] } }>(
        'window.viewer.settingsGet()',
      ),
    (snapshot) =>
      snapshot.settings.customActions.some((action) => action.name === 'Generated saved action'),
    'saved custom action',
  );
  assert.equal((await evaluate<ExecutionTask[]>('window.viewer.executionList()')).length, 1);
  await run('New note plane');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".note-title input")'),
    Boolean,
    'note',
  );
  await field('.note-title input', 'Plan notes');
  await click('Source');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".note-plane .cm-content")'),
    Boolean,
    'note editor',
  );
  await field('.note-plane .cm-content', '# Decision\n\nKeep both edits.');
  await until(
    () =>
      evaluate<{ kind: string; notes: { id: string; title: string }[] }>(
        'window.viewer.notes({kind:"list"})',
      ),
    (reply) => reply.notes.some((note) => note.title === 'Plan notes'),
    'private save',
  );
  await click('Document');
  await until(
    () => evaluate<string>('document.querySelector(".note-reading h1")?.textContent||""'),
    (value) => value === 'Decision',
    'rendered Markdown',
  );
  await capture('note-dark');
  const listed = await evaluate<{ kind: string; notes: { id: string; title: string }[] }>(
    'window.viewer.notes({kind:"list"})',
  );
  noteID = listed.notes.find((note) => note.title === 'Plan notes')!.id;
  await run('Close plane');
  await until(
    () => evaluate<boolean>('!document.querySelector(".note-plane")'),
    Boolean,
    'note view closed after saving',
  );
  await run('Notes');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".notes-list button")'),
    Boolean,
    'note library',
  );
  await capture('notes-library-dark');
  await evaluate(
    '[...document.querySelectorAll(".notes-list button")].find(b=>b.textContent.includes("Plan notes")).click()',
  );
  await until(
    () => evaluate<string>('document.querySelector(".note-reading h1")?.textContent||""'),
    (value) => value === 'Decision',
    'closed note reopened',
  );
  await run('New checklist plane');
  await until(
    () => evaluate<boolean>('!!document.querySelector(\'[aria-label="New checklist item"]\')'),
    Boolean,
    'checklist',
  );
  await field('.note-title input', 'Release checks');
  await field('[aria-label="New checklist item"]', 'Preview RAW samples');
  await click('Add');
  await field('[aria-label="New checklist item"]', 'Review changes');
  await click('Add');
  await until(
    () =>
      evaluate<number>('document.querySelectorAll(".note-checklist input[type=checkbox]").length'),
    (value) => value === 2,
    'two checklist rows',
  );
  await evaluate('document.querySelector(".note-checklist input[type=checkbox]").click()');
  await evaluate('document.querySelector(\'[aria-label="Move item 2 up"]\').click()');
  await until(
    () =>
      evaluate<{ notes: { id: string; title: string }[] }>('window.viewer.notes({kind:"list"})'),
    (reply) => reply.notes.some((note) => note.title === 'Release checks'),
    'checklist save',
  );
  const checklists = await evaluate<{ notes: { id: string; title: string }[] }>(
    'window.viewer.notes({kind:"list"})',
  );
  checklistID = checklists.notes.find((note) => note.title === 'Release checks')!.id;
  const checklist = await until(
    () =>
      evaluate<{ document: { text: string } }>(
        `window.viewer.notes({kind:'read',id:${JSON.stringify(checklistID)}})`,
      ),
    (reply) => reply.document.text === '- [ ] Review changes\n- [x] Preview RAW samples\n',
    'saved checklist source',
  );
  assert.equal(checklist.document.text, '- [ ] Review changes\n- [x] Preview RAW samples\n');
  await capture('checklist-dark');
  await evaluate(
    '(async()=>{const settings=await window.viewer.settingsGet();await window.viewer.settingsPatch([{path:"settings.appearance",value:"light"}],settings.revision)})()',
  );
  await capture('checklist-light');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('checklist-narrow');
  assert.equal((await evaluate<unknown[]>('window.viewer.jobs()')).length, 0);
} catch (error) {
  if (connection) {
    const observation = await connection.evaluate('document.body.innerText');
    await writeFile(path.join(root, 'failure.txt'), String(observation), { flag: 'wx' });
    const image = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(path.join(root, 'failure.png'), Buffer.from(image.data, 'base64'), {
      flag: 'wx',
    });
  }
  throw error;
} finally {
  await app.close(connection);
}
const restored = await ownedApp(binary, profile, { environment: { SHELL: '/bin/sh' } });
let restoredConnection: Awaited<ReturnType<typeof restored.connect>> | undefined;
try {
  restoredConnection = await restored.connect();
  await until(
    () => restoredConnection!.evaluate<boolean>('!!document.querySelector(".note-plane")'),
    Boolean,
    'restored note view',
  );
  const documents = await restoredConnection.evaluate<{ document: { id: string; text: string } }[]>(
    `Promise.all(${JSON.stringify([noteID, checklistID])}.map(id=>window.viewer.notes({kind:'read',id})))`,
  );
  assert.match(documents[0]!.document.text, /Keep both edits/);
  assert.match(documents[1]!.document.text, /\[x\] Preview RAW samples/);
  assert.deepEqual(await restoredConnection.evaluate('window.viewer.executionList()'), []);
} finally {
  await restored.close(restoredConnection);
}
assert.equal(
  await readFile(path.join(files, 'Reference.txt'), 'utf8'),
  'Keep this original intact.\n',
);
assert.equal(
  JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')).version,
  CURRENT_STATE_VERSION,
);
assert.ok((await readdir(profile)).some((name) => name.includes('before-notes-v9')));
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify(
    { success: true, root, noteID, checklistID, captures, fixtures: 'preserved' },
    null,
    2,
  ),
  { flag: 'wx' },
);
console.log(JSON.stringify({ success: true, root, captures }));
