import type { ExperimentAPI } from '../../src/domain/robotics/experiment-canvases';
/** Real SO-101 meshes in the sandbox, deterministic UI fixture, no provider calls or removals. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExperimentCanvases as Canvases } from '../../tools/robotics/experiment-canvases';
import { attachRobotMeshes } from '../../src/desktop/canvases/robot';
import { inspectFile } from '../../src/desktop/files/inspection';
import type { RobotTask } from '../../src/domain/robotics/task';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { canvasFrame } from './runtime/canvas';
import type { CanvasConnection } from './runtime/canvas';
import { pageCall } from './runtime/page-function';
import { patchSettings } from './runtime/page';
import { ChatDocumentStore } from '../../src/desktop/chat/documents';
import { forwardKinematics } from '../../src/domain/robotics/kinematics';
import { createPoseReplay } from '../../src/domain/robotics/replay';
import { screenshot } from '../../tools/docs/record';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.ok(process.env.VIEWER_ROBOT_CORPUS, 'Set VIEWER_ROBOT_CORPUS to the pinned SO-101 fixture.');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await realpath(await temporaryRoot('viewer-native-robot-comparison-'));
const profile = path.join(root, 'Profile');
await mkdir(profile);
const manifest = JSON.parse(
  await readFile(new URL('../fixtures/robotics/so101/manifest.json', import.meta.url), 'utf8'),
) as {
  revision: string;
  files: { path: string; sha256: string; bytes: number }[];
};
const modelFolder = path.join(root, 'Model');
for (const file of manifest.files) {
  const bytes: Buffer = await readFile(path.join(process.env.VIEWER_ROBOT_CORPUS, file.path));
  assert.equal(bytes.length, file.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  const destination = path.join(modelFolder, file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
}
const urdf = path.join(modelFolder, 'Simulation/SO101/so101_new_calib.urdf');
const canvases = new Canvases(profile, { changed: () => {} });
const conversation = randomUUID();
const messageID = randomUUID();
const initial = await canvases.create(1, conversation, modelFolder);
const bound = await canvases.source(1, initial.id, 0, await inspectFile(urdf, { content: true }));
assert.ok(bound.source.data.robot);
const visualCount = bound.source.data.robot.links.reduce(
  (sum, link) => sum + link.visuals.length,
  0,
);
const resources = await attachRobotMeshes(
  canvases,
  1,
  initial.id,
  bound.source,
  async (file) => {
    assert.ok(file.startsWith(path.dirname(urdf) + '/'));
    return file;
  },
  new AbortController().signal,
);
const arrangement = JSON.parse(
  await readFile(new URL('../fixtures/robotics/base-placement.json', import.meta.url), 'utf8'),
);
const zero = Object.fromEntries(
  bound.source.data.robot.joints.filter((j) => j.type !== 'fixed').map((j) => [j.name, 0]),
);
const input: RobotTask = {
  version: 1,
  units: { length: 'm', angle: 'rad' },
  tool: { link: 'gripper_frame_link', point: [0, 0, 0] },
  base: arrangement.base,
  tolerance: 0.001,
  targets: arrangement.targets,
  poses: arrangement.targets.map((target: { id: string }) => ({
    targetID: target.id,
    positions: { ...zero },
  })),
};
const html = await readFile(new URL('../fixtures/robotics/targets.html', import.meta.url), 'utf8');
const canvas = await canvases.write(
  1,
  initial.id,
  resources.revision,
  'SO-101 target workbench',
  html,
  {
    robotResources: resources.resources,
    robotTask: input,
    baseX: 0,
    ...Object.fromEntries(
      bound.source.data.robot.joints
        .filter((joint) => joint.type !== 'fixed')
        .map((joint) => ['joint.' + joint.name, 0]),
    ),
  },
);
const settings = defaultSettings(root);
settings.providers = [];
settings.hotkey.enabled = false;
await writeFile(
  path.join(profile, 'config.jsonc'),
  JSON.stringify({ version: 1, settings, ui: normalizePreferences() }),
);
const quote = 'Move the base while keeping these two world targets fixed.';
await new ChatDocumentStore(path.join(profile, 'chat-documents', conversation + '.json')).save({
  version: 4,
  id: conversation,
  title: 'Local robot comparison fixture',
  path: modelFolder,
  providerID: '',
  scopes: [],
  canvasID: canvas.id,
  messages: [
    {
      id: messageID,
      role: 'assistant',
      text: 'Local test fixture, not a model response. ' + quote,
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
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'robot',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'robot',
      name: 'Robot comparison',
      panes: [
        {
          id: 'robot-canvas',
          type: 'canvas',
          canvasID: canvas.id,
          path: modelFolder,
          title: canvas.title,
        },
        { id: 'robot-chat', type: 'chat', conversationID: conversation, path: modelFolder },
      ],
      roots: ['robot-canvas', 'robot-chat'],
      activePane: 'robot-canvas',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const checks: string[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const read = (id: string) =>
  main!.evaluate(
    pageCall((id) => (window.viewer as unknown as ExperimentAPI).canvas({ kind: 'read', id }), id),
  );
const start = async (id: string) => {
  app = await ownedApp(binary, profile, {
    label: 'robot-comparison',
    mode: 'hidden',
    mockKeychain: true,
  });
  main = await app.connect();
  const frame = await canvasFrame(main, id);
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.loaded)),
    (n) => Number(n) === visualCount,
    'real robot meshes',
  );
  return frame;
};
const press = (frame: Awaited<ReturnType<typeof canvasFrame>>, selector: string) =>
  frame.evaluate(
    pageCall((selector) => document.querySelector<HTMLButtonElement>(selector)!.click(), selector),
  );
const solve = async (frame: Awaited<ReturnType<typeof canvasFrame>>, outcome: string) => {
  await press(frame, '#solve');
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.solve)),
    (s) => s === outcome,
    'bounded pose search',
  );
};
const report = (id: string) =>
  main!.evaluate(
    pageCall(
      (id) => (window.viewer as unknown as ExperimentAPI).canvas({ kind: 'robot-report', id }),
      id,
    ),
  );
const comparison = (id: string) =>
  main!.evaluate(
    pageCall(
      (id) => (window.viewer as unknown as ExperimentAPI).canvas({ kind: 'robot-comparison', id }),
      id,
    ),
  );
const check = async (
  frame: Awaited<ReturnType<typeof canvasFrame>>,
  id: string,
  passed: boolean,
) => {
  await press(frame, '#check');
  await until(
    async () => (await report(id)).robotReport,
    (r) => r?.status === 'checked' && r.passed === passed,
    'independent endpoint check',
  );
};
const framePlane = async (id: string, dock = false) => {
  await main!.evaluate(
    pageCall(
      (id, dock) => {
        let node = document.querySelector(`[data-canvas-id="${id}"]`);
        while (node) {
          const button = node.querySelector<HTMLButtonElement>(
            dock ? '[aria-label="Dock plane"]' : '[aria-label="Frame plane"]',
          );
          if (button) {
            button.click();
            return;
          }
          node = node.parentElement;
        }
        throw new Error('Plane frame control unavailable');
      },
      id,
      dock,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 900));
  await until(
    () =>
      main!.evaluate(
        pageCall((id) => {
          const rect = document.querySelector(`[data-canvas-id="${id}"]`)!.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }, id),
      ),
    Boolean,
    'whole plane inside viewport',
  );
};
const close = async () => {
  await app!.close(main);
  app = undefined;
  main = undefined;
};
try {
  let frame = await start(canvas.id);
  await solve(frame, 'unresolved');
  await check(frame, canvas.id, false);
  const originalTask = (await read(canvas.id)).document.state.robotTask as RobotTask;
  const initialReport = (await report(canvas.id)).robotReport;
  assert.equal(initialReport?.status, 'checked');
  if (initialReport?.status === 'checked')
    assert.ok(initialReport.poses.every((p) => p.residual > 0.1));
  checks.push('Viewer measures both original candidate misses; the search remains unresolved');
  await until(
    () =>
      main!.evaluate(
        pageCall((id) => !!document.querySelector(`[data-chat-text="${id}"]`), messageID),
      ),
    Boolean,
    'fixture explanation',
  );
  await main!.evaluate(
    pageCall(
      (id, quote) => {
        const node = document.querySelector(`[data-chat-text="${id}"]`)!.firstChild!;
        const start = node.textContent!.indexOf(quote);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + quote.length);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        node.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      },
      messageID,
      quote,
    ),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(() =>
          [...document.querySelectorAll('button')].some(
            (b) => b.textContent === 'Ask about selection',
          ),
        ),
      ),
    Boolean,
    'quote action',
  );
  await main!.evaluate(
    pageCall(() =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent === 'Ask about selection')!
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
    'quoted branch',
  );
  assert.ok(branchID);
  const branch = await main!.evaluate(
    pageCall(async (id) => {
      const value = await window.viewer.chat({ kind: 'open', id });
      if (Array.isArray(value)) throw new Error('Expected conversation');
      return value;
    }, branchID),
  );
  assert.equal(branch.branch?.quote, quote);
  assert.equal(branch.branch?.context.length, 1);
  assert.ok(branch.canvasID);
  const alternateID = branch.canvasID;
  assert.deepEqual((await read(alternateID)).document.state.robotTask, originalTask);
  await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) =>
            [...document.querySelectorAll(`[data-conversation-id="${id}"] button`)].some(
              (b) => b.textContent === 'Canvas',
            ),
          branchID,
        ),
      ),
    Boolean,
    'branch canvas action',
  );
  await main!.evaluate(
    pageCall(
      (id) =>
        [...document.querySelectorAll<HTMLButtonElement>(`[data-conversation-id="${id}"] button`)]
          .find((b) => b.textContent === 'Canvas')!
          .click(),
      branchID,
    ),
  );
  frame = await canvasFrame(main!, alternateID);
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.loaded)),
    (n) => Number(n) === visualCount,
    'branch meshes',
  );
  await frame.evaluate(
    pageCall(() => {
      const input = document.querySelector<HTMLInputElement>('#base')!;
      input.value = '0.55';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await solve(frame, 'candidate');
  await check(frame, alternateID, true);
  const alternativeTask = (await read(alternateID)).document.state.robotTask as RobotTask;
  assert.deepEqual(alternativeTask.targets, originalTask.targets);
  assert.deepEqual((await read(canvas.id)).document.state.robotTask, originalTask);
  const measured = (await comparison(alternateID)).robotComparison;
  assert.equal(measured?.status, 'compared');
  if (measured?.status === 'compared') {
    assert.equal(measured.original.report.passed, false);
    assert.equal(measured.alternative.report.passed, true);
  }
  checks.push(
    'Exact quoted passage forks the canvas; moving only the alternative base yields two checked candidates without changing original targets or poses',
  );
  await main!.evaluate(
    pageCall(
      (id) =>
        document
          .querySelector<HTMLElement>(`[data-canvas-id="${id}"] .canvas-robot-comparison summary`)!
          .click(),
      alternateID,
    ),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) =>
            document
              .querySelector(`[data-canvas-id="${id}"] .canvas-robot-comparison`)
              ?.getAttribute('data-state'),
          alternateID,
        ),
      ),
    (s) => s === 'compared',
    'native comparison table',
  );
  const activate = async (canvasID = alternateID) => {
    const point = await main!.evaluate(
      pageCall((id) => {
        const r = document
          .querySelector(`[data-canvas-id="${id}"] .canvas-body`)!
          .getBoundingClientRect();
        return { x: r.left + 50, y: r.top + 50 };
      }, canvasID),
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await main!.command('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        clickCount: 1,
      });
  };
  await activate();
  await press(frame, '#fit');
  await screenshot(main!, path.join(root, 'comparison.png'));
  const scrub = async (value: number) =>
    frame.evaluate(
      pageCall((value) => {
        const input = document.querySelector<HTMLInputElement>('#replay-cursor')!;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value),
    );
  await scrub(0.5);
  const expected = forwardKinematics(
    bound.source.data.robot!,
    createPoseReplay(bound.source.data.robot!, alternativeTask.poses).sample(0.5).positions,
    alternativeTask.base,
  ).links.gripper_frame_link!.slice(12, 15);
  const actual = JSON.parse(
    await frame.evaluate(pageCall(() => document.documentElement.dataset.pose!)),
  );
  actual.forEach((value: number, index: number) =>
    assert.ok(Math.abs(value - expected[index]!) < 1e-12),
  );
  await press(frame, '#play');
  await until(
    () => frame.evaluate(pageCall(() => Number(document.documentElement.dataset.replayCursor))),
    (v) => v > 0.6,
    'animated interpolation',
  );
  await press(frame, '#play');
  assert.equal(
    await frame.evaluate(pageCall(() => document.documentElement.dataset.replay)),
    'paused',
  );
  await scrub(0.4);
  await until(
    async () => (await read(alternateID)).document.state.replayCursor,
    (v) => v === 0.4,
    'saved paused preview',
  );
  assert.deepEqual((await read(alternateID)).document.state.robotTask, alternativeTask);
  assert.equal((await report(alternateID)).robotReport?.status, 'checked');
  checks.push(
    'Scrubbing and play/pause render interpolated poses without replacing candidates or invalidating endpoint checks',
  );
  await screenshot(main!, path.join(root, 'replay.png'));
  await main!.command('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await framePlane(alternateID, true);
  await screenshot(main!, path.join(root, 'compact.png'));
  await main!.command('Emulation.clearDeviceMetricsOverride');
  await framePlane(alternateID);
  await main!.evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await activate();
  await screenshot(main!, path.join(root, 'light.png'));
  await main!.evaluate(patchSettings({ path: 'settings.appearance', value: 'dark' }));
  // An edit in the original must invalidate the visible comparison, even while this canvas stays checked.
  const original = (await read(canvas.id)).document;
  await main!.evaluate(
    pageCall(
      (id, revision, stateRevision, robotTask) =>
        (window.viewer as unknown as ExperimentAPI).canvas({
          kind: 'state',
          id,
          contentRevision: revision,
          revision: stateRevision,
          patch: { robotTask },
        }),
      original.id,
      original.revision,
      original.stateRevision,
      { ...originalTask, tolerance: 0.002 },
    ),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) =>
            document
              .querySelector(`[data-canvas-id="${id}"] .canvas-robot-comparison`)
              ?.getAttribute('data-state'),
          alternateID,
        ),
      ),
    (s) => s === 'unavailable',
    'original edit invalidates comparison',
  );
  const altered = (await read(canvas.id)).document;
  await main!.evaluate(
    pageCall(
      (id, revision, stateRevision, robotTask) =>
        (window.viewer as unknown as ExperimentAPI).canvas({
          kind: 'state',
          id,
          contentRevision: revision,
          revision: stateRevision,
          patch: { robotTask },
        }),
      altered.id,
      altered.revision,
      altered.stateRevision,
      originalTask,
    ),
  );
  const restored = (await read(canvas.id)).document;
  await main!.evaluate(
    pageCall(
      (doc) =>
        (window.viewer as unknown as ExperimentAPI).canvas({
          kind: 'check-robot',
          id: doc.id,
          revision: doc.revision,
          stateRevision: doc.stateRevision,
          sourceID: doc.robotCheck!.sourceID,
          stateKey: 'robotTask',
        }),
      restored,
    ),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(
          (id) =>
            document
              .querySelector(`[data-canvas-id="${id}"] .canvas-robot-comparison`)
              ?.getAttribute('data-state'),
          alternateID,
        ),
      ),
    (s) => s === 'compared',
    'comparison refreshed',
  );
  checks.push('Changes to the original immediately invalidate the alternative comparison panel');
  await main!.evaluate(
    pageCall(
      (id) =>
        document
          .querySelector<HTMLButtonElement>(
            `[data-canvas-id="${id}"] .canvas-robot-comparison button`,
          )!
          .click(),
      alternateID,
    ),
  );
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
    'comparison save picker',
  );
  await main!.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    text: '\r',
  });
  await main!.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  const comparisonFile = path.join(modelFolder, 'robot-comparison.json');
  const saved = JSON.parse(
    await until(
      () => readFile(comparisonFile, 'utf8').catch(() => ''),
      Boolean,
      'saved comparison',
    ),
  );
  assert.deepEqual(saved.original.report.input, originalTask);
  assert.deepEqual(saved.alternative.report.input, alternativeTask);
  checks.push(
    'Viewer save dialog writes both independently measured tasks to a new comparison JSON',
  );
  await close();
  frame = await start(alternateID);
  assert.equal(
    await frame.evaluate(pageCall(() => document.documentElement.dataset.replay)),
    'paused',
  );
  assert.equal(
    Number(await frame.evaluate(pageCall(() => document.documentElement.dataset.replayCursor))),
    0.4,
  );
  assert.deepEqual((await read(alternateID)).document.state.robotTask, alternativeTask);
  assert.equal((await comparison(alternateID)).robotComparison?.status, 'compared');
  checks.push(
    'Cold restart restores both tasks and the paused replay, then recomputes the comparison',
  );
  await close();
  const exported = await canvases.export(1, alternateID, root);
  const imported = await canvases.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  assert.equal(imported.fork, undefined);
  state.workspaces[0]!.panes = [
    {
      id: 'imported',
      type: 'canvas',
      canvasID: imported.id,
      path: modelFolder,
      title: imported.title,
    },
  ];
  state.workspaces[0]!.roots = ['imported'];
  state.workspaces[0]!.activePane = 'imported';
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
  frame = await start(imported.id);
  assert.deepEqual((await read(imported.id)).document.state.robotTask, alternativeTask);
  assert.equal((await report(imported.id)).robotReport?.status, 'checked');
  await scrub(0.5);
  await framePlane(imported.id);
  await activate(imported.id);
  await press(frame, '#fit');
  await screenshot(main!, path.join(root, 'imported.png'));
  checks.push(
    'Portable export reopens with meshes, both candidates and replay; its independent check recomputes without an original-file link',
  );
  await close();
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ binary, profile, checks, exported, comparisonFile, retained: true }, null, 2),
  );
  console.log(JSON.stringify({ root, checks }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ binary, profile, checks, error: String(error), retained: true }, null, 2),
  );
  console.error('Retained robot comparison evidence:', root);
  throw error;
} finally {
  if (app) await app.close(main);
}
