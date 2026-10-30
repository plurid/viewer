/** Target budgets, failure recovery, relative folders and portable saved recipes. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import {
  animationFrames,
  buttonState,
  click,
  countOf,
  exists,
  pressButton,
  textOf,
  valueOf,
} from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-optimization-recipes-');
const files = path.join(root, 'Files'),
  output = path.join(root, 'Exports'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(output), mkdir(profile)]);
await Promise.all(['Left', 'Right'].map((name) => mkdir(path.join(files, name))));
const sources = [
  path.join(files, 'Left/Photo.jpg'),
  path.join(files, 'Right/Photo.jpg'),
  path.join(files, 'Right/Retry.jpg'),
];
const processors = path.resolve(
  path.dirname(binary),
  '../Resources',
  `viewer-processors-${process.platform}-${process.arch}`,
);
interface Encoder {
  jpeg(options: { quality: number }): Encoder;
  toBuffer(): Promise<Buffer>;
}
const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp')) as (
  data: Buffer,
  options: { raw: { width: number; height: number; channels: number } },
) => Encoder;
const width = 960,
  height = 720,
  pixels = Buffer.alloc(width * height * 3);
for (let index = 0; index < pixels.length; index++)
  pixels[index] = ((index * 17) ^ (index >> 10)) & 255;
const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
  .jpeg({ quality: 99 })
  .toBuffer();
await writeFile(sources[0]!, jpeg, { flag: 'wx' });
await writeFile(sources[1]!, jpeg, { flag: 'wx' });
await writeFile(sources[2]!, 'Generated broken image for individual retry', { flag: 'wx' });
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const collectionID = randomUUID();
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'batch',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'batch',
      name: 'Generated optimization batch',
      roots: ['collection'],
      activePane: 'collection',
      arrangement: {},
      collections: [{ id: collectionID, name: 'Generated images', kind: 'explicit', sources }],
      panes: [{ id: 'collection', type: 'collection', path: files, collectionID }],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const observations: unknown[] = [];

type RowMatch = 'file' | 'text';

function selectRow(selector: string) {
  const row = document.querySelector<HTMLElement>(selector)!;
  row.click();
  row.focus();
}

/** Adds the `index`th row to the selection, as a Command-click does. */
function commandClickRow(index: number) {
  const row = document.querySelectorAll('[data-file-path]')[index]!;
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
}

function selectField(selector: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.focus();
  field.select();
}

function isChecked(selector: string) {
  return document.querySelector<HTMLInputElement>(selector)!.checked;
}

function chooseSavedRecipe(name: string) {
  const button = [...document.querySelectorAll<HTMLElement>('[data-menu-id]')].find((button) =>
    button.textContent.includes(name),
  );
  if (!button) throw new Error('Saved recipe missing');
  button.click();
}

function unmetTargets() {
  return [...document.querySelectorAll('[data-optimization-file]')].filter((row) =>
    row.textContent.includes('Target not met'),
  ).length;
}

/** Retries the row for one file name, or the first row whose text includes `value`. */
function retryRow(match: RowMatch, value: string) {
  const row = [...document.querySelectorAll<HTMLElement>('[data-optimization-file]')].find((row) =>
    match === 'file' ? row.dataset.optimizationFile === value : row.textContent.includes(value),
  )!;
  [...row.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === 'Retry')!
    .click();
}

