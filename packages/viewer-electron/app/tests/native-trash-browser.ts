/** Isolated native renderer fixtures. Never lists, empties or modifies system Trash.
 * Empty/Restore UI calls are stubs; original generated files remain untouched. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../src/domain/contracts';
import type { TrashItem } from '../src/domain/files/trash';
import { ownedApp, until } from './owned-app';
import {
  click as syntheticClick,
  countOf,
  exists,
  focus,
  patchSettings,
  pressButton,
  textOf,
} from './native/runtime/page';
import type { PageExpression } from './native/runtime/page-function';
import { pageCall } from './native/runtime/page-function';
import { temporaryRoot } from '../tools/temporary';

const root = await temporaryRoot('viewer-trash-browser-');
const profile = path.join(root, 'Profile'),
  files = path.join(root, 'Files');
await mkdir(profile);
await mkdir(files);
const note = path.join(files, 'Build notes.txt');
const originalFolder = path.join(
  root,
  'Original documents',
  'Engineering reviews',
  'Assembly clearance and manufacturing drawings',
);
await mkdir(originalFolder, { recursive: true });
const contents =
  'Build notes\n\nRetain the original drawings and models.\nCheck the assembly clearance before printing.\n';
await writeFile(note, contents);
const state: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'trash',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'trash',
      name: 'Trash browser check',
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
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));

type TrashMode = 'normal' | 'collision' | 'empty';
type TrashDates = 'added' | 'none';
type TrashCall = 'confirmation' | 'restore' | 'paths' | 'preview';
/** What the Trash stubs keep on the renderer's window. */
interface TrashFixtureWindow {
  __trashFixtureReady?: boolean;
  __trashCalls: Record<TrashCall, number>;
  __trashMode: TrashMode;
  __trashDates: TrashDates;
  __trashFixtureItems: TrashItem[];
  __trashLastRestore?: { ids: string[]; destination: string };
}
interface FixtureChange {
  mode?: TrashMode;
  dates?: TrashDates;
  add?: TrashItem;
}

const fixtureReady = () =>
  (window as unknown as TrashFixtureWindow).__trashFixtureReady === true &&
  !!window.viewer &&
  !!document.querySelector('[data-file-owner]');

/** Replaces the renderer's Trash calls with stubs over four generated items. */
function installTrashFixture(noteOriginal: string, longOriginal: string, preview: string) {
  const fixture = window as unknown as TrashFixtureWindow,
    api = window.viewer,
    resource = api.resource;
  fixture.__trashCalls = { confirmation: 0, restore: 0, paths: 0, preview: 0 };
  fixture.__trashMode = 'normal';
  fixture.__trashDates = 'added';
  const make = (
    digit: string,
    name: string,
    directory: boolean,
    originalPath?: string,
  ): TrashItem => ({
    id: digit.repeat(64),
    name,
    directory,
    previewable: !directory,
    size: directory ? 0 : 1040,
    location: 'Home',
    modified: 1791950400000,
    addedToTrash: '2026-10-14T17:15:00',
    ...(originalPath ? { originalPath } : {}),
  });
  const folder = make('1', 'Project archive', true);
  fixture.__trashFixtureItems = [
    folder,
    make('2', 'Build notes.txt', false, noteOriginal),
    make('3', 'Unsorted notes — original location unavailable.txt', false),
    make('4', '00026295_T02.200.008_00A_Assembly-review-notes.txt', false, longOriginal),
  ];
  api.trashList = async (folderID) => ({
    revision: 'a'.repeat(64),
    locations: [{ id: 'home', name: 'Home', state: 'ready' }],
    truncated: false,
    canEmpty: fixture.__trashMode !== 'empty',
    totalItems: 4,
    items: (fixture.__trashMode === 'empty'
      ? []
      : folderID
        ? [make('5', 'Nested notes.txt', false)]
        : fixture.__trashFixtureItems
    ).map((item) =>
      fixture.__trashDates === 'none' || folderID ? { ...item, addedToTrash: undefined } : item,
    ),
    ancestors: folderID ? [folder] : [],
  });
  api.trashConfirmation = async () => {
    fixture.__trashCalls.confirmation++;
  };
  api.trashRestore = async (ids, destination) => {
    fixture.__trashCalls.restore++;
    fixture.__trashLastRestore = { ids, destination };
    if (fixture.__trashMode === 'collision')
      throw new Error(
        '“Build notes.txt” already exists. Use Restore to… to choose another folder.',
      );
    fixture.__trashFixtureItems = fixture.__trashFixtureItems.filter(
      (item) => !ids.includes(item.id),
    );
    return { restored: ids.length, cancelled: false };
  };
  api.trashCopyPaths = async () => {
    fixture.__trashCalls.paths++;
  };
  api.trashPreview = async () => {
    fixture.__trashCalls.preview++;
    return resource(preview);
  };
}

