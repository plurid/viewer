/** Original camera bytes, independent helper, warm reuse, RAW toggle and bounded failure. */
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { remoteSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { verifyRawOrientation } from './raw-orientation';
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
    await evaluate('new Promise(r=>setTimeout(r,250))');
    const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const target = path.join(root, name + '.png');
    await writeFile(target, Buffer.from(image.data, 'base64'), { flag: 'wx' });
    captures.push(target);
  };
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
    (n) => n === 4,
    'camera files',
  );
  for (const name of originals) {
    const file = path.join(files, name);
    const times = [];
    for (let pass = 0; pass < 2; pass++) {
      const start = Date.now();
      const result = await evaluate<{
        kind: string;
        width: number;
        height: number;
        decoder: string;
      }>(
        `(async()=>{const source=await window.viewer.resource(${JSON.stringify(file)});let child;try{child=await window.viewer.imageRendition(source.id,{mode:'camera',requestID:crypto.randomUUID()});const image=new Image();image.src=child.url;await image.decode();return {kind:child.derivation.kind,decoder:child.derivation.decoder,width:image.naturalWidth,height:image.naturalHeight}}finally{if(child)await window.viewer.release(child.id);await window.viewer.release(source.id)}})()`,
      );
      assert.equal(result.kind, 'camera');
      assert.equal(result.decoder, 'LibRaw 0.22.2');
      assert.ok(
        result.width > 1000 &&
          result.height > 1000 &&
          Math.max(result.width, result.height) <= 4096,
      );
      times.push(Date.now() - start);
    }
    await evaluate(
      `(()=>{document.querySelector(${JSON.stringify(`[data-file-path="${file}"]`)}).click();document.querySelector('.folder-explorer').focus()})()`,
    );
    await key(' ', 'Space', 32);
    await until(
      () =>
        evaluate<boolean>(
          '(()=>{const img=document.querySelector(".quick-preview .image-stage img");return !!img?.complete&&img.naturalWidth>0&&document.querySelector(".quick-preview").textContent.includes("Camera preview")})()',
        ),
      Boolean,
      'camera preview picture',
    );
    if (name === originals[0]) await capture('raw-camera-dark');
    const prior = await evaluate<string>(
      'document.querySelector(".quick-preview .image-stage img").src',
    );
    await evaluate(
      '[...document.querySelectorAll(".quick-preview button")].find(b=>b.textContent.trim()==="Render RAW").click()',
    );
    await until(
      () =>
        evaluate<boolean>(
          `(()=>{const img=document.querySelector('.quick-preview .image-stage img');return !!img?.complete&&img.naturalWidth>0&&img.src!==${JSON.stringify(prior)}&&document.querySelector('.quick-preview').textContent.includes('RAW rendition')})()`,
        ),
      Boolean,
      'independent RAW rendition',
    );
    if (name === originals[0]) {
      await evaluate(
        `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'light'}],s.revision))`,
      );
      await until(
        () => evaluate<string>('document.documentElement.dataset.look'),
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
      await evaluate(
        `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:'dark'}],s.revision))`,
      );
    }
    await key('Escape', 'Escape', 27);
    await until(
      () => evaluate<boolean>('!document.querySelector(".quick-preview")'),
      Boolean,
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
  await evaluate(
    `(()=>{document.querySelector(${JSON.stringify(`[data-file-path="${cameraOnlyFile}"]`)}).click();document.querySelector('.folder-explorer').focus()})()`,
  );
  await key(' ', 'Space', 32);
  await until(
    () =>
      evaluate<boolean>(
        '(()=>{const img=document.querySelector(".quick-preview .image-stage img");return !!img?.complete&&img.naturalWidth>0})()',
      ),
    Boolean,
    'camera-only image',
  );
  await evaluate(
    '[...document.querySelectorAll(".quick-preview button")].find(b=>b.textContent.trim()==="Render RAW").click()',
  );
  await until(
    () =>
      evaluate<boolean>(
        '!!document.querySelector(".quick-preview .empty-state")&&[...document.querySelectorAll(".quick-preview button")].some(b=>b.textContent.trim()==="Use camera preview")',
      ),
    Boolean,
    'RAW failure offers camera recovery',
  );
  await capture('raw-camera-recovery');
  await evaluate(
    '[...document.querySelectorAll(".quick-preview button")].find(b=>b.textContent.trim()==="Use camera preview").click()',
  );
  await until(
    () =>
      evaluate<boolean>(
        '(()=>{const img=document.querySelector(".quick-preview .image-stage img");return !!img?.complete&&img.naturalWidth>0})()',
      ),
    Boolean,
    'camera image recovered',
  );
  await key('Escape', 'Escape', 27);
  await until(
    () => evaluate<boolean>('!document.querySelector(".quick-preview")'),
    Boolean,
    'recovered preview closes',
  );
  const broken = path.join(files, 'Broken.nef');
  await evaluate(
    `(()=>{document.querySelector(${JSON.stringify(`[data-file-path="${broken}"]`)}).click();document.querySelector('.folder-explorer').focus()})()`,
  );
  await key(' ', 'Space', 32);
  await until(
    () =>
      evaluate<string>('document.querySelector(".quick-preview .empty-state")?.textContent||""'),
    (text) => text.includes('Preview unavailable'),
    'corrupt RAW refusal',
  );
  await capture('raw-invalid');
  await key('Escape', 'Escape', 27);
  assert.equal((await evaluate<unknown[]>('window.viewer.jobs()')).length, 0);
  for (const name of originals) {
    assert.equal(await hash(path.join(files, name)), hashes[name]);
    assert.equal(
      await hash(path.join(defaultPlaygroundDirectory, 'previews/images/camera-raw', name)),
      hashes[name],
    );
  }
} catch (error) {
  if (connection)
    console.log('RAW UI:', await connection.evaluate('document.body.innerText.slice(-4000)'));
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
