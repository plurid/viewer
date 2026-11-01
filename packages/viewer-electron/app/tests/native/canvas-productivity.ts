/** Owned native checks with deterministic source data; no provider calls or removals. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvases } from '../../src/desktop/canvases/service';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { canvasFrame } from './runtime/canvas';
import type { CanvasConnection } from './runtime/canvas';
import { pageCall } from './runtime/page-function';
import { screenshot } from '../../tools/docs/record';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await realpath(await temporaryRoot('viewer-native-canvas-productivity-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const csv = path.join(root, 'Quote.csv');
await writeFile(csv, 'supplier,unit,shipping\nNorth,42,180\n', { flag: 'wx' });
const conversation = randomUUID();
const service = new Canvases(profile, { changed: () => {} });
const initial = await service.create(1, conversation, root);
const bound = await service.source(1, initial.id, 0, {
  path: csv,
  version: { identity: 'fixture', modified: 1, size: 40 },
  availability: 'available',
  facts: {},
  evidence: [
    {
      source: 'text',
      text: await readFile(csv, 'utf8'),
      anchor: { kind: 'text', line: 1, start: 0, end: 40 },
    },
  ],
  coverage: { content: 'complete' },
});
const html = `<style>body{margin:0;padding:28px;font:16px system-ui;color:#edf1f6;background:#252a32}input,button{font:inherit;padding:8px;margin:8px;border:1px solid #607080;border-radius:6px;color:inherit;background:#323a44}output{display:block;font-size:42px;margin:24px 0}</style><h1>Source-backed calculator</h1><label>Quantity<input id="quantity" type="number"></label><output id="total"></output><button id="csv">Export CSV</button><button id="bad">Invalid result</button><script>
const api=window.viewerCanvas,input=document.querySelector('input'),out=document.querySelector('output');
const row=api.getSources()[0].data.table.rows[1];
function total(){return Number(row[1])*Number(input.value)+Number(row[2]);}
function render(){out.textContent='EUR '+total();}
input.value=api.getState().quantity; input.oninput=()=>{api.setState({quantity:Number(input.value)});render()};render();
document.querySelector('#csv').onclick=()=>api.requestExport({format:'csv',name:'comparison',content:'supplier,quantity,total_eur\\n'+row[0]+','+input.value+','+total()+'\\n'});
document.querySelector('#bad').onclick=()=>api.requestExport({format:'json',name:'bad',content:'not JSON'});
</script>`;
const canvas = await service.write(
  1,
  initial.id,
  bound.revision,
  'Source-backed calculator',
  html,
  { quantity: 20 },
);
await new ChatDocumentStore(path.join(profile, 'chat-documents', conversation + '.json')).save({
  version: 4,
  id: conversation,
  title: canvas.title,
  path: root,
  providerID: '',
  scopes: [],
  canvasID: canvas.id,
  messages: [
    {
      id: randomUUID(),
      role: 'assistant',
      text: 'Native fixture, not a model-generated answer.',
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
  activeWorkspace: 'tool-check',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'tool-check',
      name: 'Tool check',
      panes: [
        { id: 'canvas', type: 'canvas', canvasID: canvas.id, path: root, title: canvas.title },
      ],
      roots: ['canvas'],
      activePane: 'canvas',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const checks: string[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const read = (main: CanvasConnection) =>
  main.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), canvas.id));
try {
  console.log('Starting native canvas fixture');
  app = await ownedApp(binary, profile, {
    label: 'canvas-productivity',
    mode: 'hidden',
    mockKeychain: true,
  });
  console.log('Native process started');
  main = await app.connect();
  console.log('Renderer connected');
  let frame = await canvasFrame(main, canvas.id);
  console.log('Canvas frame connected');
  const total = () => frame.evaluate(pageCall(() => document.querySelector('output')?.textContent));
  await until(total, (value) => value === 'EUR 1020', 'snapshot-backed total');
  await frame.evaluate(
    pageCall(() => {
      const input = document.querySelector('input')!;
      input.value = '40';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector<HTMLButtonElement>('#csv')!.click();
    }),
  );
  const review = () =>
    main!.evaluate(pageCall(() => document.querySelector('.canvas-result pre')?.textContent));
  await until(
    review,
    (value) => value === 'supplier,quantity,total_eur\nNorth,40,1860\n',
    'queued state and exported text agree',
  );
  assert.equal((await read(main)).document.state.quantity, 40);
  checks.push('source data drives totals; immediate export waits for input persistence');
  await screenshot(main, path.join(root, 'result-review.png'));
  await frame.evaluate(
    pageCall(() => {
      const input = document.querySelector('input')!;
      input.value = '41';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(
          () =>
            document.querySelector<HTMLButtonElement>('.canvas-result button.primary')?.disabled,
        ),
      ),
    Boolean,
    'stale review blocked',
  );
  await main.evaluate(
    pageCall(() =>
      [...document.querySelectorAll<HTMLButtonElement>('.canvas-result button')]
        .find((b) => b.textContent === 'Cancel')!
        .click(),
    ),
  );
  checks.push('input changes invalidate an open result review; cancel dismisses it');
  await frame.evaluate(pageCall(() => document.querySelector<HTMLButtonElement>('#bad')!.click()));
  await until(
    () => main!.evaluate(pageCall(() => document.querySelector('[role="alert"]')?.textContent)),
    (value) => !!value,
    'invalid JSON result rejected',
  );
  checks.push('malformed result rejected at the host boundary');
  await main.evaluate(
    pageCall(() =>
      [...document.querySelectorAll<HTMLElement>('summary')]
        .find((b) => b.textContent?.includes('Sources ('))!
        .click(),
    ),
  );
  await until(
    () => main!.evaluate(pageCall(() => document.querySelector('.canvas-sources')?.textContent)),
    Boolean,
    'source disclosure',
  );
  await screenshot(main, path.join(root, 'sources.png'));
  await writeFile(csv, 'supplier,unit,shipping\nNorth,43,180\n');
  await main.evaluate(
    pageCall(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === 'Refresh snapshot')!
        .click(),
    ),
  );
  frame = await canvasFrame(main, canvas.id, frame.url);
  await until(total, (value) => value === 'EUR 1943', 'refresh changes data, keeps 41 units');
  checks.push('explicit local refresh re-renders with saved inputs');
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot(main, path.join(root, 'narrow.png'));
  assert.equal(
    await main.evaluate(pageCall(() => document.documentElement.scrollWidth > innerWidth)),
    false,
  );
  await main.command('Emulation.clearDeviceMetricsOverride');
  await app.close(main);
  app = undefined;
  main = undefined;
  app = await ownedApp(binary, profile, {
    label: 'canvas-productivity-restart',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  frame = await canvasFrame(main, canvas.id);
  await until(total, (value) => value === 'EUR 1943', 'source snapshot and state survive restart');
  checks.push('native restart preserves the refreshed snapshot and inputs');
  await app.close(main);
  app = undefined;
  main = undefined;
  const reloaded = new Canvases(profile, { changed: () => {} });
  const exported = await reloaded.export(1, canvas.id, root);
  const imported = await reloaded.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    conversation,
  );
  assert.equal(imported.state.quantity, 41);
  assert.equal(imported.sources[0]?.path, undefined);
  assert.equal(imported.sources[0]?.data.table?.rows[1]?.[1], '43');
  checks.push(
    'portable export/reopen keeps snapshot data and inputs without source-path authority',
  );
  await writeFile(
    path.join(root, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        root,
        checks,
        kind: 'deterministic native fixture; no live provider claim',
        limitations: ['Native result save picker is not automated by this fixture.'],
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
    JSON.stringify({ error: String(error), checks }, null, 2),
    { flag: 'wx' },
  );
  throw error;
} finally {
  if (app) await app.close(main);
  await service.flush();
  console.log('Retained native fixture: ' + root);
}