/** Changes the stubbed inventory, then presses the footer's Refresh, enabled or not. */
function refreshTrash({ mode, dates, add }: FixtureChange) {
  const fixture = window as unknown as TrashFixtureWindow;
  if (mode) fixture.__trashMode = mode;
  if (dates) fixture.__trashDates = dates;
  if (add) fixture.__trashFixtureItems.push(add);
  [...document.querySelectorAll<HTMLButtonElement>('.trash-footer button')]
    .find((button) => button.textContent === 'Refresh')!
    .click();
}

/** Sets how the restore stub answers, then presses Restore for the selection. */
function restoreSelection(mode: TrashMode) {
  (window as unknown as TrashFixtureWindow).__trashMode = mode;
  document
    .querySelector<HTMLButtonElement>('.trash-selection-actions button:not(.icon-button)')!
    .click();
}

const confirmations = () => (window as unknown as TrashFixtureWindow).__trashCalls.confirmation;

const chooseTrashCommand = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.trash-context-menu .command-result')]
    .find((command) => command.textContent.includes(label))!
    .click();

const trashAffordances = () => ({
  rootBack: !!document.querySelector('.trash-toolbar > button[aria-label="Back to parent folder"]'),
  duplicateRoot: !!document.querySelector('.trash-breadcrumbs button[aria-current="page"]'),
  sortableName: [...document.querySelectorAll('.trash-heading button')].some((button) =>
    button.textContent.includes('Name'),
  ),
  originalLocationDetails: !!document.querySelector('[aria-label="Original location details"]'),
});

/** Where a trusted click on the selector lands: its middle, at most 180 pixels in. */
function clickPoint(selector: string) {
  const rect = document.querySelector(selector)!.getBoundingClientRect();
  return { x: rect.x + Math.min(rect.width / 2, 180), y: rect.y + rect.height / 2 };
}

/** The open dialogs' boxes and opacity, serialized so successive reads compare. */
const openDialogBoxes = () =>
  JSON.stringify(
    [...document.querySelectorAll('dialog[open]')].map((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height, getComputedStyle(dialog).opacity];
    }),
  );

const trashNames = () =>
  [...document.querySelectorAll('.trash-filename > span:not(.file-icon)')].map(
    (name) => name.textContent,
  );

const sortLabel = () =>
  document.querySelector('.trash-heading button')!.getAttribute('aria-label') ?? '';

/** Whether Empty Trash is centered in the footer, with the utilities to its right. */
function footerLayout() {
  const footer = document.querySelector('.trash-footer')!.getBoundingClientRect(),
    empty = document.querySelector('.trash-empty')!.getBoundingClientRect(),
    utilities = document.querySelector('.trash-utility-actions')!.getBoundingClientRect();
  return {
    centered: Math.abs(empty.x + empty.width / 2 - (footer.x + footer.width / 2)) < 1,
    utilitiesRight: utilities.x > empty.right,
  };
}

const planeLabels = () =>
  [...document.querySelectorAll('[data-file-owner]')].map((plane) =>
    plane.getAttribute('aria-label'),
  );

/** The open dialog's text, the stub calls, the inventory stub and the Trash layout. */
function failureState() {
  return JSON.stringify({
    text: document.querySelector('dialog[open]')?.textContent,
    fixture: (window as unknown as TrashFixtureWindow).__trashCalls,
    list: window.viewer.trashList.toString(),
    rects: [
      ...document.querySelectorAll('.trash-dialog,.trash-body,.trash-inventory,.trash-scroll'),
    ].map((element) => ({
      class: element.className,
      height: element.clientHeight,
      width: element.clientWidth,
    })),
  });
}

const output = await mkdtemp(path.resolve('out/trash-browser-acceptance-'));
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-trash-folder-v1-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const evaluate = <R>(expression: PageExpression<R>) => connection!.evaluate(expression);
const evidence: string[] = [],
  captures: string[] = [];
