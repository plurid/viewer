/** Generated desktop tasks. Native pickers and observed human usability are separate. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { temporaryRoot } from '../../tools/temporary';
import { hashFile } from '../../tools/qualification/source';
import { ownedApp, until } from '../owned-app';
import {
  animationFrames,
  click,
  countOf,
  exists,
  patchSettings,
  pressButton,
  textOf,
} from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-desktop-quality-');
const files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
for (const directory of [
  files,
  profile,
  path.join(profile, 'notes'),
  path.join(profile, 'text-buffers'),
])
  await mkdir(directory);
for (let index = 0; index < 60; index++)
  await writeFile(
    path.join(files, 'Document ' + String(index).padStart(2, '0') + '.txt'),
    'Generated document ' + index,
    { flag: 'wx' },
  );
const noteID = randomUUID();
await writeFile(
  path.join(profile, 'notes', noteID + '.json'),
  JSON.stringify({
    id: noteID,
    kind: 'note',
    title: 'Generated retained note',
    directory: files,
    text: 'A private generated note.',
    revision: 1,
    updated: Date.now(),
  }),
  { flag: 'wx' },
);
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
settings.appearance = 'dark';
settings.browsing.scrollbars = 'always';
settings.toolbars = { folder: ['missing.extension', 'new-folder'] };
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
ui.space.headerControls.back = false;
// the discovery button this check opens, which Essential leaves to "…"
ui.space.headerControls.discover = true;
ui.space.opening = 'dock';
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  ui,
  activeWorkspace: 'desktop',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'desktop',
      name: 'Generated desktop quality',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          history: [files],
          historyIndex: 0,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          sidebar: { visible: false, width: 210 },
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const observations: unknown[] = [];
let passed = false;

function focusActionSearch() {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Find an action"]')!;
  input.focus();
  input.select();
}

/** The open dialog's edges and its footer's bottom, with the viewport size. */
function dialogGeometry() {
  const dialog = document.querySelector('dialog[open]')!,
    rect = dialog.getBoundingClientRect(),
    footer = dialog.querySelector('footer')!.getBoundingClientRect();
  return {
    width: innerWidth,
    height: innerHeight,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    footer: footer.bottom,
  };
}

/** The plane controls and file list are inside the viewport, opaque and not moving. */
function fullyFramed() {
  const controls = document.querySelector('.plane-controls')!.getBoundingClientRect(),
    scroll = document.querySelector('.file-scroll')!.getBoundingClientRect();
  let element = document.querySelector('.folder-explorer'),
    opacity = 1;
  while (element) {
    opacity *= Number(getComputedStyle(element).opacity);
    element = element.parentElement;
  }
  return (
    controls.left >= 0 &&
    controls.right <= innerWidth + 1 &&
    scroll.bottom <= innerHeight + 1 &&
    opacity > 0.999 &&
    !document.querySelector('[data-plurid-motion]')
  );
}

function openDiscovery() {
  const button = document.querySelector<HTMLElement>('[aria-label="What can I do here?"]')!;
  button.focus();
  button.click();
}

const listsAction = (name: string) =>
  [...document.querySelectorAll('.capabilities-results strong')].some(
    (row) => row.textContent === name,
  );

function pinAction(name: string) {
  const row = [...document.querySelectorAll('.capabilities-results li')].find(
    (item) => item.querySelector('strong')!.textContent === name,
  )!;
  [...row.querySelectorAll('button')].find((button) => button.textContent === 'Pin')!.click();
}

/** Replaces the folder toolbar's tools, keeping the other toolbars. */
const setFolderTools = (folder: string[]) =>
  window.viewer
    .settingsGet()
    .then((snapshot) =>
      window.viewer.settingsPatch(
        [{ path: 'settings.toolbars', value: { ...snapshot.settings.toolbars, folder } }],
        snapshot.revision,
      ),
    );

/** Action rows wholly inside the scrolled action list. */
function visibleActionRows() {
  const list = document.querySelector('.capabilities-action-scroll')!.getBoundingClientRect();
  return [...document.querySelectorAll('.capabilities-results li')].filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.top >= list.top && rect.bottom <= list.bottom;
  }).length;
}

const searchTop = () => document.querySelector('.capabilities-search')!.getBoundingClientRect().top;

function scrollActions(top: number) {
  document.querySelector('.capabilities-action-scroll')!.scrollTop = top;
}

const disclosureOpen = (selector: string) =>
  document.querySelector<HTMLDetailsElement>(selector)!.open;

const helpInBody = () =>
  document.querySelector('.capabilities-help')!.getBoundingClientRect().bottom <=
  document.querySelector('.capabilities-body')!.getBoundingClientRect().bottom + 1;

