/** Target budgets, failure recovery, relative folders and portable saved recipes. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_STATE_VERSION,
  type OperationJob,
  type SavedState,
} from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

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

async function session(restart: boolean) {
  const app = await ownedApp(binary!, profile);
  let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
  try {
    connection = await app.connect();
    const { evaluate, command } = connection;
    const click = async (label: string, scope = '.optimize-dialog') => {
      await evaluate(
        `(()=>{const button=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('Unavailable action: '+${JSON.stringify(label)});button.click()})()`,
      );
    };
    const input = async (label: string, value: string) => {
      await evaluate(
        `(()=>{const field=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});field.focus();field.select()})()`,
      );
      await command('Input.insertText', { text: value });
    };
    const capture = async (name: string) => {
      await evaluate(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, name + '.png'), Buffer.from(image.data, 'base64'), {
        flag: 'wx',
      });
    };
    await until(
      () => evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
      (count) => count === 3,
      'collection inputs',
    );
    await evaluate(
      'document.querySelector("[data-file-path]").click();document.querySelector("[data-file-path]").focus()',
    );
    for (const index of [1, 2])
      await evaluate(
        `document.querySelectorAll('[data-file-path]')[${index}].dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true}))`,
      );
    await until(
      () => evaluate<string>('document.querySelector(".folder-status").textContent'),
      (text) => text.includes('3 selected'),
      'all collection sources selected',
    );
    await evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
    await command('Input.insertText', { text: 'Optimize' });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent||""',
        ),
      (text) => text.includes('Optimize'),
      'Optimize command',
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
    await until(
      () => evaluate<boolean>('!!document.querySelector(".optimize-dialog")'),
      Boolean,
      'batch dialog',
    );
    await evaluate('document.querySelector(".optimization-recipes summary").click()');
    if (restart) {
      await evaluate(
        'document.querySelector(\'[aria-label="Saved optimization recipe"]\').click()',
      );
      await until(
        () => evaluate<boolean>(`!!document.querySelector('[data-menu-id^="choice:"]')`),
        Boolean,
        'saved recipe choice',
      );
      await evaluate(
        `(()=>{const button=[...document.querySelectorAll('[data-menu-id]')].find(button=>button.textContent.includes('Images under 300 kB'));if(!button)throw new Error('Saved recipe missing');button.click()})()`,
      );
      assert.equal(
        await evaluate('document.querySelector(\'[aria-label="Target size"]\').value'),
        '300',
      );
      assert.equal(
        await evaluate('document.querySelector(".optimization-preserve input").checked'),
        true,
      );
      assert.equal(
        await evaluate(
          'document.querySelector(\'[aria-label="Optimization output folder"]\').value',
        ),
        files,
      );
      await input('Target size', '1.024');
      await click('Prepare candidates');
      await until(
        () =>
          evaluate<number>(
            `[...document.querySelectorAll('[data-optimization-file]')].filter(row=>row.textContent.includes('Target not met')).length`,
          ),
        (count) => count === 3,
        'honest unmet targets',
        60000,
      );
      assert.equal(
        await evaluate('document.querySelectorAll(".optimize-results input:checked").length'),
        0,
      );
      await capture('unmet-targets-dark');
      observations.push({
        recipe: 'restored after restart',
        destination: 'not stored in recipe',
        unmet: 3,
        selected: 0,
      });
      return;
    }
    await evaluate('document.querySelector(".optimization-target-toggle input").click()');
    await input('Target size', '300');
    await input('Optimization recipe name', 'Images under 300 kB');
    await click('Save recipe');
    await until(
      () => evaluate<string>('document.querySelector(".optimization-recipes summary").textContent'),
      (text) => text.includes('Images under 300 kB'),
      'saved recipe',
    );
    await input('Optimization output folder', output);
    assert.equal(
      await evaluate('document.querySelector(".optimization-preserve input").checked'),
      true,
    );
    await click('Prepare candidates');
    await until(
      () => evaluate<string>('document.querySelector(".optimize-results").textContent'),
      (text) => text.includes('Target met') && !text.includes('Preparing'),
      'mixed success and failure',
      60000,
    );
    assert.equal(
      await evaluate('document.querySelectorAll(".optimize-results input:checked").length'),
      2,
    );
    await writeFile(sources[2]!, jpeg);
    await evaluate(
      `(()=>{const row=[...document.querySelectorAll('[data-optimization-file]')].find(row=>row.dataset.optimizationFile==='Retry.jpg');[...row.querySelectorAll('button')].find(button=>button.textContent.trim()==='Retry').click()})()`,
    );
    await until(
      () => evaluate<number>('document.querySelectorAll(".optimize-results input:checked").length'),
      (count) => count === 3,
      'individual retry',
      60000,
    );
    await writeFile(sources[0]!, jpeg);
    await click('Save 3 smaller copies');
    await until(
      () => evaluate<string>('document.querySelector(".dialog-error")?.textContent||""'),
      (text) => text.includes('source changed'),
      'stale source rejected',
    );
    await evaluate(
      `(()=>{const row=[...document.querySelectorAll('[data-optimization-file]')].find(row=>row.textContent.includes('Left/Photo.jpg'));[...row.querySelectorAll('button')].find(button=>button.textContent.trim()==='Retry').click()})()`,
    );
    await until(
      () =>
        evaluate<boolean>(
          `[...document.querySelectorAll('.optimize-dialog button')].some(button=>button.textContent.trim()==='Save 3 smaller copies'&&!button.disabled)`,
        ),
      Boolean,
      'refreshed source candidate',
      60000,
    );
    await capture('recipe-batch-dark');
    await click('Save 3 smaller copies');
    const jobs = await until(
      () => evaluate<OperationJob[]>('window.viewer.jobs()'),
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
        await connection.evaluate('document.body.innerText.slice(-6000)'),
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
