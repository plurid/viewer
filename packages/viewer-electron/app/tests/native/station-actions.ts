/** Real action handlers and robot meshes; local fixture, zero provider requests. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvases } from '../../src/desktop/canvases/service';
import { attachRobotMeshes } from '../../src/desktop/canvases/robot';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { inspectFile } from '../../src/desktop/files/inspection';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import type { PlacementStudy } from '../../src/domain/robotics/placement';
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
assert.ok(process.env.VIEWER_ROBOT_CORPUS, 'Provide the pinned SO-101 corpus.');
assert.ok(process.env.VIEWER_TEST_BINARY, 'Provide the rebuilt Viewer binary.');
const binary = process.env.VIEWER_TEST_BINARY;
const root = await realpath(await temporaryRoot('viewer-station-actions-'));
console.log('Evidence:', root);
const profile = path.join(root, 'Profile');
await mkdir(profile);
const manifest = JSON.parse(
  await readFile(new URL('../fixtures/robotics/so101/manifest.json', import.meta.url), 'utf8'),
) as {
  files: { path: string; sha256: string; bytes: number }[];
};
const project = path.join(root, 'Six-slot station');
for (const file of manifest.files) {
  const bytes: Buffer = await readFile(path.join(process.env.VIEWER_ROBOT_CORPUS, file.path));
  assert.equal(bytes.length, file.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  const destination = path.join(project, file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
}
const briefFile = path.join(project, 'station.json');
await writeFile(
  briefFile,
  await readFile(new URL('../fixtures/robotics/station.json', import.meta.url)),
  { flag: 'wx' },
);
const service = new Canvases(profile, { changed() {} });
const initial = await service.create(1, randomUUID(), project);
const source = await service.source(
  1,
  initial.id,
  0,
  await inspectFile(path.join(project, 'Simulation/SO101/so101_new_calib.urdf'), { content: true }),
);
const meshes = await attachRobotMeshes(
  service,
  1,
  initial.id,
  source.source,
  async (file) => {
    assert.ok(file.startsWith(project + '/'));
    return file;
  },
  new AbortController().signal,
);
const brief = await service.source(
  1,
  initial.id,
  meshes.revision,
  await inspectFile(briefFile, { content: true }),
);
const canvas = await service.write(
  1,
  initial.id,
  brief.revision,
  'Six-slot station',
  await readFile(new URL('../fixtures/robotics/station.html', import.meta.url), 'utf8'),
  {
    robotResources: meshes.resources,
    study: { version: 1, reserved: [], candidates: [], selected: 'existing' },
  },
);
const quote = 'Compare the rear mounting point with the front mounting point.';
const messageID = randomUUID();
await new ChatDocumentStore(
  path.join(profile, 'chat-documents', canvas.conversationID + '.json'),
).save({
  version: 4,
  id: canvas.conversationID,
  title: 'Six-slot station',
  path: project,
  providerID: '',
  scopes: [],
  canvasID: canvas.id,
  messages: [{ id: messageID, role: 'user', text: quote, at: Date.now() }],
  draft: '',
  draftRevision: 0,
  revision: 1,
  updated: Date.now(),
  status: 'idle',
  level: 'names',
});
const settings = defaultSettings(project);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
async function workspace(document: CanvasDocument) {
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    activeWorkspace: 'station',
    favorites: [],
    recents: [],
    look: 'dark',
    workspaces: [
      {
        id: 'station',
        name: 'Six-slot station',
        panes: [
          {
            id: 'station-canvas',
            type: 'canvas',
            canvasID: document.id,
            path: project,
            title: document.title,
          },
        ],
        roots: ['station-canvas'],
        activePane: 'station-canvas',
        arrangement: {},
      },
    ],
  };
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
}
await workspace(canvas);
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const checks: string[] = [];
const read = async (id = canvas.id) =>
  (await main!.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id))).document;
const invoke = async (action: string, input: Record<string, string | boolean>, id = canvas.id) => {
  const document = await read(id);
  return main!.evaluate(
    pageCall(
      (id, revision, stateRevision, action, input) =>
        window.viewer.canvas({ kind: 'invoke-action', id, revision, stateRevision, action, input }),
      id,
      document.revision,
      document.stateRevision,
      action,
      input,
    ),
  );
};
const check = async (id = canvas.id) => {
  const document = await read(id);
  return (
    await main!.evaluate(
      pageCall(
        (id, revision, stateRevision, sourceID, briefSourceID) =>
          window.viewer.canvas({
            kind: 'check-placements',
            id,
            revision,
            stateRevision,
            sourceID,
            briefSourceID,
            stateKey: 'study',
          }),
        id,
        document.revision,
        document.stateRevision,
        source.source.id,
        brief.source.id,
      ),
    )
  ).placementReport;
};
const start = async (id = canvas.id) => {
  app = await ownedApp(binary, profile, {
    label: 'station-actions',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const frame = await canvasFrame(main, id);
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.loaded)),
    (value) => Number(value) > 0,
    'robot meshes',
  );
  return frame;
};
const close = async () => {
  if (app) await app.close(main);
  app = undefined;
  main = undefined;
};
try {
  let frame = await start();
  console.log('Running registered action through the native host');
  const first = await invoke('evaluatePlacements', { reserveCentral: false });
  assert.equal(first.actionRun?.status, 'completed', first.actionRun?.error ?? 'Action completed');
  assert.equal(first.document.revision, canvas.revision);
  const before = await check();
  assert.equal(before?.status, 'checked');
  if (before?.status !== 'checked') throw new Error('Missing independent report');
  assert.deepEqual(
    before.candidates.map((c) => c.reached),
    [3, 6, 6, 6],
  );
  assert.equal(before.recommended, 'central');
  await invoke('selectMount', { mount: 'central' });
  await check();
  checks.push(
    'Native registered handler computes 24 poses; Viewer recomputes 3/6, 6/6, 6/6, 6/6 from bound sources',
  );
  await screenshot(main!, path.join(root, 'initial.png'));

  // Exercise the exact user control, which invokes the same registered handler.
  await frame.evaluate(
    pageCall(() => {
      document.querySelector<HTMLInputElement>('#reserved')!.checked = true;
      document.querySelector<HTMLButtonElement>('#evaluate')!.click();
    }),
  );
  await until(
    async () => ((await read()).state.study as unknown as PlacementStudy).reserved.length === 1,
    Boolean,
    'updated constraint persisted',
  );
  const after = await check();
  assert.equal(after?.status, 'checked');
  if (after?.status !== 'checked') throw new Error('Missing independent report');
  assert.equal(after.recommended, 'front');
  assert.equal(after.candidates[1]!.allowed, false);
  await invoke('selectMount', { mount: 'front' });
  await check();
  checks.push(
    'The visible button uses the same action API; reserving the centre changes the recommendation to Front',
  );
  await main!.evaluate(
    pageCall(() =>
      [...document.querySelectorAll<HTMLElement>('summary')]
        .find((s) => s.textContent?.includes('Station study'))!
        .click(),
    ),
  );
  await screenshot(main!, path.join(root, 'reserved.png'));
  await main!.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot(main!, path.join(root, 'narrow.png'));
  assert.equal(
    await main!.evaluate(pageCall(() => document.documentElement.scrollWidth > innerWidth)),
    false,
  );
  await main!.command('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const unchanged = (await read()).stateRevision;
  const running = invoke('evaluatePlacements', { reserveCentral: false });
  await until(
    () =>
      main!.evaluate(
        pageCall(() => !!document.querySelector('.canvas-action-status[data-status="running"]')),
      ),
    Boolean,
    'visible action activity',
  );
  await main!.evaluate(
    pageCall(() =>
      document.querySelector<HTMLButtonElement>('.canvas-action-status button')!.click(),
    ),
  );
  const cancelled = await running;
  assert.equal(cancelled.actionRun?.status, 'cancelled');
  assert.equal((await read()).stateRevision, unchanged);
  checks.push('Take over cancels a running action without committing a partial pose study');

  await main!.evaluate(
    pageCall((id) => window.viewer.chat({ kind: 'open', id }), canvas.conversationID),
  );
  const branch = await main!.evaluate(
    pageCall(
      (id, messageID, end) =>
        window.viewer.chat({ kind: 'branch', id, messageID, start: 0, end, revision: 1 }),
      canvas.conversationID,
      messageID,
      quote.length,
    ),
  );
  assert.ok(!Array.isArray(branch) && branch.canvasID);
  if (Array.isArray(branch) || !branch.canvasID) throw new Error('Quoted alternative unavailable');
  assert.equal(branch.branch?.quote, quote);
  const branchCanvas = await read(branch.canvasID);
  await close();
  await workspace(branchCanvas);
  frame = await start(branchCanvas.id);
  await invoke('selectMount', { mount: 'rear' }, branchCanvas.id);
  await check(branchCanvas.id);
  const comparison = (
    await main!.evaluate(
      pageCall((id) => window.viewer.canvas({ kind: 'placement-comparison', id }), branchCanvas.id),
    )
  ).placementComparison;
  assert.equal(comparison?.status, 'compared');
  if (comparison?.status === 'compared') {
    assert.equal(comparison.original.report.input.selected, 'front');
    assert.equal(comparison.alternative.report.input.selected, 'rear');
  }
  checks.push(
    'An exact quoted branch retains sources and constraints; independently checked Front and Rear compare after restart',
  );
  await screenshot(main!, path.join(root, 'alternative.png'));
  await close();
  const saved = new Canvases(profile, { changed() {} });
  const original = await saved.read(1, canvas.id);
  const savedCheck = path.join(root, 'station-check.json');
  await saved.savePlacementCheck(
    1,
    canvas.id,
    original.revision,
    original.stateRevision,
    async () => savedCheck,
  );
  const exported = await saved.export(1, canvas.id, root);
  const imported = await saved.import(1, path.join(exported, 'canvas.viewer.json'), randomUUID());
  await saved.flush();
  await workspace(imported);
  frame = await start(imported.id);
  const reopened = (
    await main!.evaluate(
      pageCall((id) => window.viewer.canvas({ kind: 'placement-report', id }), imported.id),
    )
  ).placementReport;
  assert.equal(reopened?.status, 'checked');
  if (reopened?.status === 'checked') assert.equal(reopened.input.selected, 'front');
  assert.equal(
    (await read(imported.id)).sources.every((s) => s.path === undefined),
    true,
  );
  assert.equal(JSON.parse(await readFile(savedCheck, 'utf8')).recommended, 'front');
  await screenshot(main!, path.join(root, 'reopened.png'));
  checks.push(
    'Export/import and a native cold restart retain the mesh assets, selected mount and recomputed check, without source-path authority',
  );
  await writeFile(
    path.join(root, 'summary.json'),
    JSON.stringify(
      {
        status: 'passed',
        providerRequests: 0,
        fixture: fileURLToPath(new URL('../fixtures/robotics/station.html', import.meta.url)),
        binary,
        profile,
        canvasID: imported.id,
        exported,
        savedCheck,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'passed', root, checks }, null, 2));
} finally {
  await close();
}
