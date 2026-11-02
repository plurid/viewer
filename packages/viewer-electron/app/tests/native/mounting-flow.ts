/** Deterministic host workflow qualification. Fixture HTML is not attributed to a model. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvases } from '../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { Pane, SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { partDXF } from '../../src/domain/layout/nesting/dxf-writer';
import { prepareCanvasDrawing } from '../../src/domain/canvases/drawing';
import { temporaryRoot } from '../../tools/temporary';
import { startSupplier } from '../../tools/mounting/supplier';
import { screenshot } from '../../tools/docs/record';
import { ownedApp, until } from '../owned-app';
import { canvasFrame } from './runtime/canvas';
import type { CanvasConnection } from './runtime/canvas';
import { pageCall } from './runtime/page-function';
import { click, pressButton, textOf } from './runtime/page';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary, 'Set VIEWER_TEST_BINARY to the candidate.');
const root = await realpath(await temporaryRoot('viewer-native-mounting-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const stateFor = async (pane: Pane) => {
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    activeWorkspace: 'mounting',
    favorites: [],
    recents: [],
    look: 'dark',
    workspaces: [
      {
        id: 'mounting',
        name: 'Mounting flow · local fixture',
        panes: [pane],
        roots: [pane.id],
        activePane: pane.id,
        arrangement: {},
      },
    ],
  };
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
};
const seedCanvas = async (html: string, title: string, sourceFile?: string) => {
  const service = new Canvases(profile, { changed: () => {} });
  const conversation = randomUUID();
  const initial = await service.create(1, conversation, root);
  let revision = 0;
  if (sourceFile) {
    const text = await readFile(sourceFile, 'utf8');
    const attached = await service.source(1, initial.id, revision, {
      path: sourceFile,
      version: { identity: 'fixture-reply', modified: 1, size: Buffer.byteLength(text) },
      availability: 'available',
      facts: {},
      coverage: { content: 'complete' },
      evidence: [
        { source: 'text', text, anchor: { kind: 'text', line: 1, start: 0, end: text.length } },
      ],
    });
    revision = attached.revision;
  }
  const canvas = await service.write(1, initial.id, revision, title, html, {
    deadlineDays: 3,
    selectedOption: '',
  });
  await new ChatDocumentStore(path.join(profile, 'chat-documents', conversation + '.json')).save({
    version: 4,
    id: conversation,
    title,
    path: root,
    providerID: '',
    scopes: [],
    canvasID: canvas.id,
    messages: [
      {
        id: randomUUID(),
        role: 'assistant',
        text: 'Supplied host-workflow fixture. No model request was made.',
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
  await service.flush();
  await stateFor({ id: 'canvas', type: 'canvas', canvasID: canvas.id, path: root, title });
  return canvas;
};
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
let supplier: Awaited<ReturnType<typeof startSupplier>> | undefined;
const checks: string[] = [];
const capture = async (name: string) => {
  await until(
    () =>
      main!.evaluate(
        pageCall(() => {
          let element: Element | null = document.querySelector(
            '.canvas-plane, .browser-plane, .dxf-viewer',
          );
          if (!element) return false;
          while (element) {
            if (Number(getComputedStyle(element).opacity) < 0.99) return false;
            element = element.parentElement;
          }
          return true;
        }),
      ),
    Boolean,
    'plane fade settled before capture',
  );
  await screenshot(main!, path.join(root, name));
};
const start = async () => {
  app = await ownedApp(binary, profile, {
    label: 'mounting-flow',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  const point = await until(
    () =>
      main!.evaluate(
        pageCall(() => {
          const box = document.querySelector('.plane-controls')?.getBoundingClientRect();
          return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : undefined;
        }),
      ),
    Boolean,
    'plane header',
  );
  for (const type of ['mousePressed', 'mouseReleased'])
    await main.command('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      clickCount: 1,
    });
};
const stop = async () => {
  if (app) {
    await app.close(main);
    app = undefined;
    main = undefined;
  }
};
const saveReview = async () => {
  await main!.evaluate(click('.canvas-result button.primary'));
  await until(
    () =>
      main!.evaluate(
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
  await main!.evaluate(pressButton('Save', '.viewer-file-picker footer'));
};
try {
  const plate = partDXF({
    units: 4,
    layers: ['CUT'],
    primitives: [
      {
        kind: 'polyline',
        layer: 'CUT',
        closed: true,
        vertices: [
          [0, 0],
          [160, 0],
          [160, 140],
          [0, 140],
        ].map(([x, y]) => ({ x: x!, y: y!, bulge: 0 })),
      },
      ...[
        [15, 15],
        [145, 15],
        [145, 125],
        [15, 125],
      ].map(([x, y]) => ({
        kind: 'arc' as const,
        layer: 'CUT',
        center: { x: x!, y: y! },
        radius: 3.25,
        start: 0,
        sweep: Math.PI * 2,
      })),
    ],
  });
  const canvas = await seedCanvas(
    `<style>body{background:#31353d;color:#f2f4f6;font:14px system-ui;padding:24px}button{font:inherit;color:inherit;background:#292d34;border:1px solid #454b55;padding:8px 12px}</style><h1>Adapter plate prototype</h1><p>160 × 140 mm · four 6.5 mm bench holes</p><p>Fixture dimensions for workflow testing. Mounting fit is not established.</p><button id="review">Review cutting drawing</button><script>document.querySelector('#review').onclick=()=>viewerCanvas.requestExport(${JSON.stringify({ format: 'dxf', name: 'mounting-plate', content: plate })})</script>`,
    'Adapter plate prototype',
  );
  await start();
  let frame = await canvasFrame(main!, canvas.id);
  await frame.evaluate(click('#review'));
  await until(
    () => main!.evaluate(textOf('.canvas-drawing-result')),
    (t) => t.includes('160 mm') && t.includes('140 mm'),
    'measured drawing review',
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  await capture('drawing-review.png');
  await saveReview();
  const drawing = path.join(root, 'mounting-plate.dxf');
  const saved = await until(
    () => readFile(drawing, 'utf8').catch(() => ''),
    Boolean,
    'saved plate',
  );
  assert.equal(prepareCanvasDrawing(saved).measurement.holes.length, 4);
  checks.push(
    'Canvas DXF review shows measured 160 × 140 mm and four Ø6.5 holes; native Save creates the drawing.',
  );
  await main!.evaluate(pressButton('Open saved file'));
  await until(
    () => main!.evaluate(pageCall(() => !!document.querySelector('.dxf-viewer'))),
    Boolean,
    'saved DXF preview',
  );
  await capture('reopened-drawing.png');
  checks.push('Open saved file reopens the new DXF in the native drawing preview.');
  await stop();

  const replyFile = path.join(root, 'supplier-reply.json');
  supplier = await startSupplier({
    drawing,
    output: replyFile,
    material: 'Aluminium',
    thicknessMm: 6,
    quantity: 1,
  });
  await stateFor({
    id: 'supplier',
    type: 'browser',
    path: root,
    url: supplier.url,
    title: 'Demo cutting service',
  });
  await start();
  const target = await until(
    async () =>
      (
        (await fetch(`http://127.0.0.1:${app!.port}/json/list`).then((r) => r.json())) as {
          id: string;
          url: string;
        }[]
      ).find((t) => t.url === supplier!.url),
    Boolean,
    'supplier browser target',
  );
  const { sessionId } = await main!.command<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target!.id,
    flatten: true,
  });
  await until(
    () => main!.evaluate(textOf('#send'), { sessionId }),
    (t) => t === 'Request quote',
    'supplier page ready',
  );
  await capture('supplier-request.png');
  await main!.evaluate(click('#send'), { sessionId });
  await until(
    () => main!.evaluate(textOf('#status'), { sessionId }),
    (t) => t.startsWith('Saved supplier-reply.json'),
    'supplier reply saved',
  );
  await capture('supplier-reply.png');
  const reply = JSON.parse(await readFile(replyFile, 'utf8'));
  assert.deepEqual(reply, supplier.quote);
  checks.push(
    'Actual browser plane requests the local simulated quote; saved reply identifies the exact DXF hash.',
  );
  await stop();

  const html = await readFile(
    fileURLToPath(new URL('../fixtures/mounting/comparison.html', import.meta.url)),
    'utf8',
  );
  const comparison = await seedCanvas(html, 'Compare delivery options', replyFile);
  await start();
  frame = await canvasFrame(main!, comparison.id);
  await until(
    () => frame.evaluate(textOf('tbody')),
    (t) => t.includes('4 days late') && t.includes('Express'),
    'three day comparison',
  );
  assert.equal(
    await frame.evaluate(
      pageCall(() => document.querySelector<HTMLInputElement>('[value="economy"]')!.disabled),
    ),
    true,
  );
  await capture('deadline-three.png');
  await writeFile(
    path.join(root, 'display-state.json'),
    JSON.stringify(
      await main!.evaluate(
        pageCall(() => {
          let element: Element | null = document.querySelector('.canvas-plane');
          const values = [];
          while (element) {
            const style = getComputedStyle(element);
            values.push({
              class: element.className,
              opacity: style.opacity,
              filter: style.filter,
              transform: style.transform,
            });
            element = element.parentElement;
          }
          return values;
        }),
      ),
      null,
      2,
    ),
  );
  await frame.evaluate(
    pageCall(() => {
      const field = document.querySelector<HTMLInputElement>('#deadline')!;
      field.value = '7';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector<HTMLInputElement>('[value="economy"]')!.click();
      document.querySelector<HTMLButtonElement>('#save')!.click();
    }),
  );
  await until(
    () => main!.evaluate(textOf('.canvas-result pre')),
    (t) => t.includes('Total: EUR 40') && t.includes('Deadline: 7 days'),
    'selected quote review',
  );
  await capture('deadline-seven-review.png');
  await saveReview();
  const selectionFile = path.join(root, 'mounting-plate-quote.md');
  const selection = await until(
    () => readFile(selectionFile, 'utf8').catch(() => ''),
    Boolean,
    'saved selection',
  );
  assert.ok(selection.includes(reply.attachment.sha256));
  assert.ok(selection.includes('Option: Economy'));
  checks.push(
    '3-day deadline excludes Economy; 7 days permits it; reviewed Markdown saves EUR 40, delivery, deadline and drawing hash.',
  );
  await stop();
  await start();
  frame = await canvasFrame(main!, comparison.id);
  assert.equal(
    await frame.evaluate(
      pageCall(() => document.querySelector<HTMLInputElement>('#deadline')!.value),
    ),
    '7',
  );
  assert.equal(
    await frame.evaluate(
      pageCall(() => document.querySelector<HTMLInputElement>('[value="economy"]')!.checked),
    ),
    true,
  );
  assert.equal(await readFile(selectionFile, 'utf8'), selection);
  assert.equal(prepareCanvasDrawing(await readFile(drawing, 'utf8')).measurement.width, 160);
  await main!.command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('comparison-narrow-reopened.png');
  assert.equal(
    await frame.evaluate(pageCall(() => document.documentElement.scrollWidth > innerWidth)),
    false,
  );
  checks.push(
    'Cold restart retains seven-day deadline, Economy selection, both saved files and exact drawing dimensions; narrow frame has no horizontal overflow.',
  );
  await writeFile(
    path.join(root, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        fixture: true,
        modelRequests: 0,
        checks,
        files: { drawing, reply: replyFile, selection: selectionFile },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ root, checks }, null, 2));
} finally {
  if (main) await screenshot(main, path.join(root, 'last-screen.png')).catch(() => {});
  await stop();
  await supplier?.close();
}
