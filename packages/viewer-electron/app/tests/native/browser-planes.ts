/** Isolated real Chromium/3D input checks. Generated sites, profiles and captures are retained. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import type { BrowserRequest, BrowserSnapshot } from '../../src/domain/previews/browser';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { click, exists, patchSettings, textOf, valueOf } from './runtime/page';
import { pageCall } from './runtime/page-function';
import type { PageExpression } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-browser-');
const profile = path.join(root, 'Profile');
await mkdir(profile);
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><meta charset="utf-8"><title>Owned browser check</title>
<style>body{margin:0;font:16px system-ui;background:#f0f4f7}h1{position:absolute;left:20px;top:0}input{position:absolute;left:20px;top:75px;width:300px;height:32px}button{position:absolute;left:20px;top:130px;height:36px}#result{position:absolute;left:20px;top:185px}main{height:2000px}</style>
<h1>Browser fixture</h1><input aria-label="Fixture input" id="input" oninput="document.querySelector('#typed').style.background='#4477ee'"><button id="button" onclick="document.querySelector('#result').textContent='Clicked';document.querySelector('#clicked').style.background='#00cc66'">Click fixture</button><div id="result">Ready</div><div id="clicked" style="position:absolute;left:20px;top:240px;width:100px;height:40px;background:#ee3344"></div><div id="typed" style="position:absolute;left:140px;top:240px;width:100px;height:40px;background:#ee3344"></div><main></main>
<script>document.documentElement.dataset.cookie=document.cookie;document.cookie='viewer_fixture=retained; Max-Age=3600; SameSite=Lax';document.documentElement.dataset.viewer=typeof window.viewer;document.documentElement.dataset.require=typeof window.require;addEventListener('wheel',(event)=>{document.documentElement.dataset.wheel=event.clientX+','+event.clientY},{passive:true});</script>`);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/owned`;
const settings = defaultSettings(root);
settings.hotkey.enabled = false;
settings.providers = [];
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'browser-check',
  favorites: [],
  recents: [],
  ui: normalizePreferences(),
  workspaces: [
    {
      id: 'browser-check',
      name: 'Browser check',
      roots: ['browser'],
      activePane: 'browser',
      arrangement: {},
      panes: [{ id: 'browser', type: 'browser', path: root, url }],
    },
  ],
};
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: state.ui }),
);
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const observations: unknown[] = [];
type BrowserAction = Extract<BrowserRequest, { kind: 'action' }>['action'];
const tilt = ' rotateY(20deg) rotateX(8deg)';

/** What the guest page can reach of Viewer and Node. */
function guestBridges() {
  const page = window as unknown as { viewer?: unknown; require?: unknown };
  return [typeof page.viewer, typeof page.require];
}

function compositedFrame() {
  const canvas = document.querySelector<HTMLCanvasElement>('.browser-surface canvas')!;
  return canvas.width > 300 && !!canvas.getContext('2d')!.getImageData(30, 30, 1, 1).data[3];
}