async function session(restart: boolean) {
  const app = await ownedApp(binary!, profile);
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    const { evaluate, command } = connection;
    const press = async (label: string) => {
      await evaluate(pressButton(label, '.optimize-dialog'));
    };
    const input = async (label: string, value: string) => {
      await evaluate(pageCall(selectField, `[aria-label="${label}"]`));
      await command('Input.insertText', { text: value });
    };
    const capture = async (name: string) => {
      await evaluate(animationFrames(2));
      const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, name + '.png'), Buffer.from(image.data, 'base64'), {
        flag: 'wx',
      });
    };
    await until(
      () => evaluate(countOf('[data-file-path]')),
      (count) => count === 3,
      'collection inputs',
    );
    await evaluate(pageCall(selectRow, '[data-file-path]'));
    for (const index of [1, 2]) await evaluate(pageCall(commandClickRow, index));
    await until(
      () => evaluate(textOf('.folder-status')),
      (text) => text.includes('3 selected'),
      'all collection sources selected',
    );
    await evaluate(click('[aria-label="Commands (⌘K)"]'));
    await command('Input.insertText', { text: 'Optimize' });
    await until(
      () => evaluate(textOf('.command-result[aria-selected=true]')),
      (text) => text.includes('Optimize'),
      'Optimize command',
    );
    await evaluate(click('.command-result[aria-selected=true]'));
    await until(() => evaluate(exists('.optimize-dialog')), Boolean, 'batch dialog');
    await evaluate(click('.optimization-recipes summary'));
    if (restart) {
      await evaluate(click('[aria-label="Saved optimization recipe"]'));
      await until(
        () => evaluate(exists('[data-menu-id^="choice:"]')),
        Boolean,
        'saved recipe choice',
      );
      await evaluate(pageCall(chooseSavedRecipe, 'Images under 300 kB'));
      assert.equal(await evaluate(valueOf('[aria-label="Target size"]')), '300');
      assert.equal(await evaluate(pageCall(isChecked, '.optimization-preserve input')), true);
      assert.equal(await evaluate(valueOf('[aria-label="Optimization output folder"]')), files);
      await input('Target size', '1.024');
      await press('Prepare candidates');
      await until(
        () => evaluate(pageCall(unmetTargets)),
        (count) => count === 3,
        'honest unmet targets',
        60000,
      );
      assert.equal(await evaluate(countOf('.optimize-results input:checked')), 0);
      await capture('unmet-targets-dark');
      observations.push({
        recipe: 'restored after restart',
        destination: 'not stored in recipe',
        unmet: 3,
        selected: 0,
      });
      return;
    }
    await evaluate(click('.optimization-target-toggle input'));
    await input('Target size', '300');
    await input('Optimization recipe name', 'Images under 300 kB');
    await press('Save recipe');
    await until(
      () => evaluate(textOf('.optimization-recipes summary')),
      (text) => text.includes('Images under 300 kB'),
      'saved recipe',
    );
    await input('Optimization output folder', output);
    assert.equal(await evaluate(pageCall(isChecked, '.optimization-preserve input')), true);
    await press('Prepare candidates');
    await until(
      () => evaluate(textOf('.optimize-results')),
      (text) => text.includes('Target met') && !text.includes('Preparing'),
      'mixed success and failure',
      60000,
    );
    assert.equal(await evaluate(countOf('.optimize-results input:checked')), 2);
    await writeFile(sources[2]!, jpeg);
    await evaluate(pageCall(retryRow, 'file', 'Retry.jpg'));
    await until(
      () => evaluate(countOf('.optimize-results input:checked')),
      (count) => count === 3,
      'individual retry',
      60000,
    );
    await writeFile(sources[0]!, jpeg);
    await press('Save 3 smaller copies');
    await until(
      () => evaluate(textOf('.dialog-error')),
      (text) => text.includes('source changed'),
      'stale source rejected',
    );
    await evaluate(pageCall(retryRow, 'text', 'Left/Photo.jpg'));
    await until(
      () => evaluate(buttonState('Save 3 smaller copies', '.optimize-dialog')),
      (state) => state === 'enabled',
      'refreshed source candidate',
      60000,
    );
    await capture('recipe-batch-dark');
    await press('Save 3 smaller copies');
    const jobs = await until(
      () => evaluate(pageCall(() => window.viewer.jobs())),
      (jobs) => jobs.length === 2 && jobs.every((job) => job.status === 'completed'),
      'relative folder outputs',
      30000,
    );
    const completed = jobs.flatMap((job) => job.completed);
    assert.equal(completed.length, 3);
    for (const item of completed) {
      const relative = path.relative(files, path.dirname(item.source));
      assert.equal(
        path.relative(await realpath(output), path.dirname(item.destination!)),
        relative,
      );
      assert.ok(item.targetSize?.met);
      assert.ok(item.outputBytes! <= 300_000);
      assert.equal(hash(await readFile(item.source)), hash(jpeg));
    }
    observations.push({
      outputs: completed,
      individualRetry: true,
      changedSource: 'blocked until retry',
      originals: 'unchanged SHA256',
    });
  } catch (error) {
    if (connection)
      console.log(
        'Batch surface:',
        await connection.evaluate(pageCall(() => document.body.innerText.slice(-6000))),
      );
    throw error;
  } finally {
    await app.close(connection);
  }
}
try {
  await session(false);
  await session(true);
} finally {
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ observations }, null, 2), {
    flag: 'wx',
  });
  console.log('Retained batch recipe evidence:', root);
}
