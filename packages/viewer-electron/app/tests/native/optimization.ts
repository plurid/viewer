/** Real Optimize command and preview action in an owned profile. All files remain. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { optimizationPDF } from '../optimization-fixtures';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import {
  animationFrames,
  buttonState,
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
const root = await temporaryRoot('viewer-native-optimization-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const pdf = path.join(files, 'Searchable plan.pdf'),
  png = path.join(files, 'Artwork.png');
await writeFile(pdf, optimizationPDF(), { flag: 'wx' });
interface Pipeline {
  png(options: { compressionLevel: number }): Pipeline;
  toBuffer(): Promise<Buffer>;
}
const processors = path.resolve(
  path.dirname(binary),
  '../Resources',
  `viewer-processors-${process.platform}-${process.arch}`,
);
const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp')) as (
  input: Buffer,
) => Pipeline;
const sample = (await localSamples()).find((sample) => sample.formats.includes('png'))!;
await writeFile(
  png,
  await sharp(Buffer.from(sample.bytes)).png({ compressionLevel: 0 }).toBuffer(),
  { flag: 'wx' },
);
const hash = async (file: string) =>
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
  before = [await hash(pdf), await hash(png)];
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'optimize',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'optimize',
      name: 'Optimize',
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
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }));
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));

function selectRow(selector: string) {
  const row = document.querySelector<HTMLElement>(selector)!;
  row.click();
  row.focus();
}

function openReview(name: string) {
  const row = [...document.querySelectorAll<HTMLElement>('[data-optimization-file]')].find(
    (row) => row.dataset.optimizationFile === name,
  )!;
  [...row.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === 'Review')!
    .click();
}

/** Both sides of the review show a decoded image. */
function reviewLoaded() {
  const images = [...document.querySelectorAll<HTMLImageElement>('.optimization-review-panes img')];
  return (
    images.length === 2 &&
    images.every((image) => image.complete && image.naturalWidth > 0 && !image.hidden)
  );
}

/** The SHA-256 of the optimized side of the review. */
async function reviewedImageHash() {
  const url = document.querySelector<HTMLImageElement>(
    '.optimization-review-panes figure:last-child img',
  )!.src;
  const bytes = await (await fetch(url)).arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function scrollComparison(block: ScrollLogicalPosition) {
  document.querySelector('.optimization-comparison')!.scrollIntoView({ block });
}

async function documentText(file: string) {
  const resource = await window.viewer.resource(file);
  try {
    return await window.viewer.document(resource.id);
  } finally {
    await window.viewer.release(resource.id);
  }
}

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const capture = async (name: string) => {
    await evaluate(animationFrames(2));
    const value = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(value.data, 'base64'), {
      flag: 'wx',
    });
  };
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count === 2,
    'generated optimization inputs',
  );
  await evaluate(pageCall(selectRow, '[data-file-path]'));
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 4,
  });
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: 4,
  });
  await evaluate(click('[aria-label="Commands (⌘K)"]'));
  await command('Input.insertText', { text: 'Optimize' });
  await until(
    () => evaluate(textOf('.command-result[aria-selected=true]')),
    (text) => text.includes('Optimize'),
    'Optimize command',
  );
  await evaluate(click('.command-result[aria-selected=true]'));
  await until(() => evaluate(exists('.optimize-dialog')), Boolean, 'Optimize dialog');
  await evaluate(click('[aria-label="Optimization preset"]'));
  await until(
    () => evaluate(exists('[data-menu-id="choice:lossless"]')),
    Boolean,
    'Lossless preset',
  );
  await evaluate(click('[data-menu-id="choice:lossless"]'));
  await evaluate(pressButton('Prepare candidates', '.optimize-dialog'));
  await until(
    () => evaluate(buttonState('Save 2 smaller copies', '.optimize-dialog')),
    (state) => state === 'enabled',
    'measured candidates',
    60000,
  );
  const review = async (name: string) => {
    await evaluate(pageCall(openReview, name));
    await until(() => evaluate(pageCall(reviewLoaded)), Boolean, 'loaded before and after', 30000);
  };
  await review('Artwork.png');
  const reviewedHash = await evaluate(pageCall(reviewedImageHash));
  await evaluate(pageCall(scrollComparison, 'center'));
  await capture('review-image-dark');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(pageCall(scrollComparison, 'end'));
  await capture('review-image-minimum');
  await command('Emulation.clearDeviceMetricsOverride');
  await review('Searchable plan.pdf');
  await evaluate(pageCall(scrollComparison, 'center'));
  await capture('review-pdf-dark');
  await evaluate(pressButton('Save 2 smaller copies', '.optimize-dialog'));
  const jobs = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) =>
      jobs.filter((job) => job.kind === 'convert').length === 2 &&
      jobs.filter((job) => job.kind === 'convert').every((job) => job.status === 'completed'),
    'packaged batch optimization',
    30000,
  );
  const results = jobs.flatMap((job) => job.completed);
  assert.equal(results.length, 2);
  assert.ok(
    results.every((result) => result.optimized && result.outputBytes! < result.inputBytes!),
  );
  await until(
    () => evaluate(textOf('.optimize-dialog')),
    (text) => text.includes('2 of 2 prepared') && text.includes('saved'),
    'size results',
  );
  await capture('optimize-dark');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
    (value) => value === 'light',
    'light optimization',
  );
  await capture('optimize-light');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('optimize-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  assert.equal(
    await hash(results.find((result) => result.source === png)!.destination!),
    reviewedHash,
  );
  const optimizedPDF = results.find((result) => result.source === pdf)!.destination!;
  const readable = await evaluate(pageCall(documentText, optimizedPDF));
  assert.ok(readable.text.includes('Searchable Viewer optimization fixture'));
  assert.deepEqual([await hash(pdf), await hash(png)], before);
  observations.push({ results, sources: 'unchanged SHA256', pdf: 'text remains searchable' });
} catch (error) {
  if (connection)
    console.log(
      'Optimization surface:',
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-6000))),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  console.log('Retained optimization evidence:', root);
}
