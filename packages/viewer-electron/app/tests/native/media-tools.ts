/** Packaged UI → private drafts → bundled processors → guarded file operations.
 * All input, output, interrupted stages and screenshots are generated and retained. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import type { MediaDraft, MediaRequest } from '../../src/domain/media/documents';
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

function imageCanvasState() {
  const canvas = document.querySelector<HTMLCanvasElement>('.image-tools-canvas canvas'),
    parent = document.querySelector('.image-tools-preview');
  return {
    canvas: canvas && {
      width: canvas.width,
      height: canvas.height,
      rect: canvas.getBoundingClientRect().toJSON(),
    },
    parent: parent && { rect: parent.getBoundingClientRect().toJSON(), scroll: parent.scrollTop },
  };
}

function editorVideoState() {
  const video = document.querySelector<HTMLVideoElement>('.media-editor video');
  return (
    video && {
      state: video.readyState,
      network: video.networkState,
      paused: video.paused,
      seeking: video.seeking,
      error: video.error && video.error.message,
      time: video.currentTime,
    }
  );
}

/** A point on the image canvas, a third of the way down its centre line. */
function canvasPoint() {
  const box = document.querySelector('.image-tools-canvas canvas')!.getBoundingClientRect();
  return { x: Math.floor(box.left + box.width / 2), y: Math.floor(box.top + box.height * 0.35) };
}

const canvasWidth = () =>
  document.querySelector<HTMLCanvasElement>('.image-tools-canvas canvas')?.width ?? 0;

function hasFileRow(file: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-file-path]')].some(
    (row) => row.dataset.filePath === file,
  );
}

function selectFileRow(file: string) {
  const row = [...document.querySelectorAll<HTMLElement>('[data-file-path]')].find(
    (row) => row.dataset.filePath === file,
  )!;
  row.click();
  row.focus();
}

/** Sets a field's value through the native setter, so React takes the input event as typing. */
function setFieldValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function playerHeights() {
  return {
    player: document.querySelector('.media-editor-player')!.getBoundingClientRect().height,
    video: document.querySelector('.media-editor video')!.getBoundingClientRect().height,
  };
}

/** A media request whose reply is a draft. */
async function mediaDraft(request: MediaRequest) {
  return (await window.viewer.media(request)) as MediaDraft;
}

