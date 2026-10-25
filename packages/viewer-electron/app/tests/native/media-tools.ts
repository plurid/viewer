/** Packaged UI → private drafts → bundled processors → guarded file operations.
 * All input, output, interrupted stages and screenshots are generated and retained. */
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
import type { MediaDraft } from '../../src/domain/media/documents';
import { localSamples } from '../../tools/playground/catalog';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-media-tools-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await Promise.all([mkdir(files), mkdir(profile)]);
const samples = await localSamples(),
  video = path.join(files, 'Motion.mp4'),
  image = path.join(files, 'Color.png');
await writeFile(video, samples.find((sample) => sample.formats.includes('mp4'))!.bytes, {
  flag: 'wx',
});
await writeFile(image, samples.find((sample) => sample.formats.includes('png'))!.bytes, {
  flag: 'wx',
});
const hashes = async () =>
  Promise.all(
    [video, image].map(async (file) =>
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    ),
  );
const before = await hashes(),
  settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'media-check',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'media-check',
      name: 'Media tools',
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
let app = await ownedApp(binary, profile),
  connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { command, evaluate } = connection;
  const capture = async (name: string) => {
    await evaluate('new Promise(resolve=>setTimeout(resolve,400))');
    if (name.startsWith('image'))
      console.log(
        name,
        await evaluate(
          '(() => {const c=document.querySelector(".image-tools-canvas canvas"),p=document.querySelector(".image-tools-preview");return {canvas:c&&{width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()},parent:p&&{rect:p.getBoundingClientRect().toJSON(),scroll:p.scrollTop}}})()',
        ),
      );
    if (name.startsWith('media'))
      console.log(
        name,
        await evaluate(
          '(() => {const v=document.querySelector(".media-editor video");return v&&{state:v.readyState,network:v.networkState,paused:v.paused,seeking:v.seeking,error:v.error&&v.error.message,time:v.currentTime}})()',
        ),
      );
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const data = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    if (name.startsWith('image')) {
      const point = await evaluate<{ x: number; y: number }>(
        '(() => {const r=document.querySelector(".image-tools-canvas canvas").getBoundingClientRect();return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height*.35)}})()',
      );
      const sharp = createRequire(import.meta.url)(
        `../../assets/viewer-processors-${process.platform}-${process.arch}/node_modules/sharp`,
      );
      const pixel: Buffer = await sharp(Buffer.from(data.data, 'base64'))
        .extract({ left: point.x, top: point.y, width: 1, height: 1 })
        .raw()
        .toBuffer();
      assert.ok(
        pixel[0]! > 80 &&
          pixel[1]! > 140 &&
          pixel[2]! > 160 &&
          pixel[2]! - pixel[1]! > 10 &&
          pixel[1]! - pixel[0]! > 20,
        name + ' shows the actual blue source image, rather than a blank canvas.',
      );
    }
    await writeFile(path.join(root, name + '.png'), Buffer.from(data.data, 'base64'), {
      flag: 'wx',
    });
  };
  const press = async (key: string, code: string, windowsVirtualKeyCode: number) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  };
  const preview = async (file: string) => {
    await until(
      () =>
        evaluate<boolean>(
          `Array.from(document.querySelectorAll('[data-file-path]')).some(row=>row.dataset.filePath===${JSON.stringify(file)})`,
        ),
      Boolean,
      'source row',
    );
    await evaluate(
      `(() => { const row=Array.from(document.querySelectorAll('[data-file-path]')).find(row=>row.dataset.filePath===${JSON.stringify(file)});row.click();row.focus(); })()`,
    );
    await press(' ', 'Space', 32);
    await until(
      () => evaluate<boolean>('!!document.querySelector(".quick-preview")'),
      Boolean,
      'quick preview',
    );
  };
  const clickText = (scope: string, text: string) =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const input = async (selector: string, value: string) => {
    await evaluate(
      `(() => { const field=document.querySelector(${JSON.stringify(selector)});field.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).blur()`);
  };
  const choose = async (label: string, value: string) => {
    await evaluate(
      `document.querySelector('button[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
    );
    await until(
      () => evaluate<boolean>(`!!document.querySelector('[data-menu-id="choice:${value}"]')`),
      Boolean,
      'choice menu',
    );
    await evaluate(`document.querySelector('[data-menu-id="choice:${value}"]').click()`);
  };
  await preview(video);
  await until(
    () =>
      evaluate<boolean>(
        'Array.from(document.querySelectorAll(".quick-preview button")).some(button=>button.textContent.trim()==="Edit media…")',
      ),
    Boolean,
    'media edit action',
  );
  await clickText('.quick-preview', 'Edit media…');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".media-editor video")'),
    Boolean,
    'linked media editor',
    15000,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".media-filmstrip img").length'),
    (count) => count === 4,
    'packaged frame utility',
  );
  await input('.media-editor input[aria-label="In"]', '00:00.250');
  await input('.media-editor input[aria-label="Out"]', '00:01.250');
  await until(
    () => evaluate<string>('document.querySelector(".media-segment-label").textContent'),
    (text) => text.includes('00:00.250') && text.includes('00:01.250'),
    'edited segment range',
  );
  await clickText('.media-export-options', 'Export sequence');
  const jobs = await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
    (jobs) => jobs.some((job) => job.kind === 'convert' && job.status === 'completed'),
    'packaged media export',
    30000,
  );
  const output = jobs.find((job) => job.kind === 'convert' && job.status === 'completed')!
    .completed[0]!.destination!;
  const exported = await evaluate<MediaDraft>(
    'window.viewer.media({kind:"create",paths:[' + JSON.stringify(output) + ']})',
  );
  assert.ok(
    Math.abs(exported.sources[0]!.info.duration - 1) < 0.08,
    'Exact output duration is within a frame and audio packet.',
  );
  await until(
    () => evaluate<number>('document.querySelector(".media-editor video").readyState'),
    (value) => value >= 2,
    'decoded editor playback',
  );
  const playerBounds = await evaluate<{ player: number; video: number }>(
    '({player:document.querySelector(".media-editor-player").getBoundingClientRect().height,video:document.querySelector(".media-editor video").getBoundingClientRect().height})',
  );
  assert.ok(
    playerBounds.video <= playerBounds.player && playerBounds.player < 400,
    'Player stays inside its stage and leaves room for editing.',
  );
  await until(
    () => evaluate<string>('document.querySelector(".media-editor-notice")?.textContent || ""'),
    (value) => value.includes('Exported 1 file') && value.includes('Motion edited.mp4'),
    'visible completed export',
  );
  await clickText('.media-playback-controls', 'Play');
  await until(
    () => evaluate<number>('document.querySelector(".media-editor video").currentTime'),
    (value) => value > 0.25,
    'actual editor playback advances',
  );
  await clickText('.media-playback-controls', 'Pause');
  await capture('media-dark');
  const saved = await until(
    async () =>
      JSON.parse(await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')) as SavedState,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'media'),
    'saved media view',
  );
  const pane = saved.workspaces[0]!.panes.find((pane) => pane.type === 'media')!;
  assert.equal(pane.type, 'media');
  const draft = await evaluate<MediaDraft>(
    'window.viewer.media({kind:"get",id:' + JSON.stringify(pane.draftID) + '})',
  );
  assert.equal(draft.plan.segments[0]!.start, 0.25);
  assert.equal(draft.plan.segments[0]!.end, 1.25);
  await evaluate(
    'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.appearance",value:"light"}],s.revision))',
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === 'light',
    'light theme',
  );
  await capture('media-light');
  await evaluate(
    `document.querySelector('[data-viewer-plane="${pane.id}"] [aria-label="Dock plane"]').click()`,
  );
  await until(
    () =>
      evaluate<boolean>(
        `!!document.querySelector('[data-viewer-plane="${pane.id}"] [aria-label="Reveal space"]')`,
      ),
    Boolean,
    'docked media view',
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => evaluate<number>('document.querySelector(".media-editor").getBoundingClientRect().left'),
    (value) => value >= -2 && value < 50,
    'media follows narrow viewport',
  );
  await capture('media-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  await evaluate(
    `document.querySelector('[data-viewer-plane="${pane.id}"] [aria-label="Close plane"]').click()`,
  );
  await until(
    () => evaluate<boolean>('!document.querySelector(".media-editor")'),
    Boolean,
    'close media view',
  );
  await preview(image);
  await until(
    () =>
      evaluate<boolean>(
        'Array.from(document.querySelectorAll(".quick-preview button")).some(button=>button.textContent.trim()==="Image tools…")',
      ),
    Boolean,
    'image tools action',
  );
  await clickText('.quick-preview', 'Image tools…');
  await until(
    () => evaluate<number>('document.querySelector(".image-tools-canvas canvas")?.width||0'),
    (value) => value > 0,
    'packaged Sharp inspection',
    15000,
  );
  await choose('Image output format', 'avif');
  await until(
    () => evaluate<number>('document.querySelector(".image-tools-canvas canvas")?.width || 0'),
    (value) => value > 300,
    'decoded source image',
  );
  await input('.image-tools-options input[aria-label="Output width"]', '48');
  await clickText('.image-tools-dialog', 'Export image');
  const images = await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
    (jobs) =>
      jobs.some(
        (job) => job.status === 'completed' && job.completed[0]?.destination?.endsWith('.avif'),
      ),
    'packaged image export',
    30000,
  );
  const imageOutput = images.find(
    (job) => job.status === 'completed' && job.completed[0]?.destination?.endsWith('.avif'),
  )!.completed[0]!.destination!;
  const imageInfo = await evaluate<{ width: number; height: number; preview: { id: string } }>(
    'window.viewer.imageInspect(' + JSON.stringify(imageOutput) + ')',
  );
  assert.ok(imageInfo.width <= 48);
  await evaluate('window.viewer.release(' + JSON.stringify(imageInfo.preview.id) + ')');
  await capture('image-light');
  await evaluate(
    'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.appearance",value:"dark"}],s.revision))',
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === 'dark',
    'dark image theme',
  );
  await capture('image-dark');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('image-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  await clickText('.image-tools-dialog', 'Close');
  await app.close(connection);
  connection = undefined;
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  const restored = await connection.evaluate<MediaDraft>(
    'window.viewer.media({kind:"get",id:' + JSON.stringify(pane.draftID) + '})',
  );
  assert.equal(restored.plan.segments[0]!.start, 0.25);
  assert.equal(restored.plan.segments[0]!.end, 1.25);
  assert.deepEqual(await hashes(), before);
  observations.push({
    mediaOutput: output,
    seconds: exported.sources[0]!.info.duration,
    imageOutput,
    imageWidth: imageInfo.width,
    drafts: 'survive view close and application restart',
    inputs: 'SHA256 unchanged',
  });
} catch (error) {
  if (connection)
    console.log(
      'Media failure surface:',
      await connection.evaluate('document.body.innerText.slice(-7000)'),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  console.log('Retained media evidence:', root);
}
