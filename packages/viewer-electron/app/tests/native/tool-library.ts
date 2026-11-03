/** Local host qualification with handwritten fixtures. No model calls or removals. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Canvases } from '../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { pageCall } from './runtime/page-function';
import { canvasFrame } from './runtime/canvas';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY, 'Choose the freshly built candidate.');
const root = await realpath(await temporaryRoot('viewer-native-tools-'));
const profile = path.join(root, 'Profile');
await mkdir(profile, { mode: 0o700 });
const service = new Canvases(profile, { changed() {} });
const conversationID = randomUUID();
const blank = await service.create(1, conversationID, root);
const html = `<style>body{font:16px system-ui;padding:24px;color:#eee;background:#282c32}button{font:inherit;padding:8px 16px}output{display:block;margin-top:20px}</style>
<h1>Quantity calculator</h1><p>Handwritten host test fixture</p><button id="calculate">Double quantity</button><output></output><script>
const api=window.viewerCanvas;
function render(){document.querySelector('output').textContent=String(api.getState().quantity)}
api.registerAction({id:'double',label:'Double quantity',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}},async(_,{state})=>({result:Number(state.quantity)*2,patch:{quantity:Number(state.quantity)*2}}));
document.querySelector('button').onclick=async()=>{await api.invokeAction('double',{});render()};render();
</script>`;
const original = await service.write(1, blank.id, 0, 'Quantity calculator', html, { quantity: 3 });
await new ChatDocumentStore(path.join(profile, 'chat-documents', conversationID + '.json')).save({
  version: 4,
  id: conversationID,
  title: original.title,
  path: root,
  providerID: '',
  scopes: [],
  canvasID: original.id,
  messages: [],
  draft: '',
  draftRevision: 0,
  revision: 0,
  updated: 1,
  status: 'idle',
  level: 'names',
});
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'tools',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'tools',
      name: 'Project tools',
      panes: [{ id: 'library', type: 'tools', path: root }],
      roots: ['library'],
      activePane: 'library',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
type Application = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Application['connect']>>;
let app: Application | undefined;
let main: Connection;
const checks: string[] = [];
const settled = async (selector: string) => {
  await until(
    () =>
      main.evaluate(
        pageCall((selector) => {
          const element = document.querySelector(selector);
          if (!element) return false;
          const box = element.getBoundingClientRect();
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return (
            opacity > 0.99 &&
            box.left >= 0 &&
            box.right <= innerWidth + 1 &&
            box.top >= 50 &&
            box.bottom <= innerHeight + 1 &&
            element.contains(centre)
          );
        }, selector),
      ),
    Boolean,
    'focused plane is visible',
  );
};
const pointer = async (scope: string, label: string, prefix = false) => {
  const point = await until(
    () =>
      main.evaluate(
        pageCall(
          (scope, label, prefix) => {
            for (const button of document.querySelectorAll<HTMLButtonElement>(scope)) {
              if (
                button.disabled ||
                (prefix
                  ? button.firstChild?.textContent !== label
                  : button.textContent?.trim() !== label)
              )
                continue;
              const r = button.getBoundingClientRect(),
                x = r.x + r.width / 2,
                y = r.y + r.height / 2;
              if (r.width && button.contains(document.elementFromPoint(x, y))) return { x, y };
            }
            return null;
          },
          scope,
          label,
          prefix,
        ),
      ),
    Boolean,
    'visible ' + label,
  );
  assert.ok(point);
  await main.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await main.command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await main.command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    clickCount: 1,
  });
};
const select = (title: string) => pointer('.tool-library tbody button', title, true);
const click = (label: string) => pointer('.tool-library button', label);
const openLibrary = async (id: string) => {
  const selector = '[data-canvas-id="' + id + '"]';
  await settled(selector);
  await pointer(selector + ' .canvas-toolbar button', 'Tool library');
  await settled('.tool-library');
};
const screenshot = async (name: string) => {
  const shot = await main.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, name + '.png'), Buffer.from(shot.data, 'base64'));
};
const toggle = async () => {
  await main.evaluate(
    pageCall(() =>
      document.querySelector<HTMLInputElement>('.tool-library-enabled input')!.click(),
    ),
  );
};
try {
  app = await ownedApp(process.env.VIEWER_TEST_BINARY, profile, {
    mode: 'foreground',
    mockKeychain: true,
    label: 'generated-tool-library',
  });
  main = await app.connect();
  await select(original.title);
  await main.evaluate(
    pageCall(() => {
      const input = document.querySelector<HTMLInputElement>('.tool-library-details form input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Workshop quantity',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await click('Rename');
  await until(
    () =>
      main.evaluate(
        pageCall(() => document.querySelector('.tool-library-details h2')?.textContent),
      ),
    (value) => value === 'Workshop quantity',
    'renamed tool',
  );
  await toggle();
  await until(
    async () => (await service.read(1, original.id)).enabled,
    (value) => value === false,
    'disable persists',
  );
  await settled('.tool-library');
  await screenshot('library-desktop');
  await click('Open tool');
  await until(
    () => main.evaluate(pageCall(() => document.querySelector('.canvas-body')?.textContent)),
    (value) => !!value?.includes('Tool disabled'),
    'disabled tool view',
  );
  assert.equal(
    await main.evaluate(pageCall(() => document.querySelectorAll('.canvas-body iframe').length)),
    0,
  );
  checks.push('library rename and disable persist; disabled tool has no execution frame');
  // Reopen the library through the actual canvas toolbar.
  await openLibrary(original.id);
  await select('Workshop quantity');
  await toggle();
  await until(
    async () => (await service.read(1, original.id)).enabled,
    (value) => value === true,
    'enable persists',
  );
  await click('Open tool');
  const frame = await canvasFrame(main, original.id);
  await until(
    () => frame.evaluate(pageCall(() => document.querySelector('output')?.textContent)),
    (value) => value === '3',
    'tool loaded',
  );
  await frame.evaluate(
    pageCall(() => document.querySelector<HTMLButtonElement>('#calculate')!.click()),
  );
  await until(
    () => frame.evaluate(pageCall(() => document.querySelector('output')?.textContent)),
    (value) => value === '6',
    'plugin action committed',
  );
  checks.push('generic action executes fixture code in the sandbox and saves its result');
  await openLibrary(original.id);
  await select('Workshop quantity');
  await click('Duplicate');
  const copy = await until(
    async () =>
      (await service.library(1)).entries.find((entry) => entry.title === 'Workshop quantity copy'),
    Boolean,
    'duplicated tool',
  );
  assert.ok(copy);
  const copyFrame = await canvasFrame(main, copy.id);
  await until(
    () => copyFrame.evaluate(pageCall(() => document.querySelector('output')?.textContent)),
    (value) => value === '6',
    'copied input',
  );
  await copyFrame.evaluate(
    pageCall(() => document.querySelector<HTMLButtonElement>('#calculate')!.click()),
  );
  await until(
    async () => (await service.read(1, copy.id)).state.quantity,
    (value) => value === 12,
    'copy action',
  );
  assert.equal((await service.read(1, original.id)).state.quantity, 6);
  assert.notEqual((await service.read(1, copy.id)).conversationID, conversationID);
  checks.push('duplicate has a separate conversation and independent saved input');
  await openLibrary(copy.id);
  await select('Workshop quantity');
  await toggle();
  await until(
    async () => (await service.read(1, original.id)).enabled,
    (value) => value === false,
    'disabled original',
  );
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await settled('.tool-library');
  await screenshot('library-narrow');
  assert.equal(
    await main.evaluate(
      pageCall(() => {
        const node = document.querySelector('.tool-library')!;
        return node.scrollWidth > node.clientWidth + 1;
      }),
    ),
    false,
  );
  checks.push('library fits a narrow viewport without horizontal overflow');
  await app.close(main);
  app = undefined;
  app = await ownedApp(process.env.VIEWER_TEST_BINARY, profile, {
    mode: 'foreground',
    mockKeychain: true,
    label: 'generated-tool-library-restart',
  });
  main = await app.connect();
  await select('Workshop quantity');
  assert.equal(
    await main.evaluate(
      pageCall(
        () => document.querySelector<HTMLInputElement>('.tool-library-enabled input')!.checked,
      ),
    ),
    false,
  );
  await select('Workshop quantity copy');
  await click('Open tool');
  const reopened = await canvasFrame(main, copy.id);
  await until(
    () => reopened.evaluate(pageCall(() => document.querySelector('output')?.textContent)),
    (value) => value === '12',
    'restart retained value',
  );
  checks.push('restart retains library, disabled status, duplication and saved inputs');
  await settled('[data-canvas-id="' + copy.id + '"]');
  await screenshot('reopened-tool');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ status: 'passed', providerRequests: 0, checks }, null, 2),
  );
  console.log(JSON.stringify({ root, status: 'passed', providerRequests: 0, checks }));
} catch (error) {
  console.error('Native tool library failed:', error);
  if (main!) await screenshot('failure').catch(() => {});
  throw error;
} finally {
  await app?.close(main!);
}
