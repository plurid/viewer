import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_STATE_VERSION,
  type SavedState,
  type OperationJob,
} from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { localSamples } from '../../tools/playground/catalog';
import { optimizationPDF } from '../optimization-fixtures';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-export-presets-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const samples = await localSamples();
const inputs = [
  ['Photo.png', samples.find((sample) => sample.formats.includes('png'))!.bytes],
  ['Second.jpg', samples.find((sample) => sample.formats.includes('jpg'))!.bytes],
  ['Recording.wav', samples.find((sample) => sample.formats.includes('wav'))!.bytes],
  ['Manual.pdf', optimizationPDF()],
] as const;
for (const [name, bytes] of inputs) await writeFile(path.join(files, name), bytes, { flag: 'wx' });
const hashes = () =>
    Promise.all(
      inputs.map(async ([name]) =>
        createHash('sha256')
          .update(await readFile(path.join(files, name)))
          .digest('hex'),
      ),
    ),
  before = await hashes();
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'presets',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'presets',
      name: 'Export presets',
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
    await evaluate('new Promise(resolve=>setTimeout(resolve,350))');
    const value = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(value.data, 'base64'), {
      flag: 'wx',
    });
  };
  const choose = async (name: string, additive = false) => {
    await evaluate(
      `(()=>{const row=document.querySelector(${JSON.stringify(`[data-file-path="${path.join(files, name)}"]`)});row.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:${additive}}));document.querySelector('.folder-explorer').focus()})()`,
    );
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
      'preset ' + text,
    );
    await evaluate('document.querySelector(".command-result[aria-selected=true]").click()');
  };
  const click = (label: string, scope: string) =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const completed = (count: number) =>
    until(
      () => evaluate<OperationJob[]>('window.viewer.jobs()'),
      (jobs) => jobs.length === count && jobs.every((job) => job.status === 'completed'),
      'preset exports ' + count,
      30000,
    );
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
    (value) => value === 4,
    'preset inputs',
  );
  await choose('Photo.png');
  await run('Images for web');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".image-tools-dialog canvas")'),
    Boolean,
    'image review',
  );
  assert.deepEqual(
    await evaluate(
      '["Image quality","Output width","Output height"].map(label=>document.querySelector(`[aria-label="${label}"]`).value)',
    ),
    ['80', '2048', '2048'],
  );
  assert.equal(
    (await evaluate<OperationJob[]>('window.viewer.jobs()')).length,
    0,
    'opening a preset does not export',
  );
  await until(
    () => evaluate<boolean>('!document.querySelector(".image-tools-preview .loading")'),
    Boolean,
    'image source decoded',
  );
  await capture('images-for-web-dark');
  await click('Export image', '.image-tools-dialog');
  await completed(1);
  await click('Close', '.image-tools-dialog');
  await choose('Photo.png');
  await choose('Second.jpg', true);
  await run('Batch convert images');
  await until(
    () => evaluate<string>('document.querySelector(".image-tools-dialog")?.textContent||""'),
    (text) => text.includes('2 images'),
    'batch review',
  );
  assert.equal(await evaluate('document.querySelector(\'[aria-label="Output width"]\').value'), '');
  await click('Export 2 images', '.image-tools-dialog');
  await completed(2);
  await click('Close', '.image-tools-dialog');
  await choose('Manual.pdf');
  await run('PDF for email');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".optimize-dialog")'),
    Boolean,
    'email review',
  );
  assert.equal(
    await evaluate('document.querySelector(\'[aria-label="PDF maximum image edge"]\').value'),
    '1600',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(\'[aria-label=\"Recompress scanned images\"]\').checked',
    ),
    true,
  );
  assert.ok(
    await evaluate<boolean>(
      'document.querySelector(\'[aria-label="Optimization preset"]\').textContent.includes("Smaller")',
    ),
  );
  await capture('pdf-for-email-dark');
  await click('Prepare candidates', '.optimize-dialog');
  await until(
    () =>
      evaluate<boolean>(
        `[...document.querySelectorAll('.optimize-dialog button')].some(button => button.textContent.trim() === 'Save 1 smaller copy' && !button.disabled)`,
      ),
    Boolean,
    'email optimization candidate',
    60000,
  );
  await click('Save 1 smaller copy', '.optimize-dialog');
  await completed(3);
  await click('Close', '.optimize-dialog');
  await choose('Recording.wav');
  await run('Extract audio');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".media-export-options")'),
    Boolean,
    'audio review',
  );
  await until(
    () =>
      evaluate<string>('document.querySelector(\'[aria-label="Export format"]\')?.textContent||""'),
    (text) => text.includes('AAC audio'),
    'audio preset format',
  );
  await capture('extract-audio-dark');
  await click('Export sequence', '.media-export-options');
  const jobs = await completed(4);
  assert.ok(
    jobs.flatMap((job) => job.completed).some((item) => item.destination?.endsWith('.m4a')),
  );
  assert.deepEqual(await hashes(), before);
  console.log(
    'Preset acceptance:',
    JSON.stringify({
      root,
      jobs: jobs.length,
      outputs: jobs.flatMap((job) => job.completed).length,
      sources: 'unchanged SHA256',
    }),
  );
} catch (error) {
  if (connection)
    console.log(
      'Preset surface:',
      await connection.evaluate('document.body.innerText.slice(-6000)'),
    );
  throw error;
} finally {
  await app.close(connection);
  console.log('Retained preset evidence:', root);
}