let app = await ownedApp(binary, profile),
  connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { command, evaluate } = connection;
  const capture = async (name: string) => {
    await evaluate(
      pageCall((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), 400),
    );
    if (name.startsWith('image')) console.log(name, await evaluate(pageCall(imageCanvasState)));
    if (name.startsWith('media')) console.log(name, await evaluate(pageCall(editorVideoState)));
    await evaluate(animationFrames(2));
    const data = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    if (name.startsWith('image')) {
      const point = await evaluate(pageCall(canvasPoint));
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
    await until(() => evaluate(pageCall(hasFileRow, file)), Boolean, 'source row');
    await evaluate(pageCall(selectFileRow, file));
    await press(' ', 'Space', 32);
    await until(() => evaluate(exists('.quick-preview')), Boolean, 'quick preview');
  };
  const clickText = (scope: string, text: string) => evaluate(pressButton(text, scope));
  const input = async (selector: string, value: string) => {
    await evaluate(pageCall(setFieldValue, selector, value));
    await evaluate(
      pageCall(
        (selector: string) => document.querySelector<HTMLElement>(selector)!.blur(),
        selector,
      ),
    );
  };
  const choose = async (label: string, value: string) => {
    await evaluate(click(`button[aria-label=${JSON.stringify(label)}]`));
    await until(() => evaluate(exists(`[data-menu-id="choice:${value}"]`)), Boolean, 'choice menu');
    await evaluate(click(`[data-menu-id="choice:${value}"]`));
  };
  await preview(video);
  await until(
    () => evaluate(buttonState('Edit media…', '.quick-preview')),
    (state) => state !== 'missing',
    'media edit action',
  );
  await clickText('.quick-preview', 'Edit media…');
  await until(() => evaluate(exists('.media-editor video')), Boolean, 'linked media editor', 15000);
  await until(
    () => evaluate(countOf('.media-filmstrip img')),
    (count) => count === 4,
    'packaged frame utility',
  );
  await input('.media-editor input[aria-label="In"]', '00:00.250');
  await input('.media-editor input[aria-label="Out"]', '00:01.250');
  await until(
    () => evaluate(textOf('.media-segment-label')),
    (text) => text.includes('00:00.250') && text.includes('00:01.250'),
    'edited segment range',
  );
  await clickText('.media-export-options', 'Export sequence');
  const jobs = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) => jobs.some((job) => job.kind === 'convert' && job.status === 'completed'),
    'packaged media export',
    30000,
  );
  const output = jobs.find((job) => job.kind === 'convert' && job.status === 'completed')!
    .completed[0]!.destination!;
  const exported = await evaluate(pageCall(mediaDraft, { kind: 'create', paths: [output] }));
  assert.ok(
    Math.abs(exported.sources[0]!.info.duration - 1) < 0.08,
    'Exact output duration is within a frame and audio packet.',
  );
  await until(
    () =>
      evaluate(
        pageCall(() => document.querySelector<HTMLVideoElement>('.media-editor video')!.readyState),
      ),
    (value) => value >= 2,
    'decoded editor playback',
  );
  const playerBounds = await evaluate(pageCall(playerHeights));
  assert.ok(
    playerBounds.video <= playerBounds.player && playerBounds.player < 400,
    'Player stays inside its stage and leaves room for editing.',
  );
  await until(
    () => evaluate(textOf('.media-editor-notice')),
    (value) => value.includes('Exported 1 file') && value.includes('Motion edited.mp4'),
    'visible completed export',
  );
  await clickText('.media-playback-controls', 'Play');
  await until(
    () =>
      evaluate(
        pageCall(
          () => document.querySelector<HTMLVideoElement>('.media-editor video')!.currentTime,
        ),
      ),
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
  const draft = await evaluate(pageCall(mediaDraft, { kind: 'get', id: pane.draftID }));
  assert.equal(draft.plan.segments[0]!.start, 0.25);
  assert.equal(draft.plan.segments[0]!.end, 1.25);
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
    (value) => value === 'light',
    'light theme',
  );
  await capture('media-light');
  await evaluate(click(`[data-viewer-plane="${pane.id}"] [aria-label="Dock plane"]`));
  await until(
    () => evaluate(exists(`[data-viewer-plane="${pane.id}"] [aria-label="Reveal space"]`)),
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
    () =>
      evaluate(
        pageCall(() => document.querySelector('.media-editor')!.getBoundingClientRect().left),
      ),
    (value) => value >= -2 && value < 50,
    'media follows narrow viewport',
  );
  await capture('media-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  await evaluate(click(`[data-viewer-plane="${pane.id}"] [aria-label="Close plane"]`));
  await until(
    () => evaluate(exists('.media-editor')),
    (open) => !open,
    'close media view',
  );
  await preview(image);
  await until(
    () => evaluate(buttonState('Image tools…', '.quick-preview')),
    (state) => state !== 'missing',
    'image tools action',
  );
  await clickText('.quick-preview', 'Image tools…');
  await until(
    () => evaluate(pageCall(canvasWidth)),
    (value) => value > 0,
    'packaged Sharp inspection',
    15000,
  );
  await choose('Image output format', 'avif');
  await until(
    () => evaluate(pageCall(canvasWidth)),
    (value) => value > 300,
    'decoded source image',
  );
  await input('.image-tools-options input[aria-label="Output width"]', '48');
  await clickText('.image-tools-dialog', 'Export image');
  const images = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
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
  const imageInfo = await evaluate(
    pageCall((file: string) => window.viewer.imageInspect(file), imageOutput),
  );
  assert.ok(imageInfo.width <= 48);
  await evaluate(pageCall((id: string) => window.viewer.release(id), imageInfo.preview.id));
  await capture('image-light');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'dark' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
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
  const restored = await connection.evaluate(
    pageCall(mediaDraft, { kind: 'get', id: pane.draftID }),
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
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-7000))),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  console.log('Retained media evidence:', root);
}