function surfaceSize() {
  const rect = document.querySelector('.browser-surface')!.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

const browserState = () =>
  window.viewer.browser({ kind: 'state', id: 'browser' }) as Promise<BrowserSnapshot>;

const browserAction = (action: BrowserAction) =>
  window.viewer.browser({ kind: 'action', id: 'browser', action });

/** Adds `tilt` to the browser plane's transform, or takes it off again. */
function tiltBrowserPlane(tilt: string, on: boolean) {
  const plane = document
    .querySelector('.browser-plane')!
    .closest<HTMLElement>('[data-plurid-plane]')!;
  plane.style.transform = on
    ? plane.style.transform + tilt
    : plane.style.transform.replace(tilt, '');
}

/** The red, green and blue of one displayed surface pixel. */
const canvasPixel = (x: number, y: number) =>
  Array.from(
    document
      .querySelector<HTMLCanvasElement>('.browser-surface canvas')!
      .getContext('2d')!
      .getImageData(x, y, 1, 1).data,
  ).slice(0, 3);

/** Where a point of the untransformed surface lands on screen. */
function surfacePoint(x: number, y: number) {
  const surface = document.querySelector('.browser-surface')!,
    probe = document.createElement('span');
  probe.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0`;
  surface.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return { x: rect.left, y: rect.top };
}

/** Where the browser plane is on screen: it moves when the camera does. */
function planeRect() {
  const rect = document
    .querySelector('.browser-plane')!
    .closest('[data-plurid-plane]')!
    .getBoundingClientRect();
  return [rect.left, rect.top, rect.width, rect.height];
}

const pageScroll = () => window.scrollY;

/** Where the page's last wheel event was, in its CSS pixels. */
function wheelPosition() {
  const [x = NaN, y = NaN] = (document.documentElement.dataset.wheel ?? '').split(',').map(Number);
  return { x, y };
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function selectionLength() {
  const input = document.querySelector<HTMLInputElement>('#input')!;
  return input.selectionEnd! - input.selectionStart!;
}

const showBrowser = (visible: boolean) =>
  window.viewer.browser({ kind: 'viewport', id: 'browser', width: 960, height: 640, visible });
let app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { command, evaluate } = connection;
  await until(() => evaluate(exists('.browser-surface canvas')), Boolean, 'browser surface');
  const target = await until(
    async () =>
      (
        (await fetch(`http://127.0.0.1:${app.port}/json/list`).then((response) =>
          response.json(),
        )) as { id: string; url: string }[]
      ).find((target) => target.url === url),
    Boolean,
    'owned guest target',
  );
  const { sessionId } = await command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target!.id,
    flatten: true,
  });
  const guest = <R>(expression: PageExpression<R>) => evaluate(expression, { sessionId });
  await until(
    () => guest(pageCall(() => document.readyState)),
    (value) => value === 'complete',
    'guest ready',
  );
  assert.deepEqual(await guest(pageCall(guestBridges)), ['undefined', 'undefined']);
  await until(() => evaluate(pageCall(compositedFrame)), Boolean, 'composited frame', 10000);
  // the page fills its plane: a collapsed surface still composites, but shows nothing and takes no
  // clicks
  const shown = await evaluate(pageCall(surfaceSize));
  assert.ok(
    shown.width > 300 && shown.height > 200,
    'browser surface fills its plane: ' + JSON.stringify(shown),
  );
  const snapshot = await evaluate(pageCall(browserState));
  observations.push(snapshot);
  console.log('Browser state:', JSON.stringify(snapshot));
  await evaluate(pageCall(tiltBrowserPlane, tilt, true));
  const pixel = (x: number) => evaluate(pageCall(canvasPixel, x, 255));
  const point = (x: number, y: number) => evaluate(pageCall(surfacePoint, x, y));
  const clickAt = async (x: number, y: number) => {
    const at = await point(x, y);
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...at,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...at,
    });
  };
  await clickAt(90, 145);
  await until(
    () => guest(textOf('#result')),
    (value) => value === 'Clicked',
    'rotated pointer click',
  );
  await until(
    () => pixel(30),
    (value) => value.join(',') === '0,204,102',
    'displayed clicked pixels',
  );
  await clickAt(80, 90);
  await command('Input.insertText', { text: 'Typed through a rotated plane' });
  await until(
    () => guest(valueOf('#input')),
    (value) => value === 'Typed through a rotated plane',
    'rotated text input',
  );
  await command('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await command('Input.insertText', { text: '你好' });
  await until(
    () => guest(valueOf('#input')),
    (value) => value === 'Typed through a rotated plane你好',
    'actual composition proxy',
  );
  await until(
    () => pixel(150),
    (value) => value.join(',') === '68,119,238',
    'displayed text-entry pixels',
  );
  await clickAt(180, 90);
  await clickAt(180, 90);
  await until(
    () => guest(pageCall(selectionLength)),
    (value) => value > 0,
    'rotated double-click selection',
  );
  // The clicked plane takes the wheel: the page scrolls, and the space stays where it is.
  const wheelAt = async (x: number, y: number, deltaY: number) =>
    command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...(await point(x, y)),
      deltaX: 0,
      deltaY,
    });
  const resting = await evaluate(pageCall(planeRect));
  await wheelAt(400, 300, 120);
  await until(
    () => guest(pageCall(pageScroll)),
    (y) => y > 0,
    'wheel scrolls the page',
  );
  await wheelAt(400, 300, -120);
  await until(
    () => guest(pageCall(pageScroll)),
    (y) => y === 0,
    'wheel scrolls the page back',
  );
  await evaluate(pageCall(pause, 400));
  assert.deepEqual(await evaluate(pageCall(planeRect)), resting, 'the wheel leaves the space');
  await evaluate(pageCall(showBrowser, false));
  await evaluate(pageCall(showBrowser, true));
  assert.ok((await guest(valueOf('#input'))).includes('Typed'));
  await until(
    () => pixel(30),
    (value) => value.join(',') === '0,204,102',
    'repaint after culling',
  );
  const screenshot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'browser-rotated.png'), Buffer.from(screenshot.data, 'base64'), {
    flag: 'wx',
  });
  observations.push({
    pointer: 'rotated click passed',
    wheel: 'the page scrolls, the space stays',
    keyboard: 'text passed',
    composition: 'actual proxy passed',
    pixels: 'interaction state composited',
    culling: 'state retained',
  });
  await evaluate(
    pageCall(
      (url: string) => window.viewer.browser({ kind: 'navigate', id: 'browser', url }),
      `http://127.0.0.1:${port}/second`,
    ),
  );
  await until(
    () => evaluate(pageCall(browserState)),
    (value) => value.back,
    'navigation history',
  );
  await evaluate(pageCall(browserAction, 'back'));
  await until(
    () => evaluate(pageCall(browserState)),
    (value) => value.url === url,
    'back navigation',
  );
  await evaluate(pageCall(browserAction, 'zoom-in'));
  const { zoom } = await evaluate(pageCall(browserState));
  assert.ok(zoom > 1);
  // page zoom scales the page's CSS pixels: the wheel still lands under the pointer
  await wheelAt(400, 300, 120);
  await until(
    () => guest(pageCall(wheelPosition)),
    (at) => Math.abs(at.x - 400 / zoom) < 2 && Math.abs(at.y - 300 / zoom) < 2,
    'zoomed wheel position',
  );
  await wheelAt(400, 300, -120);
  await until(
    () => guest(pageCall(pageScroll)),
    (y) => y === 0,
    'zoomed wheel scrolls back',
  );
  await evaluate(pageCall(browserAction, 'zoom-reset'));
  const capture = async (name: string) => {
    await evaluate(
      pageCall((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), 400),
    );
    const shot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(shot.data, 'base64'), {
      flag: 'wx',
    });
  };
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
    (value) => value === 'light',
    'light browser chrome',
  );
  await capture('browser-light');
  await evaluate(pageCall(tiltBrowserPlane, tilt, false));
  await evaluate(click('[data-viewer-plane=browser] [aria-label="Dock plane"]'));
  await until(
    () => evaluate(exists('[data-viewer-plane=browser] [aria-label="Reveal space"]')),
    Boolean,
    'docked browser view',
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
        pageCall(() => document.querySelector('.browser-plane')!.getBoundingClientRect().left),
      ),
    (value) => value >= -2 && value < 50,
    'browser follows narrow viewport',
  );
  await capture('browser-narrow');
  await command('Emulation.clearDeviceMetricsOverride');
  await app.close(connection);
  connection = undefined;
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  const restartTarget = await until(
    async () =>
      (
        (await fetch(`http://127.0.0.1:${app.port}/json/list`).then((response) =>
          response.json(),
        )) as { id: string; url: string }[]
      ).find((target) => target.url === url),
    Boolean,
    'restored guest',
  );
  const restarted = await connection.command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: restartTarget!.id,
    flatten: true,
  });
  await until(
    () =>
      connection!.evaluate(
        pageCall(() => document.documentElement?.dataset.cookie || ''),
        { sessionId: restarted.sessionId },
      ),
    (value) => value?.includes('viewer_fixture=retained'),
    'cookie persistence after application restart',
  );
  await connection.evaluate(
    pageCall(() => window.viewer.browser({ kind: 'close', id: 'browser' })),
  );
  const bitmap = await connection.evaluate(
    pageCall(
      (url: string) =>
        window.viewer.browser({
          kind: 'open',
          id: 'browser',
          url,
          width: 960,
          height: 640,
          texture: false,
        }) as Promise<BrowserSnapshot>,
      url,
    ),
  );
  assert.equal(bitmap.transport, 'bitmap');
  await until(
    () => connection!.evaluate(pageCall(canvasPixel, 30, 255)),
    (value) => value.join(',') === '238,51,68',
    'bitmap fallback pixels',
  );
  observations.push({
    navigation: 'back and zoom passed',
    profile: 'cookies survive graceful app restart',
    fallback: 'bitmap pixels passed',
  });
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify(
      { error: error instanceof Error ? error.stack : String(error), observations },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  if (connection)
    console.log(
      'Browser failure surface:',
      await connection.evaluate(
        pageCall(() => document.querySelector<HTMLElement>('.browser-plane')?.innerText),
      ),
    );
  throw error;
} finally {
  await app.close(connection);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  console.log('Retained browser evidence:', root);
}