function scrollPinsToEnd() {
  const pins = document.querySelector('.capabilities-pins')!;
  pins.scrollTop = pins.scrollHeight;
}

const onlyHelpOpen = () =>
  document.querySelector<HTMLDetailsElement>('.capabilities-help')!.open &&
  !document.querySelector<HTMLDetailsElement>('.capabilities-pins')!.open;

const firstPin = () =>
  document.querySelector('.capabilities-pins li span')!.firstChild!.textContent;

const pinnedTools = () =>
  [...document.querySelectorAll('.plane-pinned-tools button')].map((button) =>
    button.getAttribute('aria-label'),
  );

async function session(restart: boolean) {
  const app = await ownedApp(binary!, profile);
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    const { evaluate, command } = connection;
    await command('Performance.enable');
    const viewport = (width: number, height: number) =>
      command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    const appearance = (value: 'dark' | 'light') =>
      evaluate(patchSettings({ path: 'settings.appearance', value }));
    const press = (label: string, scope: string) => evaluate(pressButton(label, scope));
    const field = async (value: string) => {
      await evaluate(pageCall(focusActionSearch));
      if (value) await command('Input.insertText', { text: value });
      else {
        await command('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        await command('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
      }
    };
    const settle = () => evaluate(animationFrames(2));
    const capture = async (name: string) => {
      await settle();
      const { data } = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, name + '.png'), Buffer.from(data, 'base64'), { flag: 'wx' });
    };
    const geometry = async (name: string) => {
      const rect = await evaluate(pageCall(dialogGeometry));
      assert.ok(
        rect.left >= 0 &&
          rect.right <= rect.width + 1 &&
          rect.top >= 0 &&
          rect.bottom <= rect.height + 1,
        name + ' fits viewport',
      );
      assert.ok(rect.footer <= rect.height + 1, name + ' footer reachable');
      observations.push({ name, rect });
    };
    await viewport(1280, 900);
    await until(() => evaluate(exists('[data-file-path]')), Boolean, 'folder rows');
    await until(
      () => evaluate(exists('[aria-label="What can I do here?"]')),
      Boolean,
      'contextual discovery',
    );
    assert.equal(
      await evaluate(pageCall(() => document.documentElement.dataset.scrollbars)),
      'always',
    );
    assert.equal(await evaluate(exists('[aria-label="Back"]')), false);
    assert.equal(
      await evaluate(
        pageCall(
          () =>
            document.querySelector<HTMLButtonElement>(
              '[aria-label="Missing action: missing.extension"]',
            )!.disabled,
        ),
      ),
      true,
    );
    if (!restart) {
      await until(() => evaluate(pageCall(fullyFramed)), Boolean, 'fully framed folder');
      await capture('folder-always-visible-scrollbars');
    }
    await evaluate(pageCall(openDiscovery));
    await until(() => evaluate(exists('.capabilities-dialog')), Boolean, 'discovery dialog');
    if (!restart) {
      await field('New file');
      await until(() => evaluate(pageCall(listsAction, 'New file…')), Boolean, 'new file action');
      await evaluate(pageCall(pinAction, 'New file…'));
      await until(
        () => evaluate(exists('[aria-label="Move New file… earlier"]')),
        Boolean,
        'saved pin',
      );
      await evaluate(click('.capabilities-pins > summary'));
      for (let index = 0; index < 2; index++) {
        await evaluate(click('[aria-label="Move New file… earlier"]'));
        await until(
          () => evaluate(countOf('.capabilities-pins button:disabled')),
          (count) => count === 2,
          'reorder saved',
        );
      }
      await field('new floder');
      await until(
        () => evaluate(pageCall(listsAction, 'New folder…')),
        Boolean,
        'explicit typo suggestion',
      );
      assert.equal(await evaluate(countOf('dialog[open]')), 1);
      await field('');
      await evaluate(click('.capabilities-search input[type=checkbox]'));
      await until(
        () => evaluate(textOf('.capabilities-dialog')),
        (text) => text.includes('Select exactly one'),
        'unavailable explanation',
      );
      await geometry('capabilities-dark-wide');
      await capture('capabilities-dark-wide');
      await evaluate(click('.capabilities-pins > summary'));
      await evaluate(
        pageCall(setFolderTools, [
          'new-file',
          'missing.extension',
          'new-folder',
          'frame-plane',
          'dock',
          'close-plane',
          'new-scratch-plane',
          'new-terminal-plane',
        ]),
      );
      await until(
        () => evaluate(textOf('.capabilities-pins > summary')),
        (text) => text.includes('8 of 8'),
        'eight-pin limit',
      );
      await viewport(760, 540);
      await appearance('light');
      await geometry('capabilities-light-minimum');
      const visibleRows = await evaluate(pageCall(visibleActionRows));
      assert.ok(
        visibleRows >= 2,
        'At least two complete action rows fit at minimum height with eight pins',
      );
      const top = await evaluate(pageCall(searchTop));
      await evaluate(pageCall(scrollActions, 200));
      await settle();
      assert.equal(await evaluate(pageCall(searchTop)), top, 'Search stays stationary');
      await evaluate(pageCall(scrollActions, 0));
      await capture('capabilities-light-minimum');
      await evaluate(click('.capabilities-pins > summary'));
      await until(
        () => evaluate(pageCall(disclosureOpen, '.capabilities-pins')),
        Boolean,
        'expanded eight-pin editor',
      );
      await geometry('expanded-tools-light-minimum');
      assert.equal(
        await evaluate(pageCall(helpInBody)),
        true,
        'expanded tools do not clip lower controls',
      );
      await evaluate(pageCall(scrollPinsToEnd));
      await capture('capabilities-tools-light-minimum');
      await evaluate(click('.capabilities-help > summary'));
      await until(
        () => evaluate(pageCall(onlyHelpOpen)),
        Boolean,
        'one auxiliary disclosure at a time',
      );
      await geometry('expanded-help-light-minimum');
      assert.equal(await evaluate(pageCall(helpInBody)), true, 'expanded help remains in the body');
      await capture('capabilities-help-light-minimum');
      await evaluate(click('.capabilities-help > summary'));
      await field('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
      await until(() => evaluate(exists('.capabilities-empty')), Boolean, 'empty-state recovery');
      await capture('capabilities-empty-light-minimum');
      await press('Clear search', '.capabilities-empty');
      await until(
        () => evaluate(countOf('.capabilities-results li')),
        (count) => count > 0,
        'search recovered',
      );
      await evaluate(pageCall(setFolderTools, ['new-file', 'missing.extension', 'new-folder']));
    } else assert.equal(await evaluate(pageCall(firstPin)), 'New file…');
    await press('Done', '.capabilities-dialog');
    await settle();
    assert.equal(
      await evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label'))),
      'What can I do here?',
      'focus returns to opener',
    );
    if (!restart) {
      await viewport(1280, 900);
      await appearance('dark');
      await evaluate(click('[aria-label="Commands (⌘K)"]'));
      await command('Input.insertText', { text: 'Backup and restore' });
      await until(
        () => evaluate(textOf('.command-result[aria-selected=true]')),
        (text) => text.includes('Backup and restore'),
        'backup command',
      );
      await evaluate(click('.command-result[aria-selected=true]'));
      await until(() => evaluate(exists('.backup-dialog')), Boolean, 'backup dialog');
      await capture('backup-start-dark-wide');
      await press('Create backup…', '.backup-dialog');
      await until(() => evaluate(exists('.backup-counts')), Boolean, 'prepared snapshot');
      await geometry('backup-review-dark-wide');
      await capture('backup-review-dark-wide');
      await viewport(760, 540);
      await appearance('light');
      await geometry('backup-review-light-minimum');
      await capture('backup-review-light-minimum');
      await press('Cancel', '.backup-dialog');
      await viewport(1280, 900);
      for (let index = 0; index < 5; index++) {
        await evaluate(click('[aria-label="What can I do here?"]'));
        await until(() => evaluate(exists('.capabilities-dialog')), Boolean, 'repeat discovery');
        await press('Done', '.capabilities-dialog');
      }
    }
    observations.push({
      restart,
      pinned: await evaluate(pageCall(pinnedTools)),
      metrics: await command('Performance.getMetrics'),
    });
  } finally {
    await app.close(connection);
  }
}
try {
  await session(false);
  await session(true);
  const config = parse(await readFile(path.join(profile, 'config.jsonc'), 'utf8'));
  assert.deepEqual(config.settings.toolbars.folder, [
    'new-file',
    'missing.extension',
    'new-folder',
  ]);
  assert.equal(config.settings.browsing.scrollbars, 'always');
  assert.equal(config.ui.space.headerControls.back, false);
  passed = true;
} finally {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        capturedAt: new Date().toISOString(),
        candidate: await hashFile(path.resolve(path.dirname(binary), '../Resources/app.asar')),
        platform: process.platform,
        architecture: process.arch,
        observations,
        notObserved: ['native save/open picker acceptance', 'human usability', 'VoiceOver'],
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log('Desktop quality evidence:', root);
}