try {
  connection = await app.connect();
  const methods = await evaluate(pageCall(() => Object.keys(window.viewerNative!)));
  assert.equal(
    methods.some((method) => /empty|erase|approv.*trash/i.test(method)),
    false,
  );
  assert.ok(methods.includes('trashConfirmation'));
  // Test-only interception in the owned renderer. The installed native API stays
  // immutable. Do not add any fixture/bypass endpoint to production.
  await connection.command('Page.enable');
  await connection.command('Page.addScriptToEvaluateOnNewDocument', {
    source: `
    (()=>{ window.__trashFixtureReady=true; const original=Object.freeze; Object.freeze=(object)=>object&&typeof object.trashList==='function'&&typeof object.bootstrap==='function'?object:original(object); })();
  `,
  });
  await connection.command('Page.reload', { ignoreCache: true });
  await until(() => evaluate(pageCall(fixtureReady)), Boolean, 'fixture renderer');
  assert.equal(
    await evaluate(pageCall(() => Object.isFrozen(window.viewer))),
    false,
    'UI fixture interception must be installed before any Trash interaction',
  );
  await evaluate(
    pageCall(
      installTrashFixture,
      path.join(originalFolder, 'Build notes.txt'),
      path.join(
        root,
        'Missing original folder',
        '00026295_T02.200.008_00A_Assembly-review-notes.txt',
      ),
      note,
    ),
  );
  assert.match(
    await evaluate(pageCall(() => window.viewer.trashList.toString())),
    /__trashMode/,
    'fixture must intercept the inventory',
  );
  await evaluate(pressButton('Trash', '.location-sidebar'));
  await until(
    () => evaluate(countOf('[data-trash-id]')),
    (value) => value === 4,
    'Trash fixture rows',
  );
  if (process.argv.includes('--metadata-repro')) {
    await evaluate(syntheticClick(`[data-trash-id="${'2'.repeat(64)}"]`));
    const report = await evaluate(pageCall(trashAffordances));
    console.log('Trash affordance repro:', JSON.stringify(report));
    assert.deepEqual(report, {
      rootBack: false,
      duplicateRoot: false,
      sortableName: true,
      originalLocationDetails: true,
    });
    await evaluate(syntheticClick('.trash-scroll'));
  }
  const click = async (selector: string, button = 'left', count = 1) => {
    const point = await evaluate(pageCall(clickPoint, selector));
    for (const type of ['mousePressed', 'mouseReleased'])
      await connection!.command('Input.dispatchMouseEvent', {
        type,
        ...point,
        button,
        clickCount: count,
      });
  };
  const key = async (key: string, code: string, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await connection!.command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        modifiers,
        ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
        windowsVirtualKeyCode:
          key === 'Escape'
            ? 27
            : key === 'Enter'
              ? 13
              : key === ' '
                ? 32
                : key === 'ArrowDown'
                  ? 40
                  : 65,
      });
  };
  const capture = async (name: string, width: number, height: number) => {
    await connection!.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(pageCall(() => document.fonts.ready));
    let previous = '',
      stable = 0;
    await until(
      () =>
        evaluate(pageCall(openDialogBoxes)).then((value) => {
          stable = previous === value ? stable + 1 : 0;
          previous = value;
          return value;
        }),
      () => stable >= 3,
      'settled capture',
    );
    const { data } = await connection!.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    const file = path.join(output, name + '.png');
    await writeFile(file, Buffer.from(data, 'base64'));
    captures.push(file);
  };
  await capture('desktop-dark', 1440, 940);
  assert.equal(await evaluate(exists('.trash-breadcrumbs')), false);
  assert.match(await evaluate(textOf('.trash-heading')), /Date added/);
  assert.doesNotMatch(await evaluate(textOf('.trash-heading')), /Date deleted/);
  const ascending = await evaluate(pageCall(trashNames));
  await click('.trash-heading button');
  const descending = await evaluate(pageCall(trashNames));
  assert.deepEqual(descending, ascending.toReversed());
  assert.match(await evaluate(pageCall(sortLabel)), /sorted descending/);
  // Keyboard activation must toggle the same header.
  await evaluate(focus('.trash-heading button'));
  await key('Enter', 'Enter');
  assert.match(await evaluate(pageCall(sortLabel)), /sorted ascending/);
  await evaluate(pageCall(refreshTrash, { dates: 'none' }));
  await until(
    () => evaluate(exists('.trash-inventory.with-date')),
    (found) => !found,
    'missing dates hide unpopulated column',
  );
  await capture('compact-dark-no-dates', 900, 640);
  await click('[data-trash-id="' + '1'.repeat(64) + '"]');
  assert.match(await evaluate(textOf('.trash-origin-details')), /no verified original location/);
  await capture('compact-dark-unknown-origin', 900, 640);
  await click('[data-trash-id="' + '1'.repeat(64) + '"]', 'right');
  await until(() => evaluate(exists('.trash-context-menu')), Boolean, 'unknown metadata menu');
  await evaluate(pageCall(chooseTrashCommand, 'Get Info'));
  await until(
    () => evaluate(exists('.trash-info-dialog')),
    Boolean,
    'unknown metadata information',
  );
  assert.match(await evaluate(textOf('.trash-info-dialog')), /No date was recorded/);
  assert.match(await evaluate(textOf('.trash-info-dialog')), /no verified original location/);
  await capture('compact-dark-unknown-info', 900, 640);
  await evaluate(pressButton('Done', '.trash-info-dialog footer'));
  await evaluate(pageCall(refreshTrash, { dates: 'added' }));
  await until(
    () => evaluate(exists('.trash-inventory.with-date')),
    Boolean,
    'date-added metadata returns',
  );
  await click('[data-trash-id="' + '2'.repeat(64) + '"]');
  assert.equal(
    await evaluate(textOf('.trash-original-path')),
    path.join(originalFolder, 'Build notes.txt'),
  );
  await capture('compact-dark-full-original-path', 900, 640);
  evidence.push(
    'Root has one Trash title and no disabled Back. All four headers sort; Name toggles by pointer and keyboard. macOS date-added metadata is labeled distinctly and an entirely unavailable date column is omitted. Known original paths wrap in selectable detail; unknown Finder-like origins are explicit.',
  );
  const layout = await evaluate(pageCall(footerLayout));
  assert.deepEqual(layout, { centered: true, utilitiesRight: true });
  assert.equal(await evaluate(exists('.trash-footer [aria-haspopup=menu]')), false);
  await evaluate(syntheticClick('.trash-empty'));
  assert.equal(await evaluate(pageCall(confirmations)), 0, 'synthetic empty click is ignored');
  // This trusted button click can reach ONLY the stub above. No native dialog or
  // erasure routine is invoked, and no approval is supplied by this test.
  await click('.trash-empty');
  await until(
    () => evaluate(pageCall(confirmations)),
    (value) => value === 1,
    'native-prompt presenter stub',
  );
  evidence.push(
    'Centered Empty Trash with right-aligned Refresh/Done; synthetic activation rejected; trusted activation reaches only the presenter stub. No native confirmation was invoked.',
  );
  await click('[data-trash-id="' + '2'.repeat(64) + '"]');
  await key('a', 'KeyA', 4);
  assert.equal(await evaluate(countOf('[data-trash-id][aria-selected=true]')), 4);
  await capture('compact-dark-selection', 900, 640);
  await key('Escape', 'Escape');
  await click('[data-trash-id="' + '2'.repeat(64) + '"]', 'right');
  await until(
    () => evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label') || '')),
    (value) => value === 'Search actions',
    'Trash menu focus',
  );
  await capture('compact-dark-context', 900, 640);
  assert.equal(await evaluate(exists('.trash-context-menu .command-result')), true);
  await evaluate(pageCall(chooseTrashCommand, 'Quick Look'));
  await until(
    () => evaluate(exists('.trash-preview-dialog .preview-host')),
    Boolean,
    'scoped Quick Look',
  );
  await capture('desktop-dark-preview', 1440, 940);
  assert.equal(
    await evaluate(countOf('.trash-preview-dialog footer')),
    1,
    'preview has one metadata/actions footer',
  );
  await evaluate(syntheticClick('.trash-preview-dialog header button'));
  await until(
    () => evaluate(exists('.trash-preview-dialog')),
    (found) => !found,
    'preview closes',
  );
  evidence.push(
    'Native renderer selection, Command-A, Escape and right-click Quick Look use the ordinary preview host on generated text.',
  );
  await click('[data-trash-id="' + '1'.repeat(64) + '"]', 'left', 2);
  await until(
    () => evaluate(countOf('[data-trash-id]')),
    (value) => value === 1,
    'folder contents',
  );
  assert.match(await evaluate(textOf('.trash-breadcrumbs')), /Project archive/);
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await capture('compact-light-folder', 900, 640);
  await evaluate(syntheticClick('.trash-breadcrumbs button'));
  await until(
    () => evaluate(countOf('[data-trash-id]')),
    (value) => value === 4,
    'back to Trash',
  );
  await click('[data-trash-id="' + '2'.repeat(64) + '"]', 'right');
  await until(() => evaluate(exists('.trash-context-menu')), Boolean, 'info context menu');
  await evaluate(pageCall(chooseTrashCommand, 'Get Info'));
  await until(() => evaluate(exists('.trash-info-dialog')), Boolean, 'Get Info');
  await capture('compact-light-info', 900, 640);
  assert.match(await evaluate(textOf('.trash-info-dialog')), /Original location/);
  await evaluate(pressButton('Done', '.trash-info-dialog footer'));

  await click('[data-trash-id="' + '2'.repeat(64) + '"]');
  await evaluate(pageCall(restoreSelection, 'collision'));
  await until(
    () => evaluate(textOf('.trash-body [role=alert]')),
    (value) => value.includes('already exists'),
    'safe collision state',
  );
  await capture('compact-light-collision', 900, 640);
  await evaluate(pageCall(restoreSelection, 'normal'));
  await until(
    () => evaluate(countOf('[data-trash-id]')),
    (value) => value === 3,
    'restore stub result',
  );
  evidence.push(
    'Folder navigation/breadcrumbs and restore success/collision states render correctly. Restore calls are stubs; no physical restore is claimed by this UI test.',
  );
  await evaluate(pageCall(refreshTrash, { mode: 'empty' }));
  await until(() => evaluate(exists('.trash-body .empty-state')), Boolean, 'empty state');
  assert.equal(
    await evaluate(
      pageCall(() => document.querySelector<HTMLButtonElement>('.trash-empty')!.disabled),
    ),
    true,
  );
  await capture('compact-light-empty', 900, 640);
  await evaluate(pageCall(refreshTrash, { mode: 'normal' }));
  await until(
    () => evaluate(countOf('[data-trash-id]')),
    (value) => value === 3,
    'restored fixture inventory',
  );
  await click('[data-trash-id="' + '4'.repeat(64) + '"]');
  await evaluate(syntheticClick('.trash-origin-details button'));
  await until(
    () => evaluate(textOf('.trash-body [role=alert]')),
    (value) => value.includes('original folder no longer exists'),
    'missing original parent feedback',
  );
  await capture('compact-light-missing-original-folder', 900, 640);
  // Restore the fixture inventory only, then open a real generated parent as a
  // root plane through the ordinary workspace navigation (no shell or mutation).
  await evaluate(
    pageCall(refreshTrash, {
      add: {
        id: '2'.repeat(64),
        name: 'Build notes.txt',
        directory: false,
        previewable: true,
        size: 1040,
        location: 'Home',
        originalPath: path.join(originalFolder, 'Build notes.txt'),
      },
    }),
  );
  await until(
    () => evaluate(countOf('[data-trash-id]')),
    (value) => value === 4,
    'known origin fixture',
  );
  await click('[data-trash-id="' + '2'.repeat(64) + '"]');
  await evaluate(syntheticClick('.trash-origin-details button'));
  await until(
    () => evaluate(exists('.trash-dialog')),
    (found) => !found,
    'original folder opens and Trash closes',
  );
  await until(
    () => evaluate(pageCall(planeLabels)),
    (values) => values.includes(`Folder ${originalFolder}`),
    'actual original folder plane',
  );
  await capture('compact-light-original-folder-plane', 900, 640);
  evidence.push(
    'Open original folder reports a missing parent without closing Trash; a known generated original parent opens in an actual root folder plane and closes Trash. No files were restored, trashed or erased.',
  );
  assert.equal(await readFile(note, 'utf8'), contents);
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        binary,
        root,
        evidence,
        captures,
        scope:
          'Owned macOS renderer with generated file preview and UI-only Trash stubs. No system Trash listing, confirmation, physical restore or erasure. All generated files retained.',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS Trash folder interactions, preview, footer, collision/empty states and synthetic-click guard.',
  );
  console.log('Evidence:', output);
} catch (error) {
  if (connection) {
    console.log('Failure state:', await evaluate(pageCall(failureState)));
    const shot = await connection.command<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(path.join(output, 'failure.png'), Buffer.from(shot.data, 'base64'));
    console.log('Failure evidence:', output);
  }
  throw error;
} finally {
  await app.close(connection);
  console.log('Generated fixtures preserved:', root);
}
