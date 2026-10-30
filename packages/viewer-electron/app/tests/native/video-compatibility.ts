/** Real OGV playback, audio decoding, seeking, warm ranges and cancellation. Inputs retained. */
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import type { Resource } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { countOf, exists, patchSettings, textOf } from './runtime/page';
import { pageCall } from './runtime/page-function';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-video-copy-'),
  files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
await mkdir(files);
await mkdir(profile);
const original = path.join(defaultPlaygroundDirectory, 'previews/video/Big Buck Bunny trailer.ogv'),
  file = path.join(files, 'Trailer.ogv'),
  cancelFile = path.join(files, 'Cancel.ogv');
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const before = await hash(original);
await copyFile(original, file, 1);
await copyFile(original, cancelFile, 1);
await writeFile(path.join(files, 'Broken.mkv'), 'generated invalid video', { flag: 'wx' });
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'video',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'video',
      name: 'Video compatibility',
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
await writeFile(path.join(profile, 'settings.json'), JSON.stringify(settings), { flag: 'wx' });

/** Chromium's count of decoded audio bytes, outside the DOM types. */
interface DecodingVideo extends HTMLVideoElement {
  webkitAudioDecodedByteCount?: number;
}

const pageDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function videoBounds() {
  const r = document.querySelector('.quick-preview video')!.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function selectRow(row: string): void {
  document.querySelector<HTMLElement>(row)!.click();
  document.querySelector<HTMLElement>('.folder-explorer')!.focus();
}

/** Whether the compatibility copy shows a decoded picture, with its size and duration. */
function compatiblePicture() {
  const v = document.querySelector<HTMLVideoElement>('.quick-preview video');
  return {
    ready:
      !!v &&
      v.readyState >= 2 &&
      v.videoWidth > 0 &&
      document.querySelector('.quick-preview')!.textContent.includes('Compatibility copy') &&
      !document.querySelector('.media-loading'),
    width: v?.videoWidth ?? 0,
    height: v?.videoHeight ?? 0,
    duration: v && Number.isFinite(v.duration) ? v.duration : 0,
  };
}

function playback() {
  const v = document.querySelector<DecodingVideo>('.quick-preview video')!;
  return {
    seconds: v.currentTime,
    frames: v.getVideoPlaybackQuality().totalVideoFrames,
    audio: v.webkitAudioDecodedByteCount ?? 0,
  };
}

function pauseAt(seconds: number): void {
  const video = document.querySelector<HTMLVideoElement>('.quick-preview video')!;
  video.pause();
  video.currentTime = seconds;
}

function seekedTo(seconds: number): boolean {
  const v = document.querySelector<HTMLVideoElement>('.quick-preview video')!;
  return !v.seeking && v.currentTime >= seconds && v.readyState >= 2;
}

/** Times a warm rendition and checks it serves a 512-byte tail range. */
async function warmRendition(file: string) {
  const source = await window.viewer.resource(file);
  let child: Resource | undefined;
  try {
    const start = performance.now();
    child = await window.viewer.videoRendition(source.id, crypto.randomUUID());
    const response = await fetch(child.url, { headers: { Range: 'bytes=-512' } });
    const bytes = await response.arrayBuffer();
    if (response.status !== 206 || bytes.byteLength !== 512)
      throw Error('Derived media range failure');
    return {
      warmMilliseconds: performance.now() - start,
      rangeStatus: response.status,
      rangeBytes: bytes.byteLength,
    };
  } finally {
    if (child) await window.viewer.release(child.id);
    await window.viewer.release(source.id);
  }
}

/** Starts a rendition, cancels it 50 ms later, and reports whether it was cancelled. */
async function cancelledRendition(file: string) {
  const source = await window.viewer.resource(file),
    requestID = crypto.randomUUID(),
    start = performance.now();
  const pending = window.viewer.videoRendition(source.id, requestID);
  setTimeout(() => window.viewer.cancelDocument(source.id, requestID), 50);
  try {
    const child = await pending;
    await window.viewer.release(child.id);
    return { cancelled: false, ms: performance.now() - start };
  } catch {
    return { cancelled: true, ms: performance.now() - start };
  } finally {
    await window.viewer.release(source.id);
  }
}

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
    await evaluate(pageCall(pageDelay, 150));
    const image = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const target = path.join(root, name + '.png');
    const bytes = Buffer.from(image.data, 'base64');
    await writeFile(target, bytes, { flag: 'wx' });
    if (name === 'video-copy-light') {
      const bounds = await evaluate(pageCall(videoBounds));
      const require = createRequire(import.meta.url),
        sharp = require(
          path.resolve(
            path.dirname(binary),
            '../Resources',
            `viewer-processors-darwin-${process.arch}/node_modules/sharp`,
          ),
        );
      const pixels: Buffer = await sharp(bytes)
        .extract({
          left: Math.floor(bounds.x + bounds.width / 4),
          top: Math.floor(bounds.y + bounds.height / 3),
          width: Math.floor(bounds.width / 2),
          height: Math.floor(bounds.height / 3),
        })
        .resize(100, 100)
        .removeAlpha()
        .raw()
        .toBuffer();
      let blue = 0;
      for (let index = 0; index < pixels.length; index += 3)
        if (pixels[index]! < 80 && pixels[index + 1]! > 100 && pixels[index + 2]! > 120) blue++;
      assert.ok(blue > 30, 'Paused title-frame pixels survive the light-theme repaint');
    }
    captures.push(target);
  };
  const preview = async (source: string) => {
    await evaluate(pageCall(selectRow, `[data-file-path="${source}"]`));
    await key(' ', 'Space', 32);
  };
  const close = async () => {
    await key('Escape', 'Escape', 27);
    await until(
      () => evaluate(exists('.quick-preview')),
      (shown) => !shown,
      'preview closes',
    );
  };
  await until(
    () => evaluate(countOf('[data-file-path]')),
    (n) => n === 3,
    'video corpus',
  );
  await preview(file);
  await until(
    () => evaluate(exists('.media-converting')),
    Boolean,
    'automatic compatibility conversion',
  );
  await capture('video-converting');
  const info = await until(
    () => evaluate(pageCall(compatiblePicture)),
    (v) => v.ready,
    'compatible picture',
    120000,
  );
  assert.ok(info.width <= 1280 && info.height <= 720 && info.duration > 32 && info.duration < 34);
  await evaluate(
    pageCall(() => document.querySelector<HTMLVideoElement>('.quick-preview video')!.play()),
  );
  const played = await until(
    () => evaluate(pageCall(playback)),
    (v) => v.seconds > 0.3 && v.frames > 3 && v.audio > 0,
    'actual picture and audio advance',
    10000,
  );
  observations.push({ info, played });
  await evaluate(pageCall(pauseAt, 12));
  await until(() => evaluate(pageCall(seekedTo, 12)), Boolean, 'seek to later video frame');
  await capture('video-copy-dark');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
    (look) => look === 'light',
    'light theme',
  );
  await capture('video-copy-light');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('video-copy-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  await close();
  observations.push(await evaluate(pageCall(warmRendition, file)));
  const cancelled = await evaluate(pageCall(cancelledRendition, cancelFile));
  assert.ok(cancelled.cancelled && cancelled.ms < 5000);
  observations.push(cancelled);
  await preview(path.join(files, 'Broken.mkv'));
  await until(
    () => evaluate(textOf('.quick-preview .empty-state')),
    (text) => text.includes('Compatibility preview unavailable'),
    'corrupt video refusal',
  );
  await capture('video-invalid');
  await close();
  assert.equal((await evaluate(pageCall(() => window.viewer.jobs()))).length, 0);
  assert.equal(await hash(original), before);
  assert.equal(await hash(file), before);
  assert.equal(await hash(cancelFile), before);
} catch (error) {
  if (connection)
    console.log(
      'Video UI:',
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-4000))),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      { root, observations, captures, sha256: before, fixtures: 'preserved' },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log('Video qualification retained:', root);
}
