/** Packaged PDF workbench and scanned-image optimization. All fixtures remain. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { workbenchPDF } from '../pdf-fixtures';
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
  valueOf,
} from './runtime/page';
import { pageCall } from './runtime/page-function';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-pdf-tools-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const first = path.join(files, 'Materials.pdf'),
  second = path.join(files, 'Scanned notes.pdf');
const processors = path.resolve(
  path.dirname(binary),
  '../Resources',
  `viewer-processors-${process.platform}-${process.arch}`,
);
const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp'));
const width = 1800,
  height = 2400,
  pixels = Buffer.alloc(width * height * 3);
for (let index = 0; index < pixels.length; index++)
  pixels[index] = ((index * 13) ^ (index >> 10)) & 255;
const scan = await sharp(pixels, { raw: { width, height, channels: 3 } })
  .jpeg({ quality: 99 })
  .toBuffer();
await writeFile(
  first,
  workbenchPDF(['Materials overview', 'Page intentionally excluded', 'Assembly drawing']),
  { flag: 'wx' },
);
await writeFile(second, workbenchPDF(['Scan one', 'Scan two'], { bytes: scan, width, height }), {
  flag: 'wx',
});
const hash = async (file: string) =>
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
  originals = [await hash(first), await hash(second)];
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'pdf',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'pdf',
      name: 'PDF workbench',
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
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });

function previewBounds() {
  const image = document.querySelector<HTMLImageElement>('.pdf-tools-page img')!;
  const box = image.getBoundingClientRect();
  return {
    width: box.width,
    height: box.height,
    hidden: image.hidden,
    page: image.dataset.pdfPage,
    rotation: image.dataset.pdfRotation,
  };
}

function previewBox() {
  const { x, y, width, height } = document
    .querySelector('.pdf-tools-page img')!
    .getBoundingClientRect();
  return { x, y, width, height };
}

function selectField(selector: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.focus();
  field.select();
}

/** Clicks each match in turn, in one task, so no render runs between them. */
function clickEach(selectors: string[]) {
  for (const selector of selectors) document.querySelector<HTMLElement>(selector)!.click();
}

/** Clicks the first file, then focuses the list itself for Select All. */
function clickFileFocusList() {
  document.querySelector<HTMLElement>('[data-file-path]')!.click();
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
}

