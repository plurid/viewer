/** Hidden owned acceptance; all generated inputs, profiles, runs and captures stay preserved. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { NoteReply } from '../../src/domain/editing/notes';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, countOf, exists, patchSettings, pressButton, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';
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

type NoteList = Extract<NoteReply, { kind: 'list' }>;
type NoteDocumentReply = Extract<NoteReply, { kind: 'document' }>;
type SelectableField = HTMLElement & { select?(): void };

/** Whether any button labelled `label` is enabled; the label can repeat across planes. */
const buttonEnabled = (label: string) =>
  [...document.querySelectorAll('button')].some(
    (button) => button.textContent.trim() === label && !button.disabled,
  );

function pressEnabledButton(label: string): void {
  [...document.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === label && !button.disabled)!
    .click();
}

/**
 * Which match a field step uses: the one in the docked plane, else the last. A new plane need not
 * come last in the page. -1 until it exists and, inside a plane, that plane is docked and still.
 */
function settledField(selector: string): number {
  const view = document.querySelector('[data-plurid-entity="PluridView"]');
  const docked = view?.getAttribute('data-plurid-docked') ?? '';
  const pane = (field: Element) =>
    field.closest<HTMLElement>('[data-viewer-pane]')?.dataset.viewerPane;
  const fields = [...document.querySelectorAll(selector)];
  const inDocked = fields.findIndex((field) => {
    const id = pane(field);
    return !!id && docked.includes(id);
  });
  const index = inDocked >= 0 ? inDocked : fields.length - 1;
  if (index < 0 || !pane(fields[index]!)) return index;
  return inDocked >= 0 && !view!.hasAttribute('data-plurid-motion') ? index : -1;
}

function selectField(selector: string, index: number): void {
  const element = document.querySelectorAll<SelectableField>(selector)[index]!;
  element.focus();
  element.select?.();
}

function fieldHolds(selector: string, index: number, text: string): boolean {
  const element = document.querySelectorAll(selector)[index];
  return !!element && (!('value' in element) || element.value === text);
}

