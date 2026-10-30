/** One continuous file journey in a real packaged app, followed by a cold restart.
 * Edits remain a draft; exports create new files. No fixture is removed or replaced. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { sizedImageFixture } from '../fixtures';
import { workbenchPDF } from '../pdf-fixtures';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { countOf, exists, focus, textOf, valueOf } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary, 'Choose the packaged candidate.');
const root = await realpath(await temporaryRoot('viewer-native-file-workflow-'));
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const needle = 'velvet engine orchard';
const draft = 'This unsaved edit survives a full restart.';
const note = path.join(files, 'Journal.txt');
const photo = path.join(files, 'Photo.png');
const book = path.join(files, 'Manual.pdf');
const output = path.join(files, 'Photo converted.webp');
const original =
  `${needle}\n` + Array.from({ length: 120 }, (_, index) => `Project note ${index}.`).join('\n');
await writeFile(note, original, { flag: 'wx' });
await writeFile(photo, sizedImageFixture(192, 128), { flag: 'wx' });
await writeFile(book, workbenchPDF(['Page one', 'Page two', 'Page three']), { flag: 'wx' });
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const before = await Promise.all([note, photo, book].map(hash));
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
settings.search.roots = [files];
settings.search.contentRoots = [files];
const ui = normalizePreferences();
ui.space.opening = 'dock';
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'files',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'files',
      name: 'Complete file workflow',
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
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(state), { flag: 'wx' });
const saved = async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
const checks: string[] = [];
let outputHash: string | undefined;
let bufferID: string | undefined;
let exportID: string | undefined;

const listJobs = () => window.viewer.jobs();
const canvasDrawn = (selector: string) =>
  !!document.querySelector<HTMLCanvasElement>(selector)?.width;
const paletteText = () =>
  document.querySelector('.command-results')?.textContent ||
  document.querySelector('.command-palette')?.textContent ||
  '';

function doubleClick(selector: string): void {
  document.querySelector(selector)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

/** The decoded size of the image viewer's picture, or zero before it loads. */
function imageSize() {
  const image = document.querySelector<HTMLImageElement>('.image-viewer img');
  return { width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 };
}

