/** Original camera bytes, independent helper, warm reuse, RAW toggle and bounded failure. */
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { Resource } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { remoteSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { verifyRawOrientation } from './raw-orientation';
import { countOf, exists, patchSettings, pressButton, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-raw-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await mkdir(files);
await mkdir(profile);
const originals = ['Nikon-Z6.NEF', 'Ricoh-GR-III.DNG'];
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const hashes: Record<string, string> = {};
for (const name of originals) {
  const file = path.join(defaultPlaygroundDirectory, 'previews/images/camera-raw', name);
  hashes[name] = await hash(file);
  const reference = remoteSamples.find((sample) => path.basename(sample.path) === name);
  assert.ok(reference, 'Pinned camera fixture: ' + name);
  assert.equal(hashes[name], reference.sha256, 'Pinned original camera bytes: ' + name);
  await copyFile(file, path.join(files, name), 1);
}
await writeFile(path.join(files, 'Broken.nef'), 'generated invalid camera input', { flag: 'wx' });
// A generated unsupported JPEG-XL raw tag keeps the embedded camera JPEG intact.
// This qualifies recovery from Render RAW back to a usable camera image.
const cameraOnly = await readFile(path.join(files, 'Ricoh-GR-III.DNG'));
const firstIFD = cameraOnly.readUInt32LE(4);
const field = (ifd: number, tag: number) => {
  for (let index = 0; index < cameraOnly.readUInt16LE(ifd); index++) {
    const at = ifd + 2 + index * 12;
    if (cameraOnly.readUInt16LE(at) === tag) return cameraOnly.readUInt32LE(at + 8);
  }
  throw new Error('Missing pinned DNG field ' + tag);
};
const rawIFD = cameraOnly.readUInt32LE(field(firstIFD, 330));
let compressionAddress: number | undefined;
for (let index = 0; index < cameraOnly.readUInt16LE(rawIFD); index++) {
  const at = rawIFD + 2 + index * 12;
  if (cameraOnly.readUInt16LE(at) === 259) compressionAddress = at + 8;
}
assert.ok(compressionAddress);
cameraOnly.writeUInt16LE(52546, compressionAddress);
await writeFile(path.join(files, 'Camera-only.DNG'), cameraOnly, { flag: 'wx' });
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'raw',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'raw',
      name: 'RAW previews',
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
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
const orientation = await verifyRawOrientation(
  path.resolve(path.dirname(binary), '../Resources'),
  root,
  path.join(files, 'Ricoh-GR-III.DNG'),
);

const pageDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Decodes the camera rendition and reports its derivation and picture size. */
async function cameraRendition(file: string) {
  const source = await window.viewer.resource(file);
  let child: Resource | undefined;
  try {
    child = await window.viewer.imageRendition(source.id, {
      mode: 'camera',
      requestID: crypto.randomUUID(),
    });
    const image = new Image();
    image.src = child.url;
    await image.decode();
    return {
      kind: child.derivation!.kind,
      decoder: child.derivation!.decoder,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    if (child) await window.viewer.release(child.id);
    await window.viewer.release(source.id);
  }
}

function selectRow(row: string): void {
  document.querySelector<HTMLElement>(row)!.click();
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
}

/** Whether Quick Preview shows a decoded picture; when given, other than `prior` and with
 * `label` in the preview text. */
function pictureShown(label?: string, prior?: string): boolean {
  const img = document.querySelector<HTMLImageElement>('.quick-preview .image-stage img');
  return (
    !!img &&
    img.complete &&
    img.naturalWidth > 0 &&
    (!prior || img.src !== prior) &&
    (!label || document.querySelector('.quick-preview')!.textContent.includes(label))
  );
}

const cameraRecoveryOffered = () =>
  !!document.querySelector('.quick-preview .empty-state') &&
  [...document.querySelectorAll('.quick-preview button')].some(
    (button) => button.textContent.trim() === 'Use camera preview',
  );

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [],
  captures: string[] = [];
try {
  connection = await app.connect();
  const { evaluate, command } = connection;
  const key = async (key: string, code: string, n: number) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n });
  };
  const capture = async (name: string) => {
    await evaluate(pageCall(pageDelay, 250));
    const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const target = path.join(root, name + '.png');
    await writeFile(target, Buffer.from(image.data, 'base64'), { flag: 'wx' });
    captures.push(target);
  };
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (n) => n === 4,
    'camera files',
  );
  for (const name of originals) {
    const file = path.join(files, name);
    const times = [];
    for (let pass = 0; pass < 2; pass++) {
      const start = Date.now();
      const result = await evaluate(pageCall(cameraRendition, file));
      assert.equal(result.kind, 'camera');
      assert.equal(result.decoder, 'LibRaw 0.22.2');
      assert.ok(
        result.width > 1000 &&
          result.height > 1000 &&
          Math.max(result.width, result.height) <= 4096,
      );
      times.push(Date.now() - start);
    }
    await evaluate(pageCall(selectRow, `[data-file-path="${file}"]`));
    await key(' ', 'Space', 32);
    await until(
      () => evaluate(pageCall(pictureShown, 'Camera preview')),
      Boolean,
      'camera preview picture',
    );
    if (name === originals[0]) await capture('raw-camera-dark');
    const prior = await evaluate(
      pageCall(
        () => document.querySelector<HTMLImageElement>('.quick-preview .image-stage img')!.src,
      ),
    );
    await evaluate(pressButton('Render RAW', '.quick-preview'));
    await until(
      () => evaluate(pageCall(pictureShown, 'RAW rendition', prior)),
      Boolean,
      'independent RAW rendition',
    );
    if (name === originals[0]) {
      await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
      await until(
        () => evaluate(pageCall(() => document.documentElement.dataset.look)),
        (look) => look === 'light',
        'light theme',
      );
      await capture('raw-render-light');
      await command('Emulation.setDeviceMetricsOverride', {
        width: 760,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await capture('raw-render-narrow');
      await command('Emulation.clearDeviceMetricsOverride');
      await evaluate(patchSettings({ path: 'settings.appearance', value: 'dark' }));
    }
    await key('Escape', 'Escape', 27);
    await until(
      () => evaluate(exists('.quick-preview')),
      (shown) => !shown,
      'RAW closes',
    );
    observations.push({
      name,
      coldMilliseconds: times[0],
      warmMilliseconds: times[1],
      preview: 'camera plus independent RAW rendition',
    });
  }
  const cameraOnlyFile = path.join(files, 'Camera-only.DNG');
  await evaluate(pageCall(selectRow, `[data-file-path="${cameraOnlyFile}"]`));
  await key(' ', 'Space', 32);
  await until(() => evaluate(pageCall(pictureShown)), Boolean, 'camera-only image');
  await evaluate(pressButton('Render RAW', '.quick-preview'));
  await until(
    () => evaluate(pageCall(cameraRecoveryOffered)),
    Boolean,
    'RAW failure offers camera recovery',
  );
  await capture('raw-camera-recovery');
  await evaluate(pressButton('Use camera preview', '.quick-preview'));
  await until(() => evaluate(pageCall(pictureShown)), Boolean, 'camera image recovered');
  await key('Escape', 'Escape', 27);
  await until(
    () => evaluate(exists('.quick-preview')),
    (shown) => !shown,
    'recovered preview closes',
  );
  const broken = path.join(files, 'Broken.nef');
  await evaluate(pageCall(selectRow, `[data-file-path="${broken}"]`));
  await key(' ', 'Space', 32);
  await until(
    () => evaluate(textOf('.quick-preview .empty-state')),
    (text) => text.includes('Preview unavailable'),
    'corrupt RAW refusal',
  );
  await capture('raw-invalid');
  await key('Escape', 'Escape', 27);
  assert.equal((await evaluate(pageCall(() => window.viewer.jobs()))).length, 0);
  for (const name of originals) {
    assert.equal(await hash(path.join(files, name)), hashes[name]);
    assert.equal(
      await hash(path.join(defaultPlaygroundDirectory, 'previews/images/camera-raw', name)),
      hashes[name],
    );
  }
} catch (error) {
  if (connection)
    console.log(
      'RAW UI:',
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-4000))),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      { root, observations, captures, hashes, orientation, fixtures: 'preserved' },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log('RAW qualification retained:', root);
}
