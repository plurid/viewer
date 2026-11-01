/** Real window-owned dialogs with generated files; no provider calls or removals. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { pageCall } from './runtime/page-function';
import { click, exists, patchSettings, pressButton, valueOf } from './runtime/page';
import { screenshot } from '../../tools/docs/record';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await realpath(await temporaryRoot('viewer-native-dialogs-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
await mkdir(path.join(root, 'Drawings'));
await writeFile(path.join(root, 'First.pdf'), 'PDF selection fixture', { flag: 'wx' });
await writeFile(path.join(root, 'Second.pdf'), 'PDF selection fixture', { flag: 'wx' });
await writeFile(path.join(root, 'Notes.txt'), 'Keep the original.', { flag: 'wx' });
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'dialogs',
  favorites: [{ name: 'Sample project', path: root }],
  recents: [],
  look: 'dark',
  workspaces: [{ id: 'dialogs', name: 'Dialog checks', panes: [], roots: [], arrangement: {} }],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const checks: string[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>> | undefined;
try {
  app = await ownedApp(binary, profile, {
    label: 'viewer-dialogs',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  const page = main;
  const ready = () =>
    until(
      () =>
        page.evaluate(exists('.viewer-file-picker[open] .file-picker-files[aria-busy="false"]')),
      Boolean,
      'Viewer chooser ready',
    );
  const type = async (selector: string, text: string) => {
    await page.evaluate(
      pageCall((selector) => {
        const input = document.querySelector<HTMLInputElement>(selector)!;
        input.focus();
        input.select();
      }, selector),
    );
    await page.command('Input.insertText', { text });
  };
  const enter = async () => {
    await page.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    });
    await page.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
  };
  const chooseFolder = async () => {
    await page.evaluate(
      pageCall((root) => {
        document.body.dataset.folder = 'pending';
        void window.viewer.chooseFolder(root).then((value) => {
          document.body.dataset.folder = value ?? 'cancelled';
        });
      }, root),
    );
    await ready();
  };
  await chooseFolder();
  await screenshot(page, path.join(root, 'folder-wide-dark.png'));
  await page.evaluate(click('.file-picker-row[title="Drawings"]'));
  await page.evaluate(click('.file-picker-files'));
  await page.evaluate(pressButton('Choose folder', '.viewer-file-picker footer'));
  await until(
    () => page.evaluate(pageCall(() => document.body.dataset.folder)),
    (value) => value === root,
    'current folder selected',
  );
  checks.push('current directory selection resolves through the desktop API');

  await chooseFolder();
  await page.evaluate(click('.viewer-file-picker [aria-label="New folder"]'));
  await type('[aria-label="New folder name"]', 'Exports');
  await page.evaluate(pressButton('Create', '.file-picker-new-folder'));
  await until(
    () => page.evaluate(valueOf('[aria-label="Folder path"]')),
    (value) => value === path.join(root, 'Exports'),
    'created directory shown',
  );
  await page.evaluate(pressButton('Cancel', '.viewer-file-picker footer'));
  await until(
    () => page.evaluate(pageCall(() => document.body.dataset.folder)),
    (value) => value === 'cancelled',
    'cancel resolves',
  );
  assert.deepEqual(await readFile(path.join(root, 'Notes.txt'), 'utf8'), 'Keep the original.');
  checks.push('new-folder creation and cancellation preserve existing files');

  await page.evaluate(
    pageCall(() => {
      void window.viewer.choosePDFs().then((value) => {
        document.body.dataset.pdfs = JSON.stringify(value);
      });
    }),
  );
  await ready();
  await type('[aria-label="Folder path"]', root);
  await enter();
  await until(
    () => page.evaluate(exists('.viewer-file-picker [role="option"][title="First.pdf"]')),
    Boolean,
    'filtered files visible',
  );
  await page.evaluate(
    pageCall(() => {
      const list = document.querySelector<HTMLElement>('.file-picker-files')!;
      list.focus();
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    }),
  );
  await page.evaluate(pressButton('Open', '.viewer-file-picker footer'));
  const selected = await until(
    () => page.evaluate(pageCall(() => document.body.dataset.pdfs)),
    Boolean,
    'PDF selection returned',
  );
  assert.deepEqual(JSON.parse(selected!), [
    path.join(root, 'First.pdf'),
    path.join(root, 'Second.pdf'),
  ]);
  checks.push('multiple selection respects PDF filtering and excludes folders');

  const output = path.join(root, 'Report.txt');
  await page.evaluate(
    pageCall(
      (output, session) => {
        void window.viewer.textSaveAs('Saved through Viewer.\n', output, session).then((value) => {
          document.body.dataset.saved = value?.file ?? 'cancelled';
        });
      },
      output,
      randomUUID(),
    ),
  );
  await ready();
  assert.equal(
    await page.evaluate(
      pageCall(() => document.activeElement?.closest('.file-picker-name') !== null),
    ),
    true,
  );
  await screenshot(page, path.join(root, 'save-wide-dark.png'));
  await page.command('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot(page, path.join(root, 'save-narrow-dark.png'));
  await page.evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => page.evaluate(pageCall(() => document.documentElement.dataset.look)),
    (value) => value === 'light',
    'light appearance',
  );
  await screenshot(page, path.join(root, 'save-narrow-light.png'));
  const fits = await page.evaluate(
    pageCall(() => {
      const rect = document.querySelector('.viewer-file-picker')!.getBoundingClientRect();
      return {
        within:
          rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
        overflow: document.querySelector('.viewer-file-picker')!.scrollWidth > rect.width + 1,
      };
    }),
  );
  assert.deepEqual(fits, { within: true, overflow: false });
  await enter();
  await until(
    () => readFile(output, 'utf8').catch(() => ''),
    (text) => text === 'Saved through Viewer.\n',
    'saved bytes',
  );
  checks.push(
    'Save As selects filename, fits narrow light/dark windows and saves exact bytes with Enter',
  );

  await page.evaluate(
    pageCall(() => {
      void window.viewer.textPrompt('close', 'Report.txt').then((value) => {
        document.body.dataset.answer = value;
      });
    }),
  );
  await until(
    () => page.evaluate(exists('.viewer-message-dialog[open]')),
    Boolean,
    'save changes dialog',
  );
  await screenshot(page, path.join(root, 'save-changes.png'));
  const actions = await page.evaluate(
    pageCall(() => {
      const primary = document.querySelector<HTMLElement>('.viewer-message-dialog button.primary')!;
      const danger = document.querySelector<HTMLElement>('.viewer-message-dialog button.danger')!;
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      primary.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return {
        primary: getComputedStyle(primary).backgroundColor === accent,
        destructive: danger.textContent,
      };
    }),
  );
  assert.deepEqual(actions, { primary: true, destructive: 'Don’t Save' });
  await page.evaluate(pressButton('Cancel', '.viewer-message-dialog'));
  await until(
    () => page.evaluate(pageCall(() => document.body.dataset.answer)),
    (value) => value === 'cancel',
    'editor cancel',
  );
  checks.push('editor save warning uses the shared Viewer dialog');

  await page.evaluate(pageCall(() => window.viewer.openSettings()));
  const preferences = await app.connect(true);
  await preferences.evaluate(
    pageCall(() => {
      void window.viewer.configTransfer('export');
    }),
  );
  await until(
    () => preferences.evaluate(exists('.viewer-file-picker[open]')),
    Boolean,
    'Settings chooser',
  );
  assert.equal(await page.evaluate(exists('.viewer-file-picker[open]')), false);
  const pending = await preferences.evaluate(
    pageCall(() => window.viewer.dialog({ kind: 'current' })),
  );
  assert.ok(pending.prompt);
  await assert.rejects(
    page.evaluate(
      pageCall((id) => window.viewer.dialog({ kind: 'cancel', id }), pending.prompt.id),
    ),
    /no longer open/,
  );
  await preferences.evaluate(pressButton('Cancel', '.viewer-file-picker footer'));
  checks.push('Settings owns its chooser; another window cannot answer it');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ passed: true, binary, root, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, root, checks }, null, 2));
} catch (error) {
  if (main) await screenshot(main, path.join(root, 'failure.png')).catch(() => {});
  await writeFile(path.join(root, 'failure.txt'), String(error));
  console.error('Retained dialog evidence:', root);
  throw error;
} finally {
  if (app) await app.close(main);
}
