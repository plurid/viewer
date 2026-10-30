/** Packaged private image decoding. Sources, profile, outputs and captures stay retained. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { localSamples } from '../../tools/playground/catalog';
import { ownedApp, until } from '../owned-app';
import { click, countOf, exists } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-image-isolation-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const inputs: { file: string; hash: string }[] = [];
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const svgSample = (await localSamples()).find((sample) => sample.formats.includes('svg'))!;
for (const extension of ['png', 'tiff', 'heic', 'psd', 'exr', 'jp2', 'svg']) {
  const bytes =
    extension === 'svg'
      ? Buffer.from(svgSample.bytes)
      : await readFile(path.resolve('tools/playground/assets', `study.${extension}`));
  const file = path.join(files, `Study.${extension}`);
  await writeFile(file, bytes, { flag: 'wx' });
  inputs.push({ file, hash: digest(bytes) });
}
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'images',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'images',
      name: 'Private image acceptance',
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

/** Thumbnails and renditions of one image through the private decoder, then their release. */
async function privateImage(file: string) {
  const sizes: { size: number; width: number; height: number; milliseconds: number }[] = [];
  for (const size of [128, 512, 128]) {
    const start = performance.now();
    const image = new Image();
    image.src = await window.viewer.thumbnail(file, size);
    await image.decode();
    if (!image.naturalWidth || Math.max(image.naturalWidth, image.naturalHeight) > size)
      throw new Error('Invalid private thumbnail');
    sizes.push({
      size,
      width: image.naturalWidth,
      height: image.naturalHeight,
      milliseconds: performance.now() - start,
    });
  }
  const source = await window.viewer.resource(file);
  const children: string[] = [];
  try {
    for (let index = 0; index < 3; index++) {
      const rendered = await window.viewer.imageRendition(source.id);
      children.push(rendered.url);
      if (rendered.derivation?.kind !== 'image') throw new Error('Not a private rendition');
      const image = new Image();
      image.src = rendered.url;
      await image.decode();
      if (!image.naturalWidth) throw new Error('Empty rendition');
      await window.viewer.release(rendered.id);
    }
  } finally {
    await window.viewer.release(source.id);
  }
  const expired = await Promise.all(
    children.map((url) =>
      fetch(url).then(
        (reply) => !reply.ok,
        () => true,
      ),
    ),
  );
  if (expired.some((value) => !value)) throw new Error('Released image remains readable');
  return { sizes, expired };
}

/** Selects a row, then focuses the folder list, where Space opens Quick Preview. */
function selectRow(selector: string): void {
  document.querySelector<HTMLElement>(selector)!.click();
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
}

function previewImageShown(): boolean {
  const image = document.querySelector<HTMLImageElement>('.quick-preview .image-stage img');
  return !!image?.complete && image.naturalWidth > 0;
}

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (count) => count === inputs.length,
    'image fixture list',
  );
  for (const { file } of inputs) {
    const outcome = await evaluate(pageCall(privateImage, file));
    observations.push({ file: path.basename(file), outcome });
    await evaluate(pageCall(selectRow, `[data-file-path="${file}"]`));
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', {
        type,
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
      });
    await until(() => evaluate(pageCall(previewImageShown)), Boolean, 'rendered image pixels');
    if (file.endsWith('.heic') || file.endsWith('.exr')) {
      const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(
        path.join(root, path.basename(file) + '.png'),
        Buffer.from(image.data, 'base64'),
        { flag: 'wx' },
      );
    }
    await evaluate(click('.quick-preview-dialog [aria-label="Close"]'));
    await until(
      () => evaluate(exists('.quick-preview-dialog')),
      (open) => !open,
      'preview closed',
    );
  }
  for (const { file, hash } of inputs) assert.equal(digest(await readFile(file)), hash);
  await app.close(connection);
  connection = undefined;
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ pass: true, binary, observations, inputs }, null, 2),
    { flag: 'wx' },
  );
  console.log('Packaged private-image acceptance passed:', root);
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), observations }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  if (connection) await app.close(connection);
}
