/** Packaged PDF workbench and scanned-image optimization. All fixtures remain. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_STATE_VERSION,
  type SavedState,
  type OperationJob,
} from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { workbenchPDF } from '../pdf-fixtures';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
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
const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const capture = async (name: string) => {
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    await evaluate('new Promise(resolve=>setTimeout(resolve,350))');
    if (name.startsWith('pdf-tools'))
      console.log(
        'PDF preview bounds:',
        name,
        await evaluate(
          `(()=>{const canvas=document.querySelector('.pdf-tools-page img');const r=canvas.getBoundingClientRect();return {width:r.width,height:r.height,hidden:canvas.hidden,page:canvas.dataset.pdfPage,rotation:canvas.dataset.pdfRotation}})()`,
        ),
      );
    const value = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(value.data, 'base64'), {
      flag: 'wx',
    });
    if (name.startsWith('pdf-tools')) {
      const bounds = await evaluate<{ x: number; y: number; width: number; height: number }>(
        'document.querySelector(".pdf-tools-page img").getBoundingClientRect().toJSON()',
      );
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
  const click = (text: string, scope = '.pdf-tools-dialog') =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const field = async (label: string, text: string) => {
    await evaluate(
      `(()=>{const field=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});field.focus();field.select()})()`,
    );
    await command('Input.insertText', { text });
  };
  const run = async (text: string) => {
    await evaluate('document.querySelector(\'[aria-label="Commands (⌘K)"]\').click()');
    await until(
      () => evaluate<string>('document.activeElement?.getAttribute("aria-label")||""'),
      (value) => value === 'Search commands',
      'palette focus',
    );
    await command('Input.insertText', { text });
    await until(
      () =>
        evaluate<string>(
          'document.querySelector(".command-result[aria-selected=true]")?.textContent||""',
        ),
      (value) => value.includes(text),
      text + ' command',
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
    (count) => count === 2,
    'PDF files',
  );
  await evaluate(
    'document.querySelector("[data-file-path]").click();document.querySelector(".folder-explorer").focus()',
  );
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
    () => evaluate<string>('document.querySelector(".pdf-tools-dialog")?.textContent||""'),
    (text) => text.includes('5 of 5 pages included'),
    'five PDF source pages',
  );
  await field('PDF page range', '3, 1');
  await click('Apply range');
  await evaluate(
    'document.querySelector(\'[aria-label="Rotate page clockwise"]\').click();document.querySelector(\'[aria-label="Move page down"]\').click()',
  );
  await until(
    () =>
      evaluate<boolean>(
        '!!document.querySelector(\'.pdf-tools-page img[data-pdf-page="3"][data-pdf-rotation="90"]:not([hidden])\')',
      ),
    Boolean,
    'rotated PDF page preview',
  );
  await capture('pdf-tools-dark');
  await evaluate(
    'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.appearance",value:"light"}],s.revision))',
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
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
  await click('Save PDF');
  let jobs = await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
    (jobs) => jobs.length === 1 && jobs[0]!.status === 'completed',
    'combined PDF export',
    30000,
  );
  const combined = jobs[0]!.completed[0]!.destination!;
  assert.ok(combined);
  const inspect = await evaluate<{ text: string }>(
    `(async()=>{const resource=await window.viewer.resource(${JSON.stringify(combined)});try{return await window.viewer.document(resource.id)}finally{await window.viewer.release(resource.id)}})()`,
  );
  assert.ok(inspect.text.indexOf('Materials overview') < inspect.text.indexOf('Assembly drawing'));
  assert.ok(!inspect.text.includes('Page intentionally excluded'));
  assert.ok(inspect.text.includes('Scan two'));
  await until(
    () => evaluate<string>('document.querySelector(".pdf-tools-dialog footer").textContent'),
    (text) => text.includes('1 PDF saved'),
    'saved acknowledgement',
  );
  await field('PDF output name', 'Pages.pdf');
  await until(
    () => evaluate<string>('document.querySelector(".pdf-tools-dialog footer").textContent'),
    (text) => !text.includes('PDF saved'),
    'changed draft clears saved acknowledgement',
  );
  await evaluate('document.querySelector(".pdf-tools-split input").click()');
  await click('Split pages');
  jobs = await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
    (jobs) => jobs.length === 5 && jobs.every((job) => job.status === 'completed'),
    'four split PDFs',
    30000,
  );
  assert.equal(jobs.flatMap((job) => job.completed).length, 5);
  await click('Close');
  await evaluate(
    `document.querySelector(${JSON.stringify(`[data-file-path="${second}"]`)}).click()`,
  );
  await run('Optimize');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".optimize-dialog")'),
    Boolean,
    'scan optimization',
  );
  await evaluate('document.querySelector(".optimize-scan-options input[type=checkbox]").click()');
  await evaluate(
    '(()=>{const field=document.querySelector(\'[aria-label="PDF maximum image edge"]\');field.focus();field.select()})()',
  );
  let digits = '';
  for (const digit of '1600') {
    digits += digit;
    await command('Input.insertText', { text: digit });
    assert.equal(
      await evaluate('document.querySelector(\'[aria-label="PDF maximum image edge"]\').value'),
      digits,
    );
  }
  await capture('pdf-scan-light');
  await click('Optimize file', '.optimize-dialog');
  jobs = await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
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
    console.log('PDF surface:', await connection.evaluate('document.body.innerText.slice(-7000)'));
  throw error;
} finally {
  await app.close(connection);
  console.log('Retained PDF acceptance:', root);
}