/** The text of the first match; throws when nothing matches. */
function requiredText(selector: string) {
  return document.querySelector(selector)!.textContent;
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
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const capture = async (name: string) => {
    await evaluate(animationFrames(2));
    await evaluate(
      pageCall((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), 350),
    );
    if (name.startsWith('pdf-tools'))
      console.log('PDF preview bounds:', name, await evaluate(pageCall(previewBounds)));
    const value = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(value.data, 'base64'), {
      flag: 'wx',
    });
    if (name.startsWith('pdf-tools')) {
      const bounds = await evaluate(pageCall(previewBox));
      const { data, info } = await sharp(Buffer.from(value.data, 'base64'))
        .extract({
          left: Math.ceil(bounds.x),
          top: Math.ceil(bounds.y),
          width: Math.floor(bounds.width) - 1,
          height: Math.floor(bounds.height) - 1,
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let white = 0,
        ink = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        if (Math.min(data[index], data[index + 1], data[index + 2]) > 248) white++;
        if (Math.max(data[index], data[index + 1], data[index + 2]) < 180) ink++;
      }
      console.log('PDF displayed pixels:', name, { white, ink });
      assert.ok(white > info.width * info.height * 0.8, name + ' displays the real white PDF page');
      assert.ok(ink > 40, name + ' retains rendered page content, including scaled antialiasing');
    }
  };
  const press = (text: string, scope = '.pdf-tools-dialog') => evaluate(pressButton(text, scope));
  const field = async (label: string, text: string) => {
    await evaluate(pageCall(selectField, `[aria-label="${label}"]`));
    await command('Input.insertText', { text });
  };
  const run = async (text: string) => {
    await evaluate(click('[aria-label="Commands (⌘K)"]'));
    await until(
      () => evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label') ?? '')),
      (value) => value === 'Search commands',
      'palette focus',
    );
    await command('Input.insertText', { text });
    await until(
      () => evaluate(textOf('.command-result[aria-selected=true]')),
      (value) => value.includes(text),
      text + ' command',
    );
    await evaluate(click('.command-result[aria-selected=true]'));
  };
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count === 2,
    'PDF files',
  );
  await evaluate(pageCall(clickFileFocusList));
  for (const type of ['keyDown', 'keyUp'])
    await command('Input.dispatchKeyEvent', {
      type,
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 4,
    });
  await run('PDF tools');
  await until(
    () => evaluate(textOf('.pdf-tools-dialog')),
    (text) => text.includes('5 of 5 pages included'),
    'five PDF source pages',
  );
  await field('PDF page range', '3, 1');
  await press('Apply range');
  await evaluate(
    pageCall(clickEach, ['[aria-label="Rotate page clockwise"]', '[aria-label="Move page down"]']),
  );
  await until(
    () =>
      evaluate(
        exists('.pdf-tools-page img[data-pdf-page="3"][data-pdf-rotation="90"]:not([hidden])'),
      ),
    Boolean,
    'rotated PDF page preview',
  );
  await capture('pdf-tools-dark');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
    (value) => value === 'light',
    'light PDF tools',
  );
  await capture('pdf-tools-light');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('pdf-tools-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  await press('Save PDF');
  let jobs = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) => jobs.length === 1 && jobs[0]!.status === 'completed',
    'combined PDF export',
    30000,
  );
  const combined = jobs[0]!.completed[0]!.destination!;
  assert.ok(combined);
  const inspect = await evaluate(pageCall(documentText, combined));
  assert.ok(inspect.text.indexOf('Materials overview') < inspect.text.indexOf('Assembly drawing'));
  assert.ok(!inspect.text.includes('Page intentionally excluded'));
  assert.ok(inspect.text.includes('Scan two'));
  await until(
    () => evaluate(textOf('.pdf-tools-dialog footer')),
    (text) => text.includes('1 PDF saved'),
    'saved acknowledgement',
  );
  await field('PDF output name', 'Pages.pdf');
  await until(
    () => evaluate(pageCall(requiredText, '.pdf-tools-dialog footer')),
    (text) => !text.includes('PDF saved'),
    'changed draft clears saved acknowledgement',
  );
  await evaluate(click('.pdf-tools-split input'));
  await press('Split pages');
  jobs = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) => jobs.length === 5 && jobs.every((job) => job.status === 'completed'),
    'four split PDFs',
    30000,
  );
  assert.equal(jobs.flatMap((job) => job.completed).length, 5);
  await press('Close');
  await evaluate(click(`[data-file-path="${second}"]`));
  await run('Optimize');
  await until(() => evaluate(exists('.optimize-dialog')), Boolean, 'scan optimization');
  await evaluate(click('.optimization-advanced summary'));
  await evaluate(click('[aria-label="Recompress scanned images"]'));
  await evaluate(pageCall(selectField, '[aria-label="PDF maximum image edge"]'));
  let digits = '';
  for (const digit of '1600') {
    digits += digit;
    await command('Input.insertText', { text: digit });
    assert.equal(await evaluate(valueOf('[aria-label="PDF maximum image edge"]')), digits);
  }
  await capture('pdf-scan-light');
  await press('Prepare candidates', '.optimize-dialog');
  await until(
    () => evaluate(buttonState('Save 1 smaller copy', '.optimize-dialog')),
    (state) => state === 'enabled',
    'reviewed scan candidate',
    60000,
  );
  await press('Save 1 smaller copy', '.optimize-dialog');
  jobs = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) => jobs.length === 6 && jobs.every((job) => job.status === 'completed'),
    'scan recompression',
    30000,
  );
  const optimized = jobs.find(
    (job) => job.sources.length === 1 && job.sources[0] === second && job.completed[0]?.optimized,
  )!.completed[0]!;
  assert.ok(optimized.outputBytes! < optimized.inputBytes! / 2);
  assert.deepEqual([await hash(first), await hash(second)], originals);
  console.log(
    'PDF acceptance:',
    JSON.stringify({
      combined,
      outputs: jobs.flatMap((job) => job.completed).length,
      scan: { original: optimized.inputBytes, output: optimized.outputBytes },
      sources: 'unchanged SHA256',
      screenshots: root,
    }),
  );
} catch (error) {
  if (connection)
    console.log(
      'PDF surface:',
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-7000))),
    );
  throw error;
} finally {
  await app.close(connection);
  console.log('Retained PDF acceptance:', root);
}
