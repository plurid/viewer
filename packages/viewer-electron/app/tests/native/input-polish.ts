/** Selection, palette commands, Settings focus and sidebar feedback in a packaged Viewer. */
import assert from 'node:assert/strict';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../../src/domain/contracts';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { pageCall } from './runtime/page-function';
import { animationFrames, exists, patchSettings } from './runtime/page';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const root = await temporaryRoot('viewer-input-polish-');
const profile = path.join(root, 'Profile');
const folder = path.join(root, 'Files');
await mkdir(profile);
await mkdir(folder);
await mkdir(path.join(folder, 'Folder'));
await symlink(path.join(folder, 'Folder'), path.join(folder, 'Folder alias'));
for (const name of ['A.txt', 'B.txt', 'C.txt']) await writeFile(path.join(folder, name), name);
await writeFile(
  path.join(folder, 'Image.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4X8AAAAASUVORK5CYII=',
    'base64',
  ),
);
const state: SavedState = {
  version: 11,
  activeWorkspace: 'input',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'input',
      name: 'Input checks',
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
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const app = await ownedApp(process.env.VIEWER_TEST_BINARY, profile, { label: 'input-polish' });
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const actions = new NativeInteractions({ evaluate, command, until });
  await until(() => evaluate(exists('.file-row')), Boolean, 'Folder files');
  const file = (name: string) => '[data-file-path=' + JSON.stringify(path.join(folder, name)) + ']';
  const position = (selector: string) =>
    evaluate(
      pageCall((selector) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      }, selector),
    );
  const click = async (selector: string, modifiers = 0) => {
    const point = await position(selector);
    for (const type of ['mousePressed', 'mouseReleased'])
      await command('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        clickCount: 1,
        modifiers,
      });
    await evaluate(animationFrames(2));
  };
  const shadow = () =>
    evaluate(
      pageCall(() => getComputedStyle(document.querySelector('[data-plurid-plane]')!).boxShadow),
    );
  const initialShadow = await shadow();
  await click(file('A.txt'));
  await click(file('C.txt'), 8);
  assert.equal(
    await evaluate(
      pageCall(() => document.querySelectorAll('.file-row[aria-selected=true]').length),
    ),
    3,
  );
  assert.equal(
    await shadow(),
    initialShadow,
    'Shift-click in files keeps plane selection unchanged',
  );
  await click('.plane-heading', 8);
  assert.notEqual(await shadow(), initialShadow, 'Shift-click title selects the plane');
  await click('.plane-heading', 8);
  assert.equal(await shadow(), initialShadow, 'Second title click toggles once');
  await evaluate(patchSettings({ path: 'ui.space.dragging', value: false }));
  await click('.plane-heading', 8);
  assert.notEqual(
    await shadow(),
    initialShadow,
    'Title selection still works with dragging disabled',
  );
  await click('.plane-heading', 8);
  await evaluate(patchSettings({ path: 'ui.space.dragging', value: true }));

  const names = await evaluate(
    pageCall(() =>
      [...document.querySelectorAll('section[aria-label="Locations"] .location > span')].map(
        (item) => item.textContent,
      ),
    ),
  );
  assert.deepEqual(names, [
    'Desktop',
    'Documents',
    'Downloads',
    'Pictures',
    'Movies',
    'Music',
    'Applications',
    'Home',
    'Volumes',
    'Trash',
  ]);
  await actions.palette('Group by kind');
  const groups = await evaluate(
    pageCall(() =>
      [...document.querySelectorAll('.file-group-label')].map((item) => item.textContent),
    ),
  );
  assert.ok(
    groups.findIndex((name) => name?.includes('Aliases')) <
      groups.findIndex((name) => name?.includes('Folders')),
  );
  assert.match(
    await evaluate(
      pageCall((selector) => document.querySelector(selector)!.textContent, file('Folder alias')),
    ),
    /Alias/,
  );
  await actions.capture(path.join(app.evidenceDirectory, 'aliases-and-locations.png'));

  const sidebar = await evaluate(
    pageCall(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>('section[aria-label="Locations"] .location'),
      ];
      const home = rows.find((row) => row.textContent === 'Home')!;
      const row = rows.find((row) => row.textContent === 'Documents')!;
      const box = row.getBoundingClientRect();
      return { home: home.title, x: box.left + box.width / 2, y: box.top + box.height / 4 };
    }),
  );
  const data = {
    items: [
      {
        mimeType: 'application/x-viewer-sidebar',
        data: JSON.stringify({ section: 'locations', path: sidebar.home }),
      },
      { mimeType: 'application/x-viewer-sidebar-locations', data: '' },
    ],
    dragOperationsMask: 16,
  };
  for (const type of ['dragEnter', 'dragOver'])
    await command('Input.dispatchDragEvent', { type, x: sidebar.x, y: sidebar.y, data });
  await until(() => evaluate(exists('.location.sidebar-drop-before')), Boolean, 'Insertion marker');
  await actions.capture(path.join(app.evidenceDirectory, 'sidebar-insertion.png'));
  await command('Input.dispatchDragEvent', { type: 'drop', x: sidebar.x, y: sidebar.y, data });
  await until(
    () =>
      evaluate(
        pageCall(() =>
          [...document.querySelectorAll('section[aria-label="Locations"] .location > span')]
            .map((item) => item.textContent)
            .slice(0, 3)
            .join(','),
        ),
      ),
    (value) => value === 'Desktop,Home,Documents',
    'Exact insertion position',
  );

  await click(file('Image.png'));
  await actions.key(' ', 'Space');
  await until(
    () => evaluate(exists('.quick-preview-dialog .preview-toolbar')),
    Boolean,
    'Image toolbar',
  );
  const tools = await evaluate(
    pageCall(() =>
      [...document.querySelectorAll('.quick-preview-dialog button')]
        .map((button) => button.textContent?.trim())
        .filter((label) => label === 'Image tools…' || label === 'Convert images…'),
    ),
  );
  assert.deepEqual(tools, ['Image tools…']);
  await actions.capture(path.join(app.evidenceDirectory, 'image-tools.png'));
  await actions.key('Escape', 'Escape');

  await evaluate(pageCall(() => window.viewer.openSettings()));
  const settings = await app.connect(true);
  const settingsActions = new NativeInteractions({ ...settings, until });
  await until(
    () => settings.evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label'))),
    (value) => value === 'Search settings',
    'Settings search focus',
  );
  await settings.command('Input.insertText', { text: 'header' });
  await settings.evaluate(pageCall(() => (document.activeElement as HTMLElement).blur()));
  await evaluate(pageCall(() => window.viewer.openSettings()));
  await until(
    () =>
      settings.evaluate(
        pageCall(() => {
          const input = document.activeElement as HTMLInputElement;
          return (
            input?.getAttribute('aria-label') === 'Search settings' &&
            input.selectionStart === 0 &&
            input.selectionEnd === 6
          );
        }),
      ),
    Boolean,
    'Reopen selects prior query',
  );
  await settingsActions.capture(path.join(app.evidenceDirectory, 'settings-search.png'));
  await command('Target.closeTarget', { targetId: settings.targetID });

  await actions.click('[aria-label="Commands (⌘K)"]');
  await actions.field('Search commands', '! ');
  await until(
    () => evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label'))),
    (value) => value === 'Shell command',
    'Quick command focus',
  );
  await actions.field('Shell command', "printf 'quick-command-ok\\n'; pwd");
  await actions.key('Enter', 'Enter');
  await until(
    () =>
      evaluate(
        pageCall(() => document.querySelector('.quick-command-output [role=status]')?.textContent),
      ),
    (value) => value === 'completed · exit 0',
    'Quick command completion',
  );
  const output = await evaluate(
    pageCall(() => document.querySelector('.quick-command-output pre')!.textContent),
  );
  assert.match(output, /quick-command-ok/);
  assert.ok(output.includes(await realpath(folder)), 'Captured cwd is the folder');
  assert.equal(await evaluate(exists('[aria-label="Command progress"]')), false);
  await actions.capture(path.join(app.evidenceDirectory, 'quick-command.png'));
  const count = await evaluate(pageCall(async () => (await window.viewer.executionList()).length));
  await actions.key('Escape', 'Escape');
  await actions.click('[aria-label="Commands (⌘K)"]');
  await actions.field('Search commands', '! ');
  assert.equal(
    await evaluate(pageCall(async () => (await window.viewer.executionList()).length)),
    count,
  );
  assert.equal(
    await evaluate(
      pageCall(() => document.querySelector('.quick-command-output pre')!.textContent),
    ),
    output,
  );
  await actions.field('Shell command', "printf 'running\\n'; sleep 30");
  await actions.key('Enter', 'Enter');
  await until(
    () =>
      evaluate(pageCall(() => document.querySelector('.quick-command-output pre')?.textContent)),
    (value) => value?.includes('running'),
    'Streaming output',
  );
  await actions.button('Stop', '.quick-command');
  await until(
    () =>
      evaluate(
        pageCall(() => document.querySelector('.quick-command-output [role=status]')?.textContent),
      ),
    (value) => value?.startsWith('cancelled'),
    'Quick command cancellation',
  );
  await writeFile(
    path.join(app.evidenceDirectory, 'result.json'),
    JSON.stringify(
      {
        passed: [
          'content-selection',
          'title-selection',
          'disabled-drag-selection',
          'default-locations',
          'alias-group',
          'insertion-line',
          'image-tools',
          'settings-focus',
          'quick-command-cwd',
          'quick-command-output',
          'quick-command-reopen',
          'quick-command-stop',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS input polish:', app.evidenceDirectory);
} catch (error) {
  console.error(error);
  if (connection)
    await writeFile(
      path.join(app.evidenceDirectory, 'failure.txt'),
      await connection.evaluate(pageCall(() => document.body.innerText)),
    );
  throw error;
} finally {
  await app.close(connection);
}
