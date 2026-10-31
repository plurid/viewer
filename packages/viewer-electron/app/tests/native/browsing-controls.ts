/** Owned renderer checks. Trash operations are intercepted before any confirmation is exercised. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SavedState } from '../../src/domain/contracts';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { pageCall } from './runtime/page-function';
import { click, exists, patchSettings } from './runtime/page';
import { pathAncestry } from '../../src/domain/files/paths';
import { restoreClipboard } from './runtime/clipboard';

const root = await temporaryRoot('viewer-browsing-controls-');
const profile = path.join(root, 'Profile');
const folder = path.join(root, 'Projects', 'Models');
await mkdir(profile);
await mkdir(folder, { recursive: true });
const outputFolder = path.join(root, 'Copies');
await mkdir(outputFolder);
const sibling = path.join(root, 'Projects', 'Other');
await mkdir(sibling);
const longFolder = path.join(folder, 'Archive '.repeat(24).trim());
await mkdir(longFolder);
const file = path.join(folder, 'Review notes.txt');
await writeFile(file, 'Retain this generated file.\n');
const state: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'browsing',
  workspaceVisits: {
    second: 9999,
    ...Object.fromEntries(Array.from({ length: 998 }, (_, index) => [`extra-${index}`, index + 1])),
  },
  favorites: [{ path: folder, name: 'Models' }],
  recents: [],
  workspaces: [
    {
      id: 'browsing',
      name: 'Browsing controls',
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
    { id: 'second', name: 'Second workspace', roots: [], panes: [], arrangement: {} },
    ...Array.from({ length: 998 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Workspace ${String(index).padStart(4, '0')}`,
      roots: [],
      panes: [],
      arrangement: {},
    })),
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/ui-round-20261031/Viewer.app/Contents/MacOS/Viewer');
const app = await ownedApp(binary, profile, { label: 'browsing-controls', mode: 'foreground' });
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const actions = new NativeInteractions({ evaluate, command, until });
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const freeze = Object.freeze;
      Object.freeze = object => object && typeof object.operate === 'function' && typeof object.bootstrap === 'function' ? object : freeze(object);
    })();`,
  });
  await command('Page.reload', { ignoreCache: true });
  await until(
    () => evaluate(exists('[data-file-owner="folder"] [data-file-path]')),
    Boolean,
    'folder listing',
  );
  await evaluate(
    pageCall(() => {
      if (Object.isFrozen(window.viewer)) throw new Error('Trash stub cannot be installed.');
      Object.assign(window, { __trashRequests: [] });
      const operate = window.viewer.operate;
      window.viewer.operate = async (request) => {
        if (request.kind === 'copy') return operate(request);
        if (request.kind !== 'trash') throw new Error('Only the mocked Trash action is expected.');
        (window as unknown as { __trashRequests: unknown[] }).__trashRequests.push(request);
        return 'mock-trash';
      };
    }),
  );
  const requests = () =>
    evaluate(pageCall(() => (window as unknown as { __trashRequests: unknown[] }).__trashRequests));
  await evaluate(click('[data-file-path=' + JSON.stringify(file) + ']'));
  await actions.palette('Move to Trash');
  await until(
    () => evaluate(exists('dialog[aria-label="Move to Trash?"]')),
    Boolean,
    'Trash confirmation',
  );
  const geometry = await evaluate(
    pageCall(() => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
      const rect = dialog.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        focus: document.activeElement?.outerHTML,
        text: dialog.textContent,
      };
    }),
  );
  await actions.capture(path.join(app.evidenceDirectory, 'trash-confirmation.png'));
  await actions.key('Enter', 'Enter');
  const result = {
    geometry,
    requests: await requests(),
    open: await evaluate(exists('dialog[open]')),
  };
  await writeFile(
    path.join(app.evidenceDirectory, 'trash-result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ evidence: app.evidenceDirectory, ...result }));
  if (!process.argv.includes('--repro')) {
    assert.ok(
      geometry.width <= 480 && geometry.height < 300,
      'Confirmation fits its short content',
    );
    assert.equal(result.requests.length, 1, 'Enter dispatches one mocked Trash action');
    assert.equal(result.open, false, 'Enter closes the confirmation');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(click('[data-file-path=' + JSON.stringify(longFolder) + ']'));
    await actions.palette('Move to Trash');
    await until(
      () => evaluate(exists('dialog[aria-label="Move to Trash?"]')),
      Boolean,
      'Long folder confirmation',
    );
    assert.equal(
      await evaluate(
        pageCall(() => {
          const dialog = document.querySelector('dialog[open]')!;
          const box = dialog.getBoundingClientRect(),
            footer = dialog.querySelector('footer')!.getBoundingClientRect();
          return (
            box.width <= 480 &&
            box.height < 400 &&
            box.top >= 0 &&
            box.bottom <= innerHeight &&
            footer.bottom <= box.bottom
          );
        }),
      ),
      true,
      'Long folder name wraps and footer stays visible',
    );
    await actions.capture(path.join(app.evidenceDirectory, 'trash-long-folder-900.png'));
    await actions.key('Escape', 'Escape');
    assert.equal((await requests()).length, 1, 'Escape cancels without another Trash action');
    await command('Emulation.clearDeviceMetricsOverride');
    assert.equal(
      await evaluate(exists('.app-titlebar [aria-label="Ask Viewer by voice"]')),
      false,
      'Default title bar hides the microphone',
    );
    const neutralPress = async (selector: string, menu: boolean) => {
      const point = await evaluate(
        pageCall((selector: string) => {
          const rect = document.querySelector(selector)!.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }, selector),
      );
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      const colors = () =>
        evaluate(
          pageCall((selector: string) => {
            const style = getComputedStyle(document.querySelector(selector)!);
            return { background: style.backgroundColor, color: style.color };
          }, selector),
        );
      const hover = await colors();
      await command('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...point,
      });
      const pressed = await colors();
      const raised = await evaluate(
        pageCall((selector: string) => {
          const probe = document.createElement('span');
          probe.style.background = 'var(--raised)';
          probe.hidden = true;
          document.querySelector(selector)!.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        }, selector),
      );
      assert.ok(
        [raised, 'rgba(0, 0, 0, 0)'].includes(pressed.background),
        'Neutral mouse-down background: ' + selector,
      );
      assert.equal(pressed.color, hover.color, 'No accent text flash: ' + selector);
      await command('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...point,
      });
      if (menu) await actions.key('Escape', 'Escape');
    };
    await neutralPress('[aria-label="View mode"]', true);
    await neutralPress('[aria-label="Workspace"]', true);
    await neutralPress('section[aria-label="Locations"] .sidebar-section-title', false);
    await actions.click('section[aria-label="Locations"] .sidebar-section-title');
    const divider = await evaluate(
      pageCall(() => {
        const divider = document.querySelector('.sidebar-resizer')!;
        return {
          hit: getComputedStyle(divider).width,
          line: getComputedStyle(divider, '::after').width,
        };
      }),
    );
    assert.deepEqual(divider, { hit: '6px', line: '2px' });
    await actions.click('[aria-label="Search this folder"]');
    assert.equal(
      await evaluate(
        pageCall(() =>
          document.querySelector('.search-row')!.textContent.includes('Search contents'),
        ),
      ),
      false,
    );
    await actions.capture(path.join(app.evidenceDirectory, 'folder-search.png'));
    await actions.click('.search-row [aria-label="Close search"]');
    await actions.palette('Columns view');
    const columnPaths = () =>
      evaluate(
        pageCall(() =>
          [...document.querySelectorAll<HTMLElement>('.file-column')].map(
            (column) => column.dataset.folderPath,
          ),
        ),
      );
    await until(
      columnPaths,
      (paths) => JSON.stringify(paths) === JSON.stringify(pathAncestry(folder)),
      'All ancestor columns',
    );
    await until(
      () =>
        evaluate(
          pageCall((folder: string) => {
            const view = document.querySelector('.columns-view')!.getBoundingClientRect();
            const current = [...document.querySelectorAll<HTMLElement>('.file-column')]
              .find((column) => column.dataset.folderPath === folder)!
              .getBoundingClientRect();
            return current.left >= view.left && current.right <= view.right + 1;
          }, folder),
        ),
      Boolean,
      'Current folder scrolled into view',
    );
    await actions.capture(path.join(app.evidenceDirectory, 'columns.png'));
    await evaluate(click('[data-file-path=' + JSON.stringify(sibling) + ']'));
    await until(columnPaths, (paths) => paths.at(-1) === sibling, 'Branch from an ancestor');
    await actions.palette('List view');
    await until(
      () => evaluate(exists('[aria-label=' + JSON.stringify('Folder ' + sibling) + ']')),
      Boolean,
      'List opens the chosen column',
    );

    await evaluate(
      pageCall(() => {
        document
          .querySelector('section[aria-label="Favorites"] .location')!
          .dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 400 }),
          );
      }),
    );
    await until(
      () => evaluate(exists('[data-menu-id="suggested.shortcut-remove"]')),
      Boolean,
      'Suggested favorite removal',
    );
    await actions.capture(path.join(app.evidenceDirectory, 'favorite-menu.png'));
    await actions.click('[data-menu-id="suggested.shortcut-remove"]');
    await until(
      () => evaluate(exists('section[aria-label="Favorites"] .location')),
      (present) => !present,
      'Favorite removed',
    );
    assert.equal(await readFile(file, 'utf8'), 'Retain this generated file.\n');

    await actions.click('[aria-label="Workspace"]');
    await until(
      () => evaluate(exists('[data-menu-id="workspace:second"]')),
      Boolean,
      'Workspace appears directly',
    );
    assert.equal(
      await evaluate(exists('[role="menuitem"][aria-haspopup="menu"]')),
      true,
      'Workspace menu retains command groups',
    );
    assert.equal(
      await evaluate(
        pageCall(() => document.querySelectorAll('[data-menu-id^="workspace:"]').length),
      ),
      5,
    );
    await actions.capture(path.join(app.evidenceDirectory, 'workspaces.png'));
    await actions.click('[data-menu-id="manage-workspaces"]');
    await until(() => evaluate(exists('.workspace-catalog-list')), Boolean, 'Workspace manager');
    assert.equal(
      await evaluate(
        pageCall(() => document.querySelectorAll('.workspace-catalog-list li').length),
      ),
      25,
    );
    await actions.click('[aria-label="Next workspace page"]');
    assert.equal(
      await evaluate(
        pageCall(() =>
          document.querySelector('[aria-label="Workspace pages"]')!.textContent.includes('2 / 40'),
        ),
      ),
      true,
    );
    await actions.field('Search workspaces', 'Workspace 0997');
    await until(
      () =>
        evaluate(pageCall(() => document.querySelectorAll('.workspace-catalog-list li').length)),
      (count) => count === 1,
      'Search across all workspaces',
    );
    await actions.click('[aria-label="Rename Workspace 0997"]');
    await until(
      () => evaluate(exists('dialog[aria-label="Rename workspace"]')),
      Boolean,
      'Rename dialog',
    );
    await actions.text('dialog[aria-label="Rename workspace"] input', 'Design archive');
    await actions.button('Rename', 'dialog[aria-label="Rename workspace"]');
    await until(
      () => evaluate(exists('.workspace-catalog-list')),
      Boolean,
      'Return to manager after rename',
    );
    await actions.field('Search workspaces', 'Design archive');
    await until(
      () => evaluate(exists('[aria-label="Delete Design archive"]')),
      Boolean,
      'Renamed workspace searchable',
    );
    await actions.click('[aria-label="Delete Design archive"]');
    await until(
      () => evaluate(exists('dialog[aria-label="Delete workspace?"]')),
      Boolean,
      'Delete workspace review',
    );
    await actions.button('Delete workspace', 'dialog[aria-label="Delete workspace?"]');
    await until(
      () => evaluate(exists('.workspace-catalog-list')),
      Boolean,
      'Return to manager after deleting only the generated layout',
    );
    await actions.capture(path.join(app.evidenceDirectory, 'workspace-manager.png'));
    await command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const managerFit = await evaluate(
      pageCall(() => {
        const dialog = document.querySelector('.workspaces-dialog')!.getBoundingClientRect();
        const footer = document
          .querySelector('.workspaces-dialog > footer')!
          .getBoundingClientRect();
        return {
          top: dialog.top,
          bottom: dialog.bottom,
          footer: footer.bottom,
          viewport: window.innerHeight,
        };
      }),
    );
    assert.ok(
      managerFit.top >= 0 &&
        managerFit.bottom <= managerFit.viewport &&
        managerFit.footer <= managerFit.bottom,
    );
    await actions.capture(path.join(app.evidenceDirectory, 'workspace-manager-compact.png'));
    await command('Emulation.clearDeviceMetricsOverride');
    await actions.key('Escape', 'Escape');
    await actions.click('[aria-label="Workspace"]');
    await actions.click('[data-menu-id="workspace:second"]');
    await until(
      () => evaluate(pageCall(() => document.querySelector('.workspace-switcher')!.textContent)),
      (text) => text === 'Second workspace',
      'Workspace switched',
    );
    const copied = await evaluate(
      pageCall(
        (source: string, destination: string) =>
          window.viewer.operate({ kind: 'copy', sources: [source], destination }),
        file,
        outputFolder,
      ),
    );
    await until(
      () => evaluate(pageCall(() => window.viewer.jobs())),
      (jobs) => jobs.some((job) => job.id === copied && job.status === 'completed'),
      'Fixture copy completed',
    );
    const pending = await evaluate(
      pageCall(
        (source: string, destination: string) =>
          window.viewer.operate({ kind: 'copy', sources: [source], destination }),
        file,
        outputFolder,
      ),
    );
    await until(
      () => evaluate(pageCall(() => window.viewer.jobs())),
      (jobs) => jobs.some((job) => job.id === pending && job.status === 'collision'),
      'Fixture collision remains pending',
    );
    await until(() => evaluate(exists('.operations-panel')), Boolean, 'Operations panel');
    await actions.button('Clear all', '.operations-panel');
    await until(
      () => evaluate(pageCall(() => window.viewer.jobs())),
      (jobs) => !!jobs.find((job) => job.id === copied)?.dismissed,
      'Finished operation dismissed',
    );
    const jobs = await evaluate(pageCall(() => window.viewer.jobs()));
    assert.equal(jobs.find((job) => job.id === copied)?.undoable, true);
    assert.equal(jobs.find((job) => job.id === pending)?.dismissed, undefined);
    assert.equal(jobs.find((job) => job.id === pending)?.status, 'collision');
    assert.equal(
      await evaluate(
        pageCall(() => document.querySelectorAll('.operations-panel .operation').length),
      ),
      1,
    );
    await actions.capture(path.join(app.evidenceDirectory, 'operations-cleared.png'));
    await actions.button('Skip', '.operations-panel');
    await until(
      () => evaluate(pageCall(() => window.viewer.jobs())),
      (jobs) => jobs.find((job) => job.id === pending)?.status === 'completed',
      'Collision skipped without modifying files',
    );
    if (await evaluate(exists('.operations-panel')))
      await actions.click('[aria-label="Close operations"]');
    await command('Page.reload', { ignoreCache: true });
    await until(() => evaluate(exists('[aria-label="Workspace"]')), Boolean, 'Reloaded app');
    assert.equal(
      (await evaluate(pageCall(() => window.viewer.jobs()))).find((job) => job.id === copied)
        ?.dismissed,
      true,
    );
    await actions.click('[aria-label="Workspace"]');
    assert.equal(
      await evaluate(
        pageCall(() =>
          document.querySelector('[data-menu-id^="workspace:"]')!.getAttribute('data-menu-id'),
        ),
      ),
      'workspace:second',
    );
    await actions.key('Escape', 'Escape');
    await actions.palette('Settings');
    const settings = await app.connect(true);
    await settings.evaluate(
      pageCall(() =>
        [...document.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => button.textContent.trim() === 'Space')!
          .click(),
      ),
    );
    await until(
      () => settings.evaluate(exists('[data-setting-path="ui.titlebar.voice"]')),
      Boolean,
      'Title bar icon setting',
    );
    for (const key of ['navigation', 'newPlane', 'operations', 'voice', 'commands'])
      assert.equal(
        await settings.evaluate(exists(`[data-setting-path="ui.titlebar.${key}"]`)),
        true,
      );
    await settings.evaluate(click('[data-setting-path="ui.titlebar.voice"] input'));
    await until(
      () => evaluate(exists('.app-titlebar [aria-label="Ask Viewer by voice"]')),
      Boolean,
      'Microphone toggle applies',
    );
    await settings.evaluate(
      patchSettings(
        { path: 'ui.titlebar.navigation', value: false },
        { path: 'ui.titlebar.newPlane', value: false },
        { path: 'ui.titlebar.commands', value: false },
        { path: 'ui.titlebar.voice', value: false },
      ),
    );
    await until(
      () =>
        evaluate(pageCall(() => document.querySelectorAll('.app-titlebar .icon-button').length)),
      (count) => count === 0,
      'Optional icons can all be hidden',
    );
    await settings.evaluate(pageCall(() => window.close()));
    await actions.key('k', 'KeyK', 4);
    await until(
      () => evaluate(exists('[aria-label="Search commands"]')),
      Boolean,
      'Commands shortcut still works with icon hidden',
    );
    await actions.key('Escape', 'Escape');

    const native = promisify(execFile);
    const snapshot = (
      await native(
        '/usr/bin/osascript',
        [
          '-l',
          'JavaScript',
          '-e',
          `
      ObjC.import('AppKit');
      const items = $.NSPasteboard.generalPasteboard.pasteboardItems, saved = [];
      for (let i = 0; i < items.count; i++) {
        const item = items.objectAtIndex(i), fields = [];
        for (let j = 0; j < item.types.count; j++) {
          const type = ObjC.unwrap(item.types.objectAtIndex(j)), data = item.dataForType(type);
          if (data) fields.push([type, ObjC.unwrap(data.base64EncodedStringWithOptions(0))]);
        }
        saved.push(fields);
      }
      JSON.stringify(saved);
    `,
        ],
        { maxBuffer: 32 * 1024 * 1024 },
      )
    ).stdout;
    const output = 'Applications\nModel α: completed\n';
    let copiedText = '';
    try {
      await evaluate(pageCall((file: string) => window.viewer.clipboardWrite([file], true), file));
      copiedText = file;
      await evaluate(pageCall((text: string) => window.viewer.clipboardWriteText(text), output));
      copiedText = output;
      const encoded = (
        await native('/usr/bin/osascript', [
          '-l',
          'JavaScript',
          '-e',
          `
        ObjC.import('AppKit');
        ObjC.import('Foundation');
        const text = $.NSPasteboard.generalPasteboard.stringForType('public.utf8-plain-text');
        ObjC.unwrap(text.dataUsingEncoding($.NSUTF8StringEncoding).base64EncodedStringWithOptions(0));
      `,
        ])
      ).stdout.trim();
      assert.equal(
        Buffer.from(encoded, 'base64').toString('utf8') === output,
        true,
        'Desktop copies exact Unicode output',
      );
      assert.equal(
        await evaluate(pageCall(() => window.viewer.clipboardRead())),
        null,
        'Text copy clears a previous cut',
      );
    } finally {
      if (copiedText) await restoreClipboard(snapshot, copiedText);
    }
    console.log(
      'Columns, Favorites, workspace switching, Settings icons and native text copy passed.',
    );
  }
  assert.equal(await readFile(file, 'utf8'), 'Retain this generated file.\n');
} finally {
  await app.close(connection);
}
