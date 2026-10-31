/** Plane header geometry and folder shortcuts, using an owned fixture without file removal. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../../src/domain/contracts';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { pageCall } from './runtime/page-function';
import { exists, patchSettings } from './runtime/page';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const root = await temporaryRoot('viewer-plane-chrome-');
const profile = path.join(root, 'Profile');
const folder = path.join(root, 'Files');
await mkdir(profile);
await mkdir(folder);
await writeFile(path.join(folder, 'Example.txt'), 'Preserved header geometry fixture.\n');
const state: SavedState = {
  version: 11,
  activeWorkspace: 'chrome',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'chrome',
      name: 'Plane chrome',
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
const app = await ownedApp(process.env.VIEWER_TEST_BINARY, profile, { label: 'plane-chrome' });
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const actions = new NativeInteractions({ evaluate, command, until });
  await until(() => evaluate(exists('.file-head')), Boolean, 'Folder list');
  const geometry = () =>
    evaluate(
      pageCall(() => {
        const content = document
          .querySelector<HTMLElement>('[data-file-owner="folder"]')!
          .closest<HTMLElement>('.folder-plane')!;
        const plane = content.closest<HTMLElement>('[data-plurid-plane]')!;
        const header = plane.querySelector<HTMLElement>('.plane-controls');
        const scale = plane.getBoundingClientRect().height / plane.offsetHeight;
        const top = header?.getBoundingClientRect().bottom ?? plane.getBoundingClientRect().top;
        return {
          gap: (content.getBoundingClientRect().top - top) / scale,
          headerHeight: header?.offsetHeight ?? 0,
          rows: getComputedStyle(plane).gridTemplateRows,
          scroll: content.scrollHeight,
          height: content.clientHeight,
        };
      }),
    );
  const results: Record<string, unknown> = {};
  const check = async (name: string, headers = true) => {
    const actual = await until(
      geometry,
      (value) => Math.abs(value.gap) < 0.5 && value.headerHeight === (headers ? 40 : 0),
      name,
    );
    results[name] = actual;
    assert.ok(actual.scroll <= actual.height + 1, 'No outer content overflow in ' + name);
  };
  if (process.env.VIEWER_TEST_REPRODUCE_GAP === '1') {
    const original = await geometry();
    assert.ok(Math.abs(original.gap - 16) < 0.5, JSON.stringify(original));
    console.log(JSON.stringify({ reproduced: original }));
  } else {
    await check('spatial list');
    await actions.capture(path.join(app.evidenceDirectory, 'spatial-list.png'));
    await actions.palette('Dock plane');
    await check('docked list');
    await actions.capture(path.join(app.evidenceDirectory, 'docked-list.png'));
    await actions.palette('Columns view');
    await check('docked columns');
    await evaluate(patchSettings({ path: 'ui.space.planeHeaders', value: false }));
    await check('hidden header', false);
    await evaluate(patchSettings({ path: 'ui.space.planeHeaders', value: true }));
    await check('restored header');
    await actions.palette('List view');
    await evaluate(
      pageCall(() => document.querySelector<HTMLElement>('.folder-explorer')!.focus()),
    );
    await actions.key('n', 'KeyN', 4);
    await until(
      () => evaluate(exists('dialog[aria-label="New folder"]')),
      Boolean,
      'Command N opens New folder',
    );
    assert.equal(
      await evaluate(pageCall(() => document.querySelectorAll('[data-plurid-plane]').length)),
      1,
    );
    await actions.key('Escape', 'Escape');
    await evaluate(
      pageCall(() => document.querySelector<HTMLElement>('.folder-explorer')!.focus()),
    );
    await actions.key('N', 'KeyN', 12);
    await until(
      () => evaluate(pageCall(() => document.querySelectorAll('[data-plurid-plane]').length)),
      (count) => count === 2,
      'Shift Command N opens a plane',
    );
    assert.equal(await evaluate(exists('dialog[open]')), false);
    assert.equal(await evaluate(exists('[aria-label="New folder plane (⇧⌘N)"]')), true);
    await actions.click('[aria-label="Commands (⌘K)"]');
    await actions.field('Search commands', 'New folder');
    const shortcuts = await evaluate(
      pageCall(() =>
        Object.fromEntries(
          [...document.querySelectorAll('.command-result')].map((row) => [
            row.querySelector('.command-result-text > span')?.textContent,
            row.querySelector('kbd')?.textContent,
          ]),
        ),
      ),
    );
    assert.equal(shortcuts['New folder…'], '⌘N');
    assert.equal(shortcuts['New folder plane'], '⇧⌘N');
    await actions.key('Escape', 'Escape');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await check('compact window');
    await actions.capture(path.join(app.evidenceDirectory, 'compact-window.png'));
    await writeFile(
      path.join(app.evidenceDirectory, 'geometry.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify({ passed: results, evidence: app.evidenceDirectory }));
  }
} catch (error) {
  console.error('Plane chrome scenario failed:', error);
  if (connection) {
    await writeFile(
      path.join(app.evidenceDirectory, 'failure.txt'),
      await connection.evaluate(pageCall(() => document.body.innerText)),
    );
  }
  throw error;
} finally {
  await app.close(connection);
}