/** The text of the first match; refuses a missing element. */
function requiredText(selector: string): string {
  const element = document.querySelector(selector);
  if (!element) throw new Error('Nothing matches: ' + selector);
  return element.textContent;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const noteList = () => window.viewer.notes({ kind: 'list' }) as Promise<NoteList>;

function openListedNote(title: string): void {
  [...document.querySelectorAll<HTMLElement>('.notes-list button')]
    .find((button) => button.textContent.includes(title))!
    .click();
}

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
  const press = async (text: string) => {
    await until(() => evaluate(pageCall(buttonEnabled, text)), Boolean, 'enabled ' + text);
    await evaluate(pageCall(pressEnabledButton, text));
  };
  const field = async (selector: string, text: string) => {
    const index = await until(
      () => evaluate(pageCall(settledField, selector)),
      (index) => index >= 0,
      'settled field ' + selector,
    );
    await evaluate(pageCall(selectField, selector, index));
    await command('Input.insertText', { text });
    await until(
      () => evaluate(pageCall(fieldHolds, selector, index, text)),
      Boolean,
      'entered ' + selector,
    );
  };
  const run = async (name: string) => {
    await evaluate(click('[aria-label="Commands (⌘K)"]'));
    await until(
      () => evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label') ?? '')),
      (value) => value === 'Search commands',
      'command search',
    );
    await command('Input.insertText', { text: name });
    await until(
      () => evaluate(textOf('.command-result[aria-selected=true]')),
      (value) => value.startsWith(name),
      name,
    );
    console.log(
      'Command:',
      name,
      await evaluate(pageCall(requiredText, '.command-result[aria-selected=true]')),
    );
    await evaluate(click('.command-result[aria-selected=true]'));
  };
  const capture = async (name: string) => {
    await evaluate(pageCall(pause, 200));
    const screenshot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const file = path.join(root, name + '.png');
    await writeFile(file, Buffer.from(screenshot.data, 'base64'), { flag: 'wx' });
    captures.push(file);
  };
  await until(() => evaluate(exists('.folder-explorer')), Boolean, 'folder');
  await evaluate(click('[aria-label="Folder actions"]'));
  await until(
    () => evaluate(countOf('.context-menu .command-result')),
    (value) => value > 0,
    'context menu',
  );
  assert.equal(await evaluate(exists('.context-menu .command-result[title]')), false);
  assert.equal(
    await evaluate(
      pageCall(() =>
        [...document.querySelectorAll('.context-menu .command-result')].some(
          (row) => row.textContent.trim() === 'Layout',
        ),
      ),
    ),
    true,
  );
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await run('Run command');
  await until(() => evaluate(exists('.run-command-dialog textarea')), Boolean, 'run prompt');
  await field('.run-command-dialog textarea', 'printf "viewer-native-command\\n"; git init -q');
  await capture('run-command-dark');
  await press('Run');
  await until(
    () => evaluate(pageCall(() => window.viewer.executionList())),
    (tasks) => tasks.length === 1 && tasks[0]!.status === 'completed',
    'background run',
  );
  const tasks = await evaluate(pageCall(() => window.viewer.executionList()));
  assert.equal(tasks[0]!.directory, await realpath(files));
  assert.equal(tasks[0]!.exitCode, 0);
  assert.match(tasks[0]!.output, /viewer-native-command/);
  assert.equal(await evaluate(exists('.xterm')), false);
  await run('Command progress');
  await until(
    () => evaluate(textOf('.execution-panel')),
    (value) => value.includes('exit 0'),
    'expanded command result',
  );
  await evaluate(click('[aria-label="Hide command progress"]'));
  await run('Run command');
  await until(
    () => evaluate(exists('.run-command-dialog textarea')),
    Boolean,
    'saved-action prompt',
  );
  await field('.run-command-dialog textarea', 'printf "saved action\\n"');
  await press('Save as action…');
  await field('[aria-label="Action name"]', 'Generated saved action');
  await press('Review in Settings');
  const configuration = await app.connect(true);
  await until(
    () => configuration.evaluate(exists('[aria-label="Command draft"]')),
    Boolean,
    'Settings command draft',
  );
  const draftCapture = await configuration.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const draftImage = path.join(root, 'command-draft.png');
  await writeFile(draftImage, Buffer.from(draftCapture.data, 'base64'), { flag: 'wx' });
  captures.push(draftImage);
  await configuration.evaluate(pressButton('Add command'));
  await until(
    () => configuration.evaluate(pageCall(() => window.viewer.settingsGet())),
    (snapshot) =>
      snapshot.settings.customActions.some((action) => action.name === 'Generated saved action'),
    'saved custom action',
  );
  assert.equal((await evaluate(pageCall(() => window.viewer.executionList()))).length, 1);
  await run('New note plane');
  await until(() => evaluate(exists('.note-title input')), Boolean, 'note');
  await field('.note-title input', 'Plan notes');
  await press('Source');
  await until(() => evaluate(exists('.note-plane .cm-content')), Boolean, 'note editor');
  await field('.note-plane .cm-content', '# Decision\n\nKeep both edits.');
  await until(
    () => evaluate(pageCall(noteList)),
    (reply) => reply.notes.some((note) => note.title === 'Plan notes'),
    'private save',
  );
  await press('Document');
  await until(
    () => evaluate(textOf('.note-reading h1')),
    (value) => value === 'Decision',
    'rendered Markdown',
  );
  await capture('note-dark');
  const listed = await evaluate(pageCall(noteList));
  noteID = listed.notes.find((note) => note.title === 'Plan notes')!.id;
  await run('Close plane');
  await until(
    () => evaluate(pageCall(() => document.querySelector('.note-plane') === null)),
    Boolean,
    'note view closed after saving',
  );
  await run('Notes');
  await until(() => evaluate(exists('.notes-list button')), Boolean, 'note library');
  await capture('notes-library-dark');
  await evaluate(pageCall(openListedNote, 'Plan notes'));
  await until(
    () => evaluate(textOf('.note-reading h1')),
    (value) => value === 'Decision',
    'closed note reopened',
  );
  await run('New checklist plane');
  await until(() => evaluate(exists('[aria-label="New checklist item"]')), Boolean, 'checklist');
  await field('.note-title input', 'Release checks');
  await field('[aria-label="New checklist item"]', 'Preview RAW samples');
  await press('Add');
  await field('[aria-label="New checklist item"]', 'Review changes');
  await press('Add');
  await until(
    () => evaluate(countOf('.note-checklist input[type=checkbox]')),
    (value) => value === 2,
    'two checklist rows',
  );
  await evaluate(click('.note-checklist input[type=checkbox]'));
  await evaluate(click('[aria-label="Move item 2 up"]'));
  await until(
    () => evaluate(pageCall(noteList)),
    (reply) => reply.notes.some((note) => note.title === 'Release checks'),
    'checklist save',
  );
  const checklists = await evaluate(pageCall(noteList));
  checklistID = checklists.notes.find((note) => note.title === 'Release checks')!.id;
  const checklist = await until(
    () =>
      evaluate(
        pageCall(
          (id: string) => window.viewer.notes({ kind: 'read', id }) as Promise<NoteDocumentReply>,
          checklistID,
        ),
      ),
    (reply) => reply.document.text === '- [ ] Review changes\n- [x] Preview RAW samples\n',
    'saved checklist source',
  );
  assert.equal(checklist.document.text, '- [ ] Review changes\n- [x] Preview RAW samples\n');
  await capture('checklist-dark');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await capture('checklist-light');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('checklist-narrow');
  assert.equal((await evaluate(pageCall(() => window.viewer.jobs()))).length, 0);
} catch (error) {
  if (connection) {
    const observation = await connection.evaluate(pageCall(() => document.body.innerText));
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
    () => restoredConnection!.evaluate(exists('.note-plane')),
    Boolean,
    'restored note view',
  );
  const documents = await restoredConnection.evaluate(
    pageCall(
      (ids: string[]) =>
        Promise.all(
          ids.map((id) => window.viewer.notes({ kind: 'read', id }) as Promise<NoteDocumentReply>),
        ),
      [noteID, checklistID],
    ),
  );
  assert.match(documents[0]!.document.text, /Keep both edits/);
  assert.match(documents[1]!.document.text, /\[x\] Preview RAW samples/);
  assert.deepEqual(
    await restoredConnection.evaluate(pageCall(() => window.viewer.executionList())),
    [],
  );
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