for (let launch = 0; launch < 2; launch++) {
  const app = await ownedApp(binary, profile);
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    const { evaluate, command } = connection;
    const actions = new NativeInteractions({ evaluate, command, until });
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 940,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const choose = async (name: string) => {
      const selector = '[data-file-path=' + JSON.stringify(path.join(files, name)) + ']';
      await actions.click('.folder-explorer:not(.search-explorer) ' + selector);
      await evaluate(focus('.folder-explorer:not(.search-explorer)'));
    };
    const open = async (name: string) => {
      await actions.palette('Files');
      await choose(name);
      await actions.key(' ', 'Space');
      await actions.button('Open linked plane', '.quick-preview-dialog');
    };
    const readyPDF = () =>
      until(
        () => evaluate(pageCall(canvasDrawn, '.pdf-viewer canvas')),
        Boolean,
        'Rendered PDF',
        30000,
      );

    if (launch === 0) {
      await until(
        () => evaluate(countOf('[data-file-path]')),
        (count) => count === 3,
        'Initial folder',
      );
      await actions.palette('Find file');
      await actions.click('.search-content-option input');
      await actions.field('Find file by name', needle);
      await until(
        () => evaluate(pageCall(paletteText)),
        (text) => text.includes('Journal.txt'),
        'Content-only match',
        30000,
      );
      await actions.button('Open results');
      const match = '.search-explorer [data-file-path=' + JSON.stringify(note) + ']';
      await until(() => evaluate(exists(match)), Boolean, 'Content result row');
      await evaluate(pageCall(doubleClick, match));
      await until(
        () => evaluate(textOf('.preview-plane')),
        (text) => text.includes(needle),
        'Linked content passage',
      );
      checks.push('Browse and find a document by body text absent from its filename');

      await actions.palette('Edit text');
      await actions.text('.text-editing .cm-content', draft + '\n' + original);
      await until(
        async () =>
          (await saved()).workspaces[0]?.panes.find(
            (pane) => pane.type === 'preview' && pane.path === note && pane.bufferID,
          ),
        Boolean,
        'Durable unsaved edit',
      );
      const edited = (await saved()).workspaces[0]!.panes.find(
        (pane) => pane.type === 'preview' && pane.path === note,
      );
      assert.ok(edited?.type === 'preview' && edited.bufferID);
      bufferID = edited.bufferID;
      await actions.capture(path.join(root, 'edited-draft.png'));

      await open('Manual.pdf');
      await readyPDF();
      await actions.text('.page-number', '3');
      await actions.key('Enter', 'Enter');
      await until(
        () => evaluate(valueOf('.page-number')),
        (page) => page === '3',
        'Third page',
      );
      await actions.capture(path.join(root, 'pdf-page-three.png'));

      await actions.palette('Files');
      await choose('Photo.png');
      await actions.palette('Images for web');
      await until(
        () => evaluate(pageCall(canvasDrawn, '.image-tools-dialog canvas')),
        Boolean,
        'Image tool source',
      );
      await actions.field('Output width', '96');
      await actions.field('Output height', '64');
      await actions.button('Export image', '.image-tools-dialog');
      const jobs = await until(
        () => evaluate(pageCall(listJobs)),
        (jobs) => jobs.some((job) => job.status === 'completed'),
        'Completed export',
        30000,
      );
      assert.equal(jobs.length, 1);
      exportID = jobs[0]!.id;
      const bytes = await readFile(output);
      assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
      assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
      outputHash = await hash(output);
      await actions.button('Open result', '.image-tools-dialog');
      const result = await until(
        () => evaluate(pageCall(imageSize)),
        (result) => result.width > 0,
        'Exported image decoded',
      );
      assert.deepEqual(result, { width: 96, height: 64 });
      if (await evaluate(exists('.quick-preview-dialog')))
        await actions.button('Open linked plane', '.quick-preview-dialog');
      await until(
        async () =>
          (await saved()).workspaces[0]?.panes.some(
            (pane) => pane.type === 'preview' && pane.path === output,
          ),
        Boolean,
        'Exported image plane saved',
      );
      await actions.capture(path.join(root, 'exported-image.png'));
      checks.push(
        'Resize/export a new WebP, decode its actual pixels, and leave all original files unchanged',
      );
    } else {
      const restored = (await saved()).workspaces[0]!;
      assert.ok(
        restored.panes.some(
          (pane) => pane.type === 'search' && pane.query === needle && pane.content,
        ),
      );
      assert.ok(restored.panes.some((pane) => pane.type === 'preview' && pane.path === output));
      assert.ok(
        restored.panes.some(
          (pane) => pane.type === 'preview' && pane.path === note && pane.bufferID === bufferID,
        ),
      );
      const jobs = await evaluate(pageCall(listJobs));
      assert.equal(jobs.length, 1, 'Cold restoration must not re-export the file');
      assert.equal(jobs[0]!.id, exportID);
      assert.equal(await hash(output), outputHash);
      await actions.palette('Manual.pdf');
      await readyPDF();
      await until(
        () => evaluate(valueOf('.page-number')),
        (page) => page === '3',
        'PDF page restored after restart',
      );
      await actions.palette('Journal.txt');
      await until(() => evaluate(exists('.text-editing .cm-content')), Boolean, 'Restored editor');
      await evaluate(focus('.text-editing .cm-content'));
      await actions.key('ArrowUp', 'ArrowUp', 4);
      await until(
        () => evaluate(textOf('.text-editing .cm-content')),
        (text) => text.includes(draft),
        'Unsaved edit restored after restart',
      );
      await actions.capture(path.join(root, 'restored-draft.png'));
      checks.push(
        'Cold restart restores search scope, unsaved text, PDF page and exported view without replaying jobs',
      );
    }
    assert.deepEqual(
      await Promise.all([note, photo, book].map(hash)),
      before,
      'Original fixture bytes remain unchanged',
    );
    await app.close(connection);
    connection = undefined;
  } catch (error) {
    const visible = await connection
      ?.evaluate(pageCall(() => document.body.innerText))
      .catch(() => 'Renderer unavailable');
    await writeFile(
      path.join(root, 'failure-' + launch + '.json'),
      JSON.stringify({ checks, error: String(error), visible }, null, 2),
      { flag: 'wx' },
    );
    throw error;
  } finally {
    await app.close(connection);
  }
}
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify({ passed: true, checks, outputHash, exportID, bufferID }, null, 2),
  { flag: 'wx' },
);
console.log(JSON.stringify({ passed: true, root, checks }));
