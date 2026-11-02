/** Record retained Meta tools with native inputs. Each take and its evidence are preserved. */
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { Canvases } from '../../src/desktop/canvases/service';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { chatDocumentSchema } from '../../src/domain/models/chat';
import { prepareCanvasDrawing } from '../../src/domain/canvases/drawing';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { Pane, SavedState } from '../../src/domain/contracts';
import { ownedApp, until } from '../../tests/owned-app';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import { pageCall } from '../../tests/native/runtime/page-function';
import { textOf } from '../../tests/native/runtime/page';
import { temporaryRoot } from '../temporary';
import { record, screenshot } from '../docs/record';
import type { Connection } from '../docs/record';
import { inputOverlay } from '../docs/input-overlay';
import { sessionReplay } from '../docs/session-replay';
import { startSupplier } from './supplier';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const { values } = parseArgs({
  options: { review: { type: 'string' }, run: { type: 'string' }, binary: { type: 'string' } },
});
assert.ok(values.review && values.run && values.binary, 'Pass --review, --run and --binary.');
const binary = path.resolve(values.binary);
const root = await temporaryRoot('viewer-mounting-film-', '/private/tmp');
const profile = path.join(root, 'Profile'),
  project = path.join(root, 'Project');
await mkdir(profile);
await mkdir(project);
for (const name of ['canvas-documents', 'canvas-assets', 'chat-documents', 'config.jsonc'])
  await cp(path.join(values.review, 'Profile', name), path.join(profile, name), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
await cp(path.join(values.run, 'SO-101'), path.join(project, 'SO-101'), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
await cp(path.join(values.run, 'Inputs'), path.join(project, 'Inputs'), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
const readJSON = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
const mountingID = '032ee378-314a-4d85-a9fa-b2803eed7086';
const comparisonID = '20888122-367e-446c-83d3-c8738876403d';
const documents = [];
for (const id of [mountingID, comparisonID]) {
  const file = path.join(profile, 'canvas-documents', id + '.json');
  const canvas = canvasDocumentSchema.parse(await readJSON(file));
  await writeFile(file, JSON.stringify({ ...canvas, path: project }));
  const chatFile = path.join(profile, 'chat-documents', canvas.conversationID + '.json');
  const chat = chatDocumentSchema.parse(await readJSON(chatFile));
  chat.path = project;
  chat.scopes =
    id === mountingID
      ? [
          { path: path.join(project, 'SO-101'), directory: true },
          { path: path.join(project, 'Inputs/mounting-brief.json'), directory: false },
        ]
      : [{ path: path.join(project, 'supplier-reply.json'), directory: false }];
  await writeFile(chatFile, JSON.stringify(chat));
  documents.push({ canvas, chat });
}
const [mounting, comparison] = documents;
assert.ok(mounting && comparison);
const provider = comparison.chat.messages.find((m) => m.provider)?.provider;
assert.ok(provider?.name === 'Meta');
const service = new Canvases(profile, { changed: () => {} });
for (const { canvas } of documents) {
  const current = await service.read(1, canvas.id);
  await service.state(
    1,
    current.id,
    current.stateRevision,
    current.revision,
    canvas.id === mountingID ? { widthMm: 160 } : { deadlineDays: 3, selectedOption: '' },
  );
}
await service.flush();
const clips: unknown[] = [],
  checks: unknown[] = [],
  replayEvidence: unknown[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let overlay: Awaited<ReturnType<typeof inputOverlay>>;
let main!: Connection;
let replay!: ReturnType<typeof sessionReplay>;
let marks: { seconds: number; action: string }[] = [],
  started = 0;
let supplier: Awaited<ReturnType<typeof startSupplier>> | undefined;
const ffmpeg = path.resolve(
  binary,
  '../../Resources',
  `viewer-processors-darwin-${process.arch}`,
  'ffmpeg',
);
const scope = (id: string) => `[data-canvas-id="${id}"]`;
const chatScope = (id: string) => `[data-conversation-id="${id}"]`;
const mark = (action: string) => {
  const item = { seconds: (performance.now() - started) / 1000, action };
  marks.push(item);
  console.log(JSON.stringify(item));
};
const save = () =>
  writeFile(
    path.join(root, 'capture.json'),
    JSON.stringify(
      {
        root,
        profile,
        project,
        binary,
        sourceRun: values.run,
        sourceReview: values.review,
        provider,
        providerRequests: 0,
        clips,
        checks,
        replayEvidence,
        presentation:
          'Retained request excerpts and Meta canvases; generation waits and repair rounds condensed. Local supplier simulation. Review copy includes recorded local layout and copy corrections.',
      },
      null,
      2,
    ),
  );
async function start(pane: Pane) {
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    activeWorkspace: 'project',
    openWindows: ['project'],
    favorites: [],
    recents: [],
    look: 'dark',
    workspaces: [
      {
        id: 'project',
        name: 'SO-101 mounting',
        panes: [pane],
        roots: [pane.id],
        activePane: pane.id,
        arrangement: {},
      },
    ],
  };
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
  app = await ownedApp(binary, profile, {
    label: 'mounting-film',
    mode: 'hidden',
    mockKeychain: true,
  });
  const raw = await app.connect();
  await raw.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => raw.evaluate(pageCall(() => !!document.querySelector('.plane-controls'))),
    Boolean,
    'plane',
  );
  overlay = await inputOverlay(raw);
  main = overlay.connection;
  replay = sessionReplay(main);
  await delay(1100);
}
async function close() {
  replayEvidence.push(replay.events);
  overlay.dispose();
  await app!.close(main);
  app = undefined;
}
async function move(x: number, y: number) {
  const from = overlay.position();
  for (let i = 1; i <= 10; i++) {
    const t = i / 10,
      eased = t * t * (3 - 2 * t);
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (x - from.x) * eased,
      y: from.y + (y - from.y) * eased,
    });
    await delay(20);
  }
}
async function clickPoint(
  x: number,
  y: number,
  cue = '',
  target?: { sessionId: string; x: number; y: number },
) {
  overlay.cue(cue);
  await move(x, y);
  for (const type of ['mousePressed', 'mouseReleased'])
    await main.command(
      'Input.dispatchMouseEvent',
      { type, x: target?.x ?? x, y: target?.y ?? y, button: 'left', clickCount: 1 },
      target?.sessionId,
    );
  await delay(180);
  overlay.cue('');
}
async function click(selector: string, label?: string, cue = '') {
  const point = await until(
    () =>
      main.evaluate(
        pageCall(
          (selector, label) => {
            const node = [...document.querySelectorAll<HTMLElement>(selector)].find(
              (e) =>
                e.checkVisibility() &&
                !e.matches(':disabled') &&
                (!label || e.textContent?.trim() === label),
            );
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight + 1
              ? { x: r.x + r.width / 2, y: r.y + r.height / 2 }
              : null;
          },
          selector,
          label,
        ),
      ),
    Boolean,
    'visible ' + (label ?? selector),
  );
  assert.ok(point);
  await clickPoint(point.x, point.y, cue);
}
async function key(key: string, code: string, virtual: number, modifiers = 0, cue = '') {
  overlay.cue(cue);
  for (const type of ['keyDown', 'keyUp'])
    await main.command('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: virtual,
      modifiers,
    });
  overlay.cue('');
}
async function canvasClick(id: string, selector: string, cue = '') {
  const frame = await canvasFrame(main, id);
  const local = await frame.evaluate(
    pageCall((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw Error('Missing canvas control ' + selector);
      const r = el.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        width: innerWidth,
        height: innerHeight,
      };
    }, selector),
  );
  const parent = await main.evaluate(
    pageCall((selector) => {
      const r = document.querySelector(selector + ' iframe')!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, scope(id)),
  );
  overlay.mapPointer(frame.sessionId, {
    x: parent.x,
    y: parent.y,
    scaleX: parent.width / local.width,
    scaleY: parent.height / local.height,
  });
  await clickPoint(
    parent.x + (local.x * parent.width) / local.width,
    parent.y + (local.y * parent.height) / local.height,
    cue,
    { sessionId: frame.sessionId, x: local.x, y: local.y },
  );
  return frame;
}
async function canvasInput(id: string, selector: string, value: string, cue: string) {
  const frame = await canvasClick(id, selector, cue);
  const focus = await frame.evaluate(
    pageCall(() => ({
      active: document.activeElement?.id,
      width: innerWidth,
      height: innerHeight,
    })),
  );
  console.log(JSON.stringify({ selector, focus }));
  assert.equal(
    focus.active,
    selector.slice(1),
    'The native pointer must focus the intended input.',
  );
  overlay.cue('Select value');
  await main.command(
    'Input.dispatchKeyEvent',
    {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 4,
      commands: ['selectAll'],
    },
    frame.sessionId,
  );
  await main.command(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
    frame.sessionId,
  );
  await main.command('Input.insertText', { text: value }, frame.sessionId);
  for (const type of ['keyDown', 'keyUp'])
    await main.command(
      'Input.dispatchKeyEvent',
      { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      frame.sessionId,
    );
  overlay.cue('');
}
async function take(name: string, action: () => Promise<void>) {
  marks = [];
  overlay.reset();
  started = performance.now();
  const result = await record(main, path.join(root, name), ffmpeg, action, {
    width: 1440,
    height: 900,
    fps: 30,
    bitrate: '8000k',
    gif: false,
  });
  clips.push({ name, ...result, marks, inputs: overlay.events.slice() });
  await save();
}
async function saveResult(drawing: boolean) {
  await click(
    '.canvas-result button',
    drawing ? 'Save drawing…' : 'Save result…',
    'Save the result',
  );
  await until(
    () =>
      main.evaluate(
        pageCall(
          () =>
            !!document.querySelector(
              '.viewer-file-picker[open] .file-picker-files[aria-busy="false"]',
            ),
        ),
      ),
    Boolean,
    'save picker',
  );
  await click('.viewer-file-picker footer button', 'Save', 'Save');
}
console.log(JSON.stringify({ root, profile, providerRequests: 0 }));
try {
  await start({
    id: 'conversation',
    type: 'chat',
    path: project,
    conversationID: mounting.chat.id,
  });
  const request = mounting.chat.messages.find((m) => m.role === 'user')!;
  await replay.mount(chatScope(mounting.chat.id), request, 'SO-101 and mounting brief', {
    end: request.text.indexOf('. This is') + 1,
    providerName: provider.name,
  });
  await take('01-request-and-drawing', async () => {
    mark('request');
    await delay(600);
    await replay.type(request, 4300);
    await key('Enter', 'Enter', 13, 4, 'Send request');
    await delay(900);
    await replay.coverCanvas();
    await click(
      chatScope(mounting.chat.id) + ' .chat-toolbar button',
      'Canvas',
      'Open the generated tool',
    );
    const frame = await canvasFrame(main, mountingID);
    await until(
      () => frame.evaluate(pageCall(() => document.querySelectorAll('#svg circle').length)),
      (n) => n === 4,
      'plate drawing',
    );
    await delay(900);
    mark('generated');
    await replay.revealCanvas(frame, 'create', { stage: '#left', panel: '#aside' });
    await delay(1300);
    mark('width');
    await canvasInput(mountingID, '#w', '180', 'Change plate width');
    await until(
      () => frame.evaluate(pageCall(() => document.querySelector('#status')?.textContent)),
      (s) => !!s?.includes('180x140'),
      'updated plate',
    );
    await delay(1500);
    mark('drawing');
    await canvasClick(mountingID, '#bReview', 'Review cutting drawing');
    await until(
      () => main.evaluate(textOf('.canvas-drawing-result')),
      (t) => t.includes('180 mm') && t.includes('140 mm'),
      'independently measured drawing',
    );
    await delay(1800);
    await saveResult(true);
    const file = path.join(project, 'mounting-plate.dxf');
    const bytes = await until(
      () => readFile(file).catch(() => Buffer.alloc(0)),
      (b) => b.length > 0,
      'saved drawing',
    );
    const measured = prepareCanvasDrawing(bytes.toString()).measurement;
    assert.equal(measured.width, 180);
    assert.equal(measured.height, 140);
    assert.equal(measured.holes.length, 4);
    checks.push({
      drawing: file,
      hash: createHash('sha256').update(bytes).digest('hex'),
      measured,
    });
    mark('saved-dxf');
    await click('.canvas-plane button', 'Open saved file', 'Open saved drawing');
    await until(
      () => main.evaluate(pageCall(() => !!document.querySelector('.dxf-viewer'))),
      Boolean,
      'saved drawing preview',
    );
    await delay(2100);
    await screenshot(main, path.join(root, 'saved-drawing.png'));
  });
  await close();
  supplier = await startSupplier({
    drawing: path.join(project, 'mounting-plate.dxf'),
    output: path.join(project, 'supplier-reply.json'),
    material: 'Aluminium',
    thicknessMm: 6,
    quantity: 1,
  });
  const retainedQuote = JSON.parse(comparison.canvas.sources[0]!.data.evidence[0]!.text);
  assert.deepEqual(
    supplier.quote,
    retainedQuote,
    'The new simulated reply matches the retained source exactly.',
  );
  await start({
    id: 'supplier',
    type: 'browser',
    path: project,
    url: supplier.url,
    title: 'Demo cutting service',
  });
  const target = await until(
    async () =>
      (
        (await fetch(`http://127.0.0.1:${app!.port}/json/list`).then((r) => r.json())) as {
          id: string;
          url: string;
        }[]
      ).find((t) => t.url === supplier!.url),
    Boolean,
    'supplier page',
  );
  const { sessionId } = await main.command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target!.id,
    flatten: true,
  });
  await until(
    () => main.evaluate(textOf('#send'), { sessionId }),
    (t) => t === 'Request quote',
    'supplier button',
  );
  await take('02-cutting-service', async () => {
    mark('supplier');
    await delay(2200);
    const local = await main.evaluate(
      pageCall(() => {
        const r = document.querySelector('#send')!.getBoundingClientRect();
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          width: innerWidth,
          height: innerHeight,
        };
      }),
      { sessionId },
    );
    const parent = await main.evaluate(
      pageCall(() => {
        const r = document.querySelector('.browser-surface')!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    await clickPoint(
      parent.x + (local.x * parent.width) / local.width,
      parent.y + (local.y * parent.height) / local.height,
      'Request the cutting quote',
    );
    await until(
      () => main.evaluate(textOf('#status'), { sessionId }),
      (t) => t.startsWith('Saved supplier-reply.json'),
      'quote received',
    );
    assert.deepEqual(await readJSON(path.join(project, 'supplier-reply.json')), retainedQuote);
    mark('offers');
    await delay(4200);
    await screenshot(main, path.join(root, 'supplier.png'));
  });
  await close();
  await start({
    id: 'conversation',
    type: 'chat',
    path: project,
    conversationID: comparison.chat.id,
  });
  const comparisonRequest = comparison.chat.messages.find((m) => m.role === 'user')!;
  const end = comparisonRequest.text.indexOf(' /private/');
  assert.ok(end > 0);
  await replay.mount(chatScope(comparison.chat.id), comparisonRequest, 'Supplier reply', {
    end,
    providerName: provider.name,
  });
  await take('03-reply-to-tool', async () => {
    mark('compare');
    await delay(500);
    await replay.type(comparisonRequest, 2400);
    await key('Enter', 'Enter', 13, 4, 'Send request');
    const answer = comparison.chat.messages.find((m) => m.role === 'assistant')!;
    await replay.answer({ message: answer, start: 0, end: answer.text.indexOf(' (revision') }, 900);
    await delay(600);
    await replay.coverCanvas();
    await click(
      chatScope(comparison.chat.id) + ' .chat-toolbar button',
      'Canvas',
      'Open the quote tool',
    );
    const frame = await canvasFrame(main, comparisonID);
    await until(
      () => frame.evaluate(pageCall(() => document.querySelectorAll('#rows tr').length)),
      (n) => n === 2,
      'two source offers',
    );
    await delay(900);
    await replay.revealCanvas(frame, 'create', { stage: '.main', panel: '.side' });
    assert.equal(
      await frame.evaluate(
        pageCall(
          () => document.querySelector<HTMLInputElement>('input[value="economy"]')?.disabled,
        ),
      ),
      true,
    );
    mark('deadline');
    await delay(1200);
    await canvasInput(comparisonID, '#dl', '7', 'Change delivery deadline');
    await until(
      () =>
        frame.evaluate(
          pageCall(
            () => document.querySelector<HTMLInputElement>('input[value="economy"]')?.disabled,
          ),
        ),
      (d) => d === false,
      'economy eligible',
    );
    await delay(1400);
    mark('choice');
    await canvasClick(comparisonID, 'input[value="economy"]', 'Choose Economy');
    await delay(1000);
    await canvasClick(comparisonID, '#rev', 'Review the selected quote');
    await until(
      () => main.evaluate(textOf('.canvas-result pre')),
      (t) => t.includes('Economy') && t.includes('40 EUR'),
      'selected offer',
    );
    await delay(1000);
    await saveResult(false);
    const quoteFile = path.join(project, 'mounting-plate-quote.md');
    const saved = await until(
      () => readFile(quoteFile, 'utf8').catch(() => ''),
      (s) => s.includes('40 EUR'),
      'saved quote',
    );
    assert.ok(saved.includes(retainedQuote.attachment.sha256));
    checks.push({
      quote: quoteFile,
      selected: 'economy',
      deadline: 7,
      drawingHash: retainedQuote.attachment.sha256,
    });
    mark('saved-quote');
    await click('.canvas-plane button', 'Open saved file', 'Open saved quote');
    await delay(2100);
    await screenshot(main, path.join(root, 'saved-quote.png'));
  });
  await close();
  await save();
  await writeFile(
    path.join(root, 'completed.json'),
    JSON.stringify({ status: 'passed', root, providerRequests: 0 }),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ status: 'passed', root }));
} finally {
  if (app) await app.close(main!);
  await supplier?.close();
  await save();
}
