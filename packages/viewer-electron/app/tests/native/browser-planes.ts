/** Isolated real Chromium/3D input checks. Generated sites, profiles and captures are retained. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

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
<script>document.documentElement.dataset.cookie=document.cookie;document.cookie='viewer_fixture=retained; Max-Age=3600; SameSite=Lax';document.documentElement.dataset.viewer=typeof window.viewer;document.documentElement.dataset.require=typeof window.require;</script>`);
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
let app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
try {
  connection = await app.connect();
  const { command, evaluate } = connection;
  await until(
    () => evaluate<boolean>('!!document.querySelector(".browser-surface canvas")'),
    Boolean,
    'browser surface',
  );
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
  const guest = <T>(expression: string) => evaluate<T>(expression, { sessionId });
  await until(
    () => guest<string>('document.readyState'),
    (value) => value === 'complete',
    'guest ready',
  );
  assert.deepEqual(await guest('[typeof window.viewer,typeof window.require]'), [
    'undefined',
    'undefined',
  ]);
  await until(
    () =>
      evaluate<boolean>(
        '(() => { const canvas=document.querySelector(".browser-surface canvas");return canvas.width>300 && !!canvas.getContext("2d").getImageData(30,30,1,1).data[3]; })()',
      ),
    Boolean,
    'composited frame',
    10000,
  );
  const snapshot = await evaluate('window.viewer.browser({kind:"state",id:"browser"})');
  observations.push(snapshot);
  console.log('Browser state:', JSON.stringify(snapshot));
  await evaluate(
    'document.querySelector(".browser-plane").closest("[data-plurid-plane]").style.transform+=" rotateY(20deg) rotateX(8deg)"',
  );
  const pixel = (x: number) =>
    evaluate<number[]>(
      `Array.from(document.querySelector('.browser-surface canvas').getContext('2d').getImageData(${x},255,1,1).data).slice(0,3)`,
    );
  const point = (x: number, y: number) =>
    evaluate<{ x: number; y: number }>(
      `(() => {const surface=document.querySelector('.browser-surface'),probe=document.createElement('span');probe.style.cssText='position:absolute;left:${x}px;top:${y}px;width:0;height:0';surface.append(probe);const rect=probe.getBoundingClientRect();probe.remove();return{x:rect.left,y:rect.top};})()`,
    );
  const click = async (x: number, y: number) => {
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
  await click(90, 145);
  await until(
    () => guest<string>('document.querySelector("#result").textContent'),
    (value) => value === 'Clicked',
    'rotated pointer click',
  );
  await until(
    () => pixel(30),
    (value) => value.join(',') === '0,204,102',
    'displayed clicked pixels',
  );
  await click(80, 90);
  await command('Input.insertText', { text: 'Typed through a rotated plane' });
  await until(
    () => guest<string>('document.querySelector("#input").value'),
    (value) => value === 'Typed through a rotated plane',
    'rotated text input',
  );
  await command('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await command('Input.insertText', { text: '你好' });
  await until(
    () => guest<string>('document.querySelector("#input").value'),
    (value) => value === 'Typed through a rotated plane你好',
    'actual composition proxy',
  );
  await until(
    () => pixel(150),
    (value) => value.join(',') === '68,119,238',
    'displayed text-entry pixels',
  );
  await click(180, 90);
  await click(180, 90);
  await until(
    () =>
      guest<number>(
        'document.querySelector("#input").selectionEnd-document.querySelector("#input").selectionStart',
      ),
    (value) => value > 0,
    'rotated double-click selection',
  );
  await evaluate(
    'window.viewer.browser({kind:"viewport",id:"browser",width:960,height:640,visible:false})',
  );
  await evaluate(
    'window.viewer.browser({kind:"viewport",id:"browser",width:960,height:640,visible:true})',
  );
  assert.ok((await guest<string>('document.querySelector("#input").value')).includes('Typed'));
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
    keyboard: 'text passed',
    composition: 'actual proxy passed',
    pixels: 'interaction state composited',
    culling: 'state retained',
  });
  await evaluate(
    'window.viewer.browser({kind:"navigate",id:"browser",url:' +
      JSON.stringify(`http://127.0.0.1:${port}/second`) +
      '})',
  );
  await until(
    () => evaluate<{ back: boolean }>('window.viewer.browser({kind:"state",id:"browser"})'),
    (value) => value.back,
    'navigation history',
  );
  await evaluate('window.viewer.browser({kind:"action",id:"browser",action:"back"})');
  await until(
    () => evaluate<{ url: string }>('window.viewer.browser({kind:"state",id:"browser"})'),
    (value) => value.url === url,
    'back navigation',
  );
  await evaluate('window.viewer.browser({kind:"action",id:"browser",action:"zoom-in"})');
  assert.ok(
    (await evaluate<{ zoom: number }>('window.viewer.browser({kind:"state",id:"browser"})')).zoom >
      1,
  );
  await evaluate('window.viewer.browser({kind:"action",id:"browser",action:"zoom-reset"})');
  const capture = async (name: string) => {
    await evaluate('new Promise(resolve=>setTimeout(resolve,400))');
    const shot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(shot.data, 'base64'), {
      flag: 'wx',
    });
  };
  await evaluate(
    'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.appearance",value:"light"}],s.revision))',
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === 'light',
    'light browser chrome',
  );
  await capture('browser-light');
  await evaluate(
    'document.querySelector(".browser-plane").closest("[data-plurid-plane]").style.transform=document.querySelector(".browser-plane").closest("[data-plurid-plane]").style.transform.replace(" rotateY(20deg) rotateX(8deg)","")',
  );
  await evaluate(
    'document.querySelector("[data-viewer-plane=browser] [aria-label=\\"Dock plane\\"]").click()',
  );
  await until(
    () =>
      evaluate<boolean>(
        '!!document.querySelector("[data-viewer-plane=browser] [aria-label=\\"Reveal space\\"]")',
      ),
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
    () => evaluate<number>('document.querySelector(".browser-plane").getBoundingClientRect().left'),
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
      connection!.evaluate<string>('document.documentElement?.dataset.cookie || ""', {
        sessionId: restarted.sessionId,
      }),
    (value) => value?.includes('viewer_fixture=retained'),
    'cookie persistence after application restart',
  );
  await connection.evaluate('window.viewer.browser({kind:"close",id:"browser"})');
  const bitmap = await connection.evaluate<{ transport: string }>(
    'window.viewer.browser({kind:"open",id:"browser",url:' +
      JSON.stringify(url) +
      ',width:960,height:640,texture:false})',
  );
  assert.equal(bitmap.transport, 'bitmap');
  await until(
    () =>
      connection!.evaluate<number[]>(
        'Array.from(document.querySelector(".browser-surface canvas").getContext("2d").getImageData(30,255,1,1).data).slice(0,3)',
      ),
    (value) => value.join(',') === '238,51,68',
    'bitmap fallback pixels',
  );
  observations.push({
    navigation: 'back and zoom passed',
    profile: 'cookies survive graceful app restart',
    fallback: 'bitmap pixels passed',
  });
} catch (error) {
  if (connection)
    console.log(
      'Browser failure surface:',
      await connection.evaluate('document.querySelector(".browser-plane")?.innerText'),
    );
  throw error;
} finally {
  await app.close(connection);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  console.log('Retained browser evidence:', root);
}
