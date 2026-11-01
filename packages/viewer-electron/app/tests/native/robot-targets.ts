/** Real SO-101 meshes in the sandbox, deterministic UI fixture, no provider calls or removals. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvases } from '../../src/desktop/canvases/service';
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
import { screenshot } from '../../tools/docs/record';

assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.ok(process.env.VIEWER_ROBOT_CORPUS, 'Set VIEWER_ROBOT_CORPUS to the pinned SO-101 fixture.');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await realpath(await temporaryRoot('viewer-native-robot-targets-'));
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
const initial = await canvases.create(1, randomUUID(), modelFolder);
const bound = await canvases.source(1, initial.id, 0, await inspectFile(urdf, { content: true }));
assert.ok(bound.source.data.robot);
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
const html = await readFile(new URL('../fixtures/robotics/targets.html', import.meta.url), 'utf8');
const canvas = await canvases.write(
  1,
  initial.id,
  resources.revision,
  'SO-101 target workbench',
  html,
  {
    robotResources: resources.resources,
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
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'robot',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'robot',
      name: 'Robot qualification',
      panes: [
        {
          id: 'robot-canvas',
          type: 'canvas',
          canvasID: canvas.id,
          path: modelFolder,
          title: canvas.title,
        },
      ],
      roots: ['robot-canvas'],
      activePane: 'robot-canvas',
      arrangement: {},
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const checks: string[] = [];
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main: CanvasConnection | undefined;
const read = () =>
  main!.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'read', id }), canvas.id));
const start = async (id = canvas.id) => {
  app = await ownedApp(binary, profile, { label: 'robotics', mode: 'hidden', mockKeychain: true });
  main = await app.connect();
  const frame = await canvasFrame(main, id);
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.loaded)),
    (count) => Number(count) > 0,
    'articulated meshes loaded',
  );
  return frame;
};
const report = () =>
  main!.evaluate(pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), canvas.id));
const check = async (
  frame: Awaited<ReturnType<typeof canvasFrame>>,
  expected: 'passed' | 'failed',
) => {
  await frame.evaluate(
    pageCall(() => document.querySelector<HTMLButtonElement>('#check')!.click()),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(() => document.querySelector('.canvas-robot-check')?.getAttribute('data-state')),
      ),
    (state) => state === expected,
    'native checker ' + expected,
  );
};
const setTarget = async (frame: Awaited<ReturnType<typeof canvasFrame>>, point: number[]) => {
  await frame.evaluate(
    pageCall((point) => {
      for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
        const input = document.querySelector<HTMLInputElement>(
          `input[aria-label="Target ${axis} in metres"]`,
        )!;
        input.value = String(point[index]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, point),
  );
};
try {
  let frame = await start();
  await until(async () => (await read()).document.state.robotTask, Boolean, 'saved target task');
  // Use a real pointer event to activate the plane before recording its normal focused appearance.
  const area = await main!.evaluate(
    pageCall(() => {
      const rect = document.querySelector('.canvas-body')!.getBoundingClientRect();
      return { x: rect.left + 100, y: rect.top + 100 };
    }),
  );
  await main!.command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...area,
    button: 'left',
    clickCount: 1,
  });
  await main!.command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...area,
    button: 'left',
    clickCount: 1,
  });
  await check(frame, 'passed');
  const initial = (await report()).robotReport;
  assert.equal(initial?.status, 'checked');
  if (initial?.status === 'checked') assert.ok(initial.poses[0]!.residual < 1e-10);
  checks.push(
    'Frame request flushes saved inputs and Viewer independently verifies the initial target',
  );
  await main!.evaluate(
    pageCall(() => document.querySelector<HTMLElement>('.canvas-robot-check summary')!.click()),
  );
  await screenshot(main!, path.join(root, 'checked.png'));
  await setTarget(frame, [5, 5, 5]);
  await until(
    () =>
      main!.evaluate(
        pageCall(() => document.querySelector('.canvas-robot-check')?.getAttribute('data-state')),
      ),
    (value) => value === 'stale',
    'target invalidates pass',
  );
  await frame.evaluate(
    pageCall(() => document.querySelector<HTMLButtonElement>('#solve')!.click()),
  );
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.solve)),
    (v) => v === 'unresolved',
    'impossible target unresolved',
  );
  await check(frame, 'failed');
  assert.ok(
    (
      await frame.evaluate(pageCall(() => document.querySelector('#solve-result')?.textContent))
    )?.includes('does not prove'),
  );
  checks.push(
    'Changing a target invalidates the check; unsuccessful solving remains unresolved and the native checker measures the miss',
  );
  await screenshot(main!, path.join(root, 'unresolved.png'));
  const reference = JSON.parse(
    await readFile(new URL('../fixtures/robotics/so101/poses.json', import.meta.url), 'utf8'),
  );
  const target = reference.cases[1].links.gripper_frame_link.slice(12, 15) as number[];
  await setTarget(frame, target);
  await frame.evaluate(
    pageCall(() => document.querySelector<HTMLButtonElement>('#solve')!.click()),
  );
  await until(
    () => frame.evaluate(pageCall(() => document.documentElement.dataset.solve)),
    (v) => v === 'candidate',
    'target solved',
  );
  await check(frame, 'passed');
  const task = (await read()).document.state.robotTask as RobotTask;
  const verified = (await report()).robotReport;
  assert.equal(verified?.status, 'checked');
  if (verified?.status === 'checked') assert.ok(verified.poses[0]!.residual <= task.tolerance);
  checks.push(
    'A new candidate pose for an independently recorded SO-101 target passes the desktop checker',
  );
  await screenshot(main!, path.join(root, 'solved.png'));
  await main!.command('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot(main!, path.join(root, 'compact.png'));
  await main!.command('Emulation.clearDeviceMetricsOverride');
  await main!.evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => main!.evaluate(pageCall(() => document.documentElement.dataset.look)),
    (v) => v === 'light',
    'light check panel',
  );
  await screenshot(main!, path.join(root, 'light.png'));
  await main!.evaluate(patchSettings({ path: 'settings.appearance', value: 'dark' }));
  await until(
    () => main!.evaluate(pageCall(() => document.documentElement.dataset.look)),
    (v) => v === 'dark',
    'dark check panel',
  );
  await main!.evaluate(
    pageCall(() =>
      [...document.querySelectorAll<HTMLButtonElement>('.canvas-robot-report button')]
        .find((button) => button.textContent === 'Check poses')!
        .focus(),
    ),
  );
  await main!.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await main!.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  assert.equal(
    await main!.evaluate(pageCall(() => document.activeElement?.textContent)),
    'Save check JSON…',
  );
  const enter = async () => {
    await main!.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    });
    await main!.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
  };
  await enter();
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
    'Viewer save dialog for checked result',
  );
  await enter();
  const uiCheckFile = path.join(modelFolder, 'robot-check.json');
  const uiSaved = await until(
    () => readFile(uiCheckFile, 'utf8').catch(() => ''),
    Boolean,
    'checked JSON saved through Viewer dialog',
  );
  assert.deepEqual(JSON.parse(uiSaved).input, task);
  assert.equal(JSON.parse(uiSaved).passed, true);
  checks.push(
    'Keyboard Tab and Enter activate Save check JSON, then Enter in Viewer’s dialog writes the measured report as a new file',
  );
  await app!.close(main);
  app = undefined;
  main = undefined;
  frame = await start();
  await until(
    async () => (await report()).robotReport?.status,
    (v) => v === 'checked',
    'restart recomputes check',
  );
  assert.deepEqual((await read()).document.state.robotTask, task);
  checks.push('Cold restart restores targets, candidate positions and a freshly recomputed check');
  await app!.close(main);
  app = undefined;
  main = undefined;
  const latest = await canvases.read(1, canvas.id);
  const checkedFile = path.join(root, 'checked-poses.json');
  await canvases.saveRobotCheck(
    1,
    canvas.id,
    latest.revision,
    latest.stateRevision,
    async () => checkedFile,
  );
  const saved = JSON.parse(await readFile(checkedFile, 'utf8'));
  assert.deepEqual(saved.input, task);
  assert.equal(saved.passed, true);
  const exported = await canvases.export(1, canvas.id, root);
  const imported = await canvases.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  const pane = state.workspaces[0]!.panes[0]!;
  if (pane.type === 'canvas') pane.canvasID = imported.id;
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
  frame = await start(imported.id);
  const importedReport = await main!.evaluate(
    pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), imported.id),
  );
  assert.equal(importedReport.robotReport?.status, 'checked');
  if (importedReport.robotReport?.status === 'checked')
    assert.equal(importedReport.robotReport.passed, true);
  assert.deepEqual(importedReport.document.state.robotTask, task);
  await screenshot(main!, path.join(root, 'imported.png'));
  checks.push(
    'Saved check JSON reads back with measured results; imported canvas restores the pose and recomputes its check from portable source data',
  );
  await app!.close(main);
  app = undefined;
  main = undefined;
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ binary, profile, checks, exported, checkedFile, retained: true }, null, 2),
  );
  console.log(JSON.stringify({ root, checks }, null, 2));
} catch (error) {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ binary, profile, checks, error: String(error), retained: true }, null, 2),
  );
  console.error('Retained robot evidence:', root);
  throw error;
} finally {
  if (app) await app.close(main);
}
