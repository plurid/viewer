/** Owned native canvas rehearsal. Fixtures only; no model calls, consent clicks, or removals. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvases } from '../../src/desktop/canvases/service';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { pageCall } from './runtime/page-function';
import { canvasFrame as frame } from './runtime/canvas';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary = path.resolve(
  process.env.VIEWER_TEST_BINARY ??
    path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer'),
);
const root = await realpath(await temporaryRoot('viewer-native-canvases-'));
const profile = path.join(root, 'Profile');
await mkdir(profile, { mode: 0o700 });
const conversation = randomUUID();
const message = randomUUID();
const canvases = new Canvases(profile, { changed: () => {} });
const initial = await canvases.create(1, conversation, root);
function triangle() {
  const source = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        type: 'VEC3',
        count: 3,
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
    materials: [{ doubleSided: true }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  });
  const json = Buffer.from(source.padEnd(Math.ceil(source.length / 4) * 4));
  const bytes = Buffer.alloc(28 + json.length + 36);
  bytes.writeUInt32LE(0x46546c67);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + json.length);
  bytes.writeUInt32LE(0x004e4942, 24 + json.length);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, i) =>
    bytes.writeFloatLE(value, 28 + json.length + i * 4),
  );
  return bytes;
}
const modelAsset = await canvases.attach(1, initial.id, 'triangle.glb', triangle());
const html = `<style>body{margin:0;padding:28px;font:16px system-ui;color:#edf1f6;background:#252a32}h1{font-size:26px}input{font:inherit;padding:8px;border:1px solid #607080;border-radius:6px;color:inherit;background:#323a44}output{display:block;font-size:48px;margin:24px 0}p{color:#bdc9d6}</style><h1>Trip budget</h1><p>Adjust the budget. Your values stay when the agent changes the design.</p><label>Budget <input id="budget" type="number"></label><output id="total"></output><script>
const api=window.viewerCanvas,input=document.querySelector('input'),output=document.querySelector('output');
input.value=api.getState().budget;output.textContent='€'+input.value;
input.oninput=()=>{api.setState({budget:Number(input.value)});output.textContent='€'+input.value};
document.documentElement.dataset.authority=[typeof window.viewer,typeof require,typeof process,self.origin].join('|');
try{parent.document.title;document.documentElement.dataset.parent='read'}catch{document.documentElement.dataset.parent='blocked'}
fetch('http://127.0.0.1:1/private').then(()=>document.documentElement.dataset.network='allowed').catch(()=>document.documentElement.dataset.network='blocked');
</script>`;
const canvas = await canvases.write(1, initial.id, 1, 'Trip budget', html, { budget: 25 });
await new ChatDocumentStore(path.join(profile, 'chat-documents', conversation + '.json')).save({
  version: 4,
  id: conversation,
  title: 'Trip budget',
  path: root,
  providerID: '',
  scopes: [],
  canvasID: canvas.id,
  messages: [
    {
      id: message,
      role: 'assistant',
      text: 'Compare the two budgets. Keep the inputs when changing the design.',
      at: 1,
    },
  ],
  draft: '',
  draftRevision: 0,
  revision: 1,
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
  activeWorkspace: 'canvas-rehearsal',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'canvas-rehearsal',
      name: 'Canvas rehearsal',
      panes: [
        { id: 'canvas', type: 'canvas', canvasID: canvas.id, path: root, title: canvas.title },
        { id: 'chat', type: 'chat', conversationID: conversation, path: root },
      ],
      roots: ['canvas', 'chat'],
      activePane: 'canvas',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));

type Application = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Application['connect']>>;
const checks: string[] = [];
const click = async (main: Connection, id: string, label: string) => {
  if (['Reload', 'Undo'].includes(label)) {
    await main.evaluate(
      pageCall(
        (id) =>
          document
            .querySelector<HTMLButtonElement>(
              `[data-canvas-id="${id}"] [aria-label="Canvas tools"]`,
            )!
            .click(),
        id,
      ),
    );
    await until(
      () =>
        main.evaluate(
          pageCall((label) => {
            const option = [
              ...document.querySelectorAll<HTMLElement>('[role="menuitem"], .context-menu button'),
            ].find(
              (item) => item.textContent?.trim() === (label === 'Undo' ? 'Undo revision' : label),
            );
            option?.click();
            return !!option;
          }, label),
        ),
      Boolean,
      'canvas tools choice',
    );
    return;
  }
  await main.evaluate(
    pageCall(
      (id, label) => {
        const section = document.querySelector(`[data-canvas-id="${id}"]`)!;
        const button = [...section.querySelectorAll('button')].find(
          (button) => button.textContent === label,
        );
        if (!button) throw new Error('Missing button: ' + label);
        button.click();
      },
      id,
      label,
    ),
  );
};
let application: Application | undefined;
let main: Connection | undefined;
try {
  application = await ownedApp(binary, profile, {
    label: 'canvas-rehearsal',
    mockKeychain: true,
    mode: process.env.VIEWER_NATIVE_FOREGROUND === '1' ? 'foreground' : 'hidden',
  });
  main = await application.connect();
  let content = await frame(main, canvas.id);
  await until(
    () => content.evaluate(pageCall(() => document.querySelector('output')?.textContent)),
    (value) => value === '€25',
    'canvas SDK startup',
  );
  assert.equal(
    await content.evaluate(pageCall(() => document.documentElement.dataset.authority)),
    'undefined|undefined|undefined|null',
  );
  assert.equal(
    await content.evaluate(pageCall(() => document.documentElement.dataset.parent)),
    'blocked',
  );
  await until(
    () => content.evaluate(pageCall(() => document.documentElement.dataset.network)),
    (value) => value === 'blocked',
    'blocked network',
  );
  checks.push('separate renderer; no desktop bridge, Node, parent access, or network');
  await content.evaluate(
    pageCall(() => {
      const input = document.querySelector('input')!;
      input.value = '42';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await until(
    async () => (await canvases.read(1, canvas.id)).state.budget,
    (value) => value === 42,
    'native control state persisted',
  );
  const selected = await content.evaluate(
    pageCall(() => {
      const text = document.querySelector('p')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 17);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    }),
  );
  assert.equal(selected, 'Adjust the budget');
  checks.push('selectable text and persisted input');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await main.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'canvas.png'), Buffer.from(image.data, 'base64'));
  await click(main, canvas.id, 'Reload');
  content = await frame(main, canvas.id, content.url);
  await until(
    () => content.evaluate(pageCall(() => document.querySelector('input')?.value)),
    (value) => value === '42',
    'reload retains saved input',
  );
  checks.push('reload retains saved input');
  // Schedule the loop in the owned frame only; the host must still stop that frame.
  await content.evaluate(
    pageCall(() => {
      setTimeout(() => {
        for (;;) {
          /* Owned runaway fixture. */
        }
      }, 100);
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await main.evaluate(pageCall(() => document.readyState)), 'complete');
  await click(main, canvas.id, 'Stop');
  await until(
    () =>
      main!.evaluate(
        pageCall((id) => !!document.querySelector(`[data-canvas-id="${id}"] iframe`), canvas.id),
      ),
    (value) => !value,
    'stop removes runaway frame',
  );
  checks.push('host stays responsive and Stop removes a runaway canvas');
  const stoppedLayout = await main.evaluate(
    pageCall((id) => {
      const body = document
        .querySelector(`[data-canvas-id="${id}"] .canvas-body`)!
        .getBoundingClientRect();
      const empty = document
        .querySelector(`[data-canvas-id="${id}"] .empty-state`)!
        .getBoundingClientRect();
      return {
        x: empty.x + empty.width / 2 - body.x - body.width / 2,
        y: empty.y + empty.height / 2 - body.y - body.height / 2,
      };
    }, canvas.id),
  );
  assert.ok(
    Math.abs(stoppedLayout.x) < 2 && Math.abs(stoppedLayout.y) < 2,
    'Stopped canvas is centered across the available canvas body.',
  );
  checks.push('stopped canvas is centered');
  await application.close(main);
  application = undefined;
  main = undefined;
  application = await ownedApp(binary, profile, {
    label: 'canvas-restart',
    mockKeychain: true,
    mode: process.env.VIEWER_NATIVE_FOREGROUND === '1' ? 'foreground' : 'hidden',
  });
  main = await application.connect();
  content = await frame(main, canvas.id);
  await until(
    () => content.evaluate(pageCall(() => document.querySelector('input')?.value)),
    (value) => value === '42',
    'restart retains saved input',
  );
  checks.push('full application restart retains saved input');
  await click(main, canvas.id, 'Conversation');
  await until(
    () =>
      main!.evaluate(
        pageCall((id) => !!document.querySelector(`[data-chat-text="${id}"]`), message),
      ),
    Boolean,
    'source transcript mounted',
  );
  await main.evaluate(
    pageCall((id) => {
      const text = document.querySelector(`[data-chat-text="${id}"]`)!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 7);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      text.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, message),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(() =>
          [...document.querySelectorAll('button')].some(
            (button) => button.textContent === 'Ask about selection',
          ),
        ),
      ),
    Boolean,
    'quote action',
  );
  await main.evaluate(
    pageCall(() =>
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent === 'Ask about selection')!
        .click(),
    ),
  );
  const branchID = await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) =>
            [...document.querySelectorAll<HTMLElement>('[data-conversation-id]')].find(
              (node) => node.dataset.conversationId !== id,
            )?.dataset.conversationId,
          conversation,
        ),
      ),
    Boolean,
    'branch conversation',
  );
  assert.ok(branchID);
  const branch = await main.evaluate(
    pageCall(async (id) => {
      const reply = await window.viewer.chat({ kind: 'open', id });
      if (Array.isArray(reply)) throw new Error('Expected conversation');
      return reply;
    }, branchID),
  );
  assert.equal(branch.branch?.quote, 'Compare');
  assert.equal(branch.branch?.context.length, 1);
  assert.notEqual(branch.canvasID, canvas.id);
  await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) => !!document.querySelector(`[data-conversation-id="${id}"] .chat-branch button`),
          branchID,
        ),
      ),
    Boolean,
    'source conversation link',
  );
  await main.evaluate(
    pageCall(
      (id) =>
        document
          .querySelector<HTMLButtonElement>(`[data-conversation-id="${id}"] .chat-branch button`)!
          .click(),
      branchID,
    ),
  );
  await until(
    () => main!.evaluate(pageCall(() => getSelection()?.toString())),
    (text) => text === 'Compare',
    'exact source passage',
  );
  checks.push(
    'quote branch freezes context, forks canvas and navigates to the exact source passage',
  );
  assert.ok(branch.canvasID);
  await main.evaluate(
    pageCall((id) => {
      const chat = document.querySelector(`[data-conversation-id="${id}"]`)!;
      [...chat.querySelectorAll('button')]
        .find((button) => button.textContent === 'Canvas')!
        .click();
    }, branchID),
  );
  let alternative = await frame(main, branch.canvasID);
  await alternative.evaluate(
    pageCall(() => {
      const input = document.querySelector('input')!;
      input.value = '300';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await until(
    async () => (await canvases.read(1, branch.canvasID!)).state.budget,
    (value) => value === 300,
    'alternative has independent inputs',
  );
  assert.equal((await canvases.read(1, canvas.id)).state.budget, 42);
  await main.evaluate(
    pageCall(
      async (id, assetID) => {
        const latest = await window.viewer.canvas({ kind: 'read', id });
        await window.viewer.canvas({
          kind: 'model',
          id,
          assetID,
          revision: latest.document.revision,
        });
      },
      branch.canvasID,
      modelAsset.id,
    ),
  );
  alternative = await frame(main, branch.canvasID, alternative.url);
  await until(
    () => alternative.evaluate(pageCall(() => document.querySelector('#status')?.textContent)),
    (text) => text === 'Drag to orbit · scroll to zoom',
    'alternative revision renders',
  );
  await click(main, branch.canvasID, 'Compare original');
  content = await frame(main, canvas.id);
  await content.evaluate(
    pageCall(() => {
      const input = document.querySelector('input')!;
      input.value = '84';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await click(main, branch.canvasID, 'Apply to original');
  content = await frame(main, canvas.id, content.url);
  await until(
    () => content.evaluate(pageCall(() => document.querySelector('#status')?.textContent)),
    (text) => text === 'Drag to orbit · scroll to zoom',
    'bundled Three loads GLB',
  );
  assert.equal((await canvases.read(1, canvas.id)).state.budget, 84);
  assert.equal((await canvases.read(1, branch.canvasID)).state.budget, 300);
  checks.push('compare and apply retain the original latest inputs and independent alternative');
  const applied = (await canvases.read(1, canvas.id)).revision;
  await click(main, branch.canvasID, 'Apply to original');
  await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) => document.querySelector(`[data-canvas-id="${id}"] [role="alert"]`)?.textContent,
          branch.canvasID!,
        ),
      ),
    (text) => text?.includes('original canvas has changed'),
    'conflicting apply refused visibly',
  );
  assert.equal((await canvases.read(1, canvas.id)).revision, applied);
  checks.push('applying an out-of-date alternative leaves the original unchanged');
  assert.ok(await content.evaluate(pageCall(() => document.querySelector('canvas')?.width)));
  await content.evaluate(
    pageCall(() => {
      const wire = document.querySelector<HTMLInputElement>('#wire')!;
      wire.checked = true;
      wire.dispatchEvent(new Event('change'));
    }),
  );
  await until(
    async () => (await canvases.read(1, canvas.id)).state.modelWire,
    (value) => value === true,
    '3D controls persist',
  );
  await click(main, canvas.id, 'Reload');
  content = await frame(main, canvas.id, content.url);
  await until(
    () =>
      content.evaluate(pageCall(() => document.querySelector<HTMLInputElement>('#wire')?.checked)),
    (value) => value === true,
    '3D reload retains controls',
  );
  checks.push('real GLB renders with bundled Three and retains 3D controls after reload');
  await click(main, canvas.id, 'Undo');
  content = await frame(main, canvas.id, content.url);
  await until(
    () => content.evaluate(pageCall(() => document.querySelector('input')?.value)),
    (value) => value === '84',
    'Undo restores previous app and inputs',
  );
  await application.close(main);
  application = undefined;
  main = undefined;
  const exported = await canvases.export(1, canvas.id, root);
  const reopened = new Canvases(path.join(root, 'Reopened profile'), { changed: () => {} });
  const imported = await reopened.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  assert.equal(imported.state.budget, 84);
  assert.equal(imported.html, html);
  checks.push('exported manifest reopens saved state without a model');
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ binary, profile, checks, retained: true }, null, 2),
  );
  console.log(JSON.stringify({ root, checks }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        binary,
        profile,
        checks,
        error: error instanceof Error ? error.stack : String(error),
        retained: true,
      },
      null,
      2,
    ),
  );
  console.error('Retained native evidence:', root);
  throw error;
} finally {
  if (application) await application.close(main);
}
