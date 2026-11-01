/** Verify saved live-model canvases without contacting a provider. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Canvases } from '../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { chatDocumentSchema } from '../../src/domain/models/chat';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { canvasProject } from '../../tools/canvases/sample';
import { ownedApp, until } from '../owned-app';
import { canvasFrame } from './runtime/canvas';
import type { CanvasConnection } from './runtime/canvas';
import { pageCall } from './runtime/page-function';
import { record, screenshot } from '../../tools/docs/record';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
const source = process.argv[2];
assert.ok(source, 'Pass the retained live evaluation folder.');
const filming = process.argv.includes('--record');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = await realpath(await temporaryRoot('viewer-live-canvas-rehearsal-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const project = path.join(root, 'Workshop kits');
await canvasProject(project);
const generated = JSON.parse(await readFile(path.join(source, 'session-8.json'), 'utf8'));
const original = canvasDocumentSchema.parse(generated.canvas);
assert.ok(original.html && original.sources.length === 3);
const conversation = randomUUID();
const service = new Canvases(profile, { changed: () => {} });
// Import the actual saved model output. No source or generated HTML is rewritten.
const bundle = path.join(root, 'Generated canvas');
await mkdir(bundle);
await writeFile(path.join(bundle, 'canvas.viewer.json'), JSON.stringify(original), { flag: 'wx' });
const canvas = await service.import(1, path.join(bundle, 'canvas.viewer.json'), conversation);
const parentRun = JSON.parse(await readFile(path.join(source, 'session-7.json'), 'utf8'));
const parentConversation = randomUUID();
const parentBundle = path.join(root, 'Original canvas');
await mkdir(parentBundle);
await writeFile(path.join(parentBundle, 'canvas.viewer.json'), JSON.stringify(parentRun.canvas), {
  flag: 'wx',
});
const parentCanvas = await service.import(
  1,
  path.join(parentBundle, 'canvas.viewer.json'),
  parentConversation,
);
await new ChatDocumentStore(
  path.join(profile, 'chat-documents', parentConversation + '.json'),
).save({
  ...chatDocumentSchema.parse(parentRun.conversation),
  id: parentConversation,
  canvasID: parentCanvas.id,
  path: project,
  providerID: '',
  scopes: [],
});
const savedConversation = chatDocumentSchema.parse(generated.conversation);
assert.ok(savedConversation.branch);
await new ChatDocumentStore(path.join(profile, 'chat-documents', conversation + '.json')).save({
  ...savedConversation,
  id: conversation,
  canvasID: canvas.id,
  path: project,
  providerID: '',
  scopes: [],
  branch: { ...savedConversation.branch, conversationID: parentConversation },
  status: 'idle',
  error: undefined,
});
const settings = defaultSettings(project);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'workshop',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'workshop',
      name: 'Workshop kits',
      panes: [
        { id: 'canvas', type: 'canvas', canvasID: canvas.id, path: project, title: canvas.title },
      ],
      roots: ['canvas'],
      activePane: 'canvas',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
await service.flush();
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const execute = promisify(execFile);
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const checks: string[] = [];
const observations: unknown[] = [];
let start = 0;
const beat = async (seconds: number) => {
  if (filming) await delay(Math.max(0, seconds * 1000 - (Date.now() - start)));
};
try {
  app = await ownedApp(binary, profile, {
    label: 'live-canvas-rehearsal',
    mode: 'foreground',
    mockKeychain: true,
  });
  main = await app.connect();
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const frame = await canvasFrame(main, canvas.id);
  await until(
    () => frame.evaluate(pageCall(() => document.querySelector('#rows')?.textContent)),
    Boolean,
    'generated tool renders',
  );
  const focusCanvas = async () => {
    const point = await main!.evaluate(
      pageCall((id) => {
        const box = document
          .querySelector(`[data-canvas-id="${id}"] .canvas-revision`)!
          .getBoundingClientRect();
        return { x: box.left + 12, y: box.top + box.height / 2 };
      }, canvas.id),
    );
    await main!.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await main!.command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await main!.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await delay(300);
  };
  await focusCanvas();
  const set = async (id: string, value: number) =>
    frame.evaluate(
      pageCall(
        (id, value) => {
          const input = document.getElementById(id) as HTMLInputElement;
          if (!input) throw Error('Missing input ' + id);
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        },
        id,
        value,
      ),
    );
  const view = () =>
    frame.evaluate(
      pageCall(() => ({
        rows: document.querySelector('#rows')?.textContent,
        verdict: document.querySelector('#verdict')?.textContent,
        tradeoff: document.querySelector('#tradeoff')?.textContent,
        report: document.querySelector('#report')?.textContent,
        inputs: [...document.querySelectorAll('input')].map((x) => ({ id: x.id, value: x.value })),
      })),
    );
  const exportResult = async (button: string, filename: string, reviewUntil: number) => {
    await frame.evaluate(pageCall((id) => document.getElementById(id)!.click(), button));
    const content = await until(
      () =>
        main!.evaluate(pageCall(() => document.querySelector('.canvas-result pre')?.textContent)),
      (x) => !!x,
      'result review',
    );
    assert.ok(content);
    await screenshot(main!, path.join(root, filename + '.review.png'));
    await beat(reviewUntil);
    await main!.evaluate(
      pageCall(() =>
        document.querySelector<HTMLButtonElement>('.canvas-result button.primary')!.click(),
      ),
    );
    await execute(
      '/usr/bin/osascript',
      [
        '-e',
        `on run argv
  tell application "System Events"
    set targetProcess to first application process whose unix id is (item 1 of argv as integer)
    tell targetProcess
      repeat 60 times
        if exists sheet 1 of window 1 then exit repeat
        delay 0.1
      end repeat
      if not (exists sheet 1 of window 1) then error "Owned Save sheet not found"
      tell sheet 1 of window 1
        if not (exists button "Save") then error "Save control not found"
        click button "Save"
      end tell
    end tell
  end tell
end run`,
        String(app!.child.pid),
      ],
      { timeout: 20000 },
    );
    const saved = path.join(bundle, filename);
    await until(
      () => readFile(saved, 'utf8').catch(() => ''),
      (text) => text === content,
      'native picker saves exact reviewed result',
    );
    return { file: saved, content };
  };
  const actions = async () => {
    start = Date.now();
    await set('qty', 20);
    await set('budget', 2000);
    await set('maxDays', 10);
    const initial = await view();
    observations.push({ case: '20 kits / 10 days', ...initial });
    assert.match(initial.rows ?? '', /1[,. ]?020/);
    assert.match(initial.rows ?? '', /1[,. ]?000/);
    assert.match(initial.verdict ?? '', /East/);
    checks.push('live-generated tool: initial totals 1020 and 1000 EUR');
    await screenshot(main!, path.join(root, 'initial.png'));
    await beat(20);
    await set('qty', 40);
    await set('maxDays', 3);
    const urgent = await view();
    observations.push({ case: '40 kits / 3 days', ...urgent });
    assert.match(urgent.rows ?? '', /1[,. ]?860/);
    assert.match(urgent.rows ?? '', /1[,. ]?960/);
    assert.match(
      urgent.verdict ?? '',
      /Requested \(3d \+ EUR 2000\): meets BOTH: East \(EUR 1960\)\./,
    );
    assert.match(urgent.tradeoff ?? '', /\+4 days unlocks North and saves EUR 100/);
    checks.push(
      'live-generated alternative: 40 kits cost 1860/1960; extra four days saves 100 EUR',
    );
    await screenshot(main!, path.join(root, 'alternative.png'));
    await beat(43);
    await frame.evaluate(
      pageCall(() => document.getElementById('tradeoff')!.scrollIntoView({ block: 'center' })),
    );
    await beat(58);
    await main!.evaluate(
      pageCall((id) => {
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            `[data-canvas-id="${id}"] .canvas-toolbar button`,
          ),
        ]
          .find((button) => button.textContent === 'Conversation')!
          .click();
      }, canvas.id),
    );
    await until(
      () =>
        main!.evaluate(
          pageCall(
            (id) => !!document.querySelector(`[data-conversation-id="${id}"] .chat-branch`),
            conversation,
          ),
        ),
      Boolean,
      'saved quoted conversation opens',
    );
    await delay(1200);
    await main!.evaluate(
      pageCall((id) => {
        document
          .querySelector(`[data-conversation-id="${id}"] .chat-branch`)!
          .scrollIntoView({ block: 'start' });
      }, conversation),
    );
    await screenshot(main!, path.join(root, 'quoted-conversation.png'));
    await beat(78);
    await main!.evaluate(
      pageCall((id) => {
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            `[data-conversation-id="${id}"] .chat-toolbar button`,
          ),
        ]
          .find((button) => button.textContent === 'Canvas')!
          .click();
      }, conversation),
    );
    await delay(500);
    await focusCanvas();
    await frame.evaluate(pageCall(() => window.scrollTo(0, 0)));
    await main!.evaluate(
      pageCall(() =>
        [...document.querySelectorAll<HTMLElement>('summary')]
          .find((x) => x.textContent?.includes('Sources ('))!
          .click(),
      ),
    );
    await screenshot(main!, path.join(root, 'sources.png'));
    await beat(100);
    await main!.evaluate(
      pageCall(() =>
        [...document.querySelectorAll<HTMLElement>('summary')]
          .find((x) => x.textContent?.includes('Sources ('))!
          .click(),
      ),
    );
    const csv = await exportResult('csvBtn', 'supplier-comparison.csv', 118);
    assert.match(csv.content, /North,40,42,180,7,1860/);
    assert.match(csv.content, /East,40,48,40,2,1960/);
    checks.push('CSV saved through native picker matches the reviewed generated output');
    await beat(125);
    const markdown = await exportResult('mdBtn', 'decision-report.md', 148);
    assert.match(markdown.content, /100/);
    checks.push(
      'Markdown report saved through native picker matches the reviewed generated output',
    );
    await beat(152);
    await main!.evaluate(
      pageCall(() =>
        [...document.querySelectorAll<HTMLButtonElement>('.canvas-message button')]
          .find((x) => x.textContent === 'Open saved file')!
          .click(),
      ),
    );
    await until(
      () => main!.evaluate(pageCall(() => document.body.innerText)),
      (x) => x.includes('decision-report.md'),
      'saved report opened in Viewer',
    );
    await screenshot(main!, path.join(root, 'opened-report.png'));
    await beat(174);
  };
  if (filming) {
    const ffmpeg = path.join(appRoot, 'assets', 'viewer-processors-darwin-arm64', 'ffmpeg');
    const movie = await record(main, path.join(root, 'capture'), ffmpeg, actions);
    await writeFile(path.join(root, 'recording.json'), JSON.stringify(movie, null, 2), {
      flag: 'wx',
    });
  } else await actions();
  await app.close(main);
  app = undefined;
  main = undefined;
  app = await ownedApp(binary, profile, {
    label: 'live-canvas-restart',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  const restored = await canvasFrame(main, canvas.id);
  await until(
    () =>
      restored.evaluate(pageCall(() => document.querySelector<HTMLInputElement>('#qty')?.value)),
    (x) => x === '40',
    'live tool saved input on restart',
  );
  const saved = await main.evaluate(
    pageCall((id) => window.viewer.canvas({ kind: 'read', id }), canvas.id),
  );
  assert.equal(saved.document.state.maxDays, 3);
  checks.push('live-generated tool survives native restart with 40 kits and three-day deadline');
  await writeFile(
    path.join(root, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        root,
        checks,
        observations,
        source,
        model: generated.conversation.messages.find((m: { provider?: unknown }) => m.provider)
          ?.provider,
        scope: 'Saved live output; no provider calls during native verification',
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ root, checks }, null, 2));
} catch (error) {
  console.error(error);
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify({ error: String(error), checks, observations }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  if (app) await app.close(main);
  console.log('Retained live rehearsal: ' + root);
}
