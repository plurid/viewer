/** Real SO-101 meshes in the sandbox, deterministic UI fixture, no provider calls or removals. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvases } from '../../src/desktop/canvases/service';
import { attachRobotMeshes } from '../../src/desktop/canvases/robot';
import { inspectFile } from '../../src/desktop/files/inspection';
import { forwardKinematics } from '../../src/domain/robotics/kinematics';
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
assert.ok(process.env.VIEWER_ROBOT_CORPUS, 'Set VIEWER_ROBOT_CORPUS to the pinned SO-101 fixture.');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.join(appRoot, 'out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await realpath(await temporaryRoot('viewer-native-robotics-'));
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
const html = await readFile(
  new URL('../fixtures/robotics/workbench.html', import.meta.url),
  'utf8',
);
const canvas = await canvases.write(
  1,
  initial.id,
  resources.revision,
  'SO-101 joint workbench',
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
try {
  let frame = await start();
  assert.ok(
    await frame.evaluate(
      pageCall(
        () => document.querySelector('#status')!.getBoundingClientRect().bottom <= innerHeight,
      ),
    ),
    'Status remains visible inside the canvas',
  );
  assert.equal((await read()).document.assets.length, 13);
  assert.equal(
    await frame.evaluate(
      pageCall(() => document.querySelectorAll('.joint input[type=range]').length),
    ),
    6,
  );
  checks.push(
    'Pinned robot source and all 13 STL assets load through the isolated canvas; six joint controls',
  );
  const before = await frame.evaluate(pageCall(() => document.documentElement.dataset.pose));
  const sliderValue = await frame.evaluate(
    pageCall(() => {
      const slider = document.querySelector<HTMLInputElement>('input[aria-label="shoulder_pan"]')!;
      slider.value = '0.5';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return slider.valueAsNumber;
    }),
  );
  await until(
    async () => (await read()).document.state['joint.shoulder_pan'],
    (value) => value === sliderValue,
    'joint state saved',
  );
  const after = await frame.evaluate(pageCall(() => document.documentElement.dataset.pose));
  assert.notEqual(before, after);
  const positions = Object.fromEntries(
    bound.source.data.robot.joints
      .filter((j) => j.type !== 'fixed')
      .map((j) => [j.name, j.name === 'shoulder_pan' ? sliderValue : 0]),
  );
  const expected = forwardKinematics(
    bound.source.data.robot,
    positions,
  ).links.gripper_frame_link!.slice(12, 15);
  JSON.parse(after!).forEach((value: number, index: number) =>
    assert.ok(Math.abs(value - expected[index]!) < 1e-12),
  );
  await screenshot(main!, path.join(root, 'arm.png'));
  checks.push(
    'Moving a joint updates the articulated world transforms and persists its exact value',
  );
  await frame.evaluate(
    pageCall(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="shoulder_pan definition"]')!
        .click(),
    ),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(
          () => document.querySelector('pre[aria-label="shoulder_pan definition"]')?.textContent,
        ),
      ),
    (text) => !!text?.includes('<joint name="shoulder_pan"'),
    'host source definition',
  );
  await screenshot(main!, path.join(root, 'source.png'));
  checks.push('A joint requests its exact captured URDF definition in the host for review');
  // Invalid values remain visible, while the model and stored joint bounds stay unchanged.
  await frame.evaluate(
    pageCall(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="shoulder_pan radians"]',
      )!;
      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await until(
    () =>
      frame.evaluate(
        pageCall(() => document.querySelector('#status')?.getAttribute('data-invalid')),
      ),
    (value) => value === 'true',
    'out-of-range input reported',
  );
  assert.ok(
    (
      await frame.evaluate(pageCall(() => document.querySelector('#message')?.textContent))
    )?.includes('4.000'),
  );
  await frame.evaluate(
    pageCall(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="shoulder_pan radians"]',
      )!;
      input.value = '0.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const base = document.querySelector<HTMLInputElement>('#base')!;
      base.value = '0.05';
      base.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  );
  await until(
    async () => (await read()).document.state.baseX,
    (value) => value === 0.05,
    'base state saved',
  );
  checks.push(
    'Out-of-range poses are shown without clamping; base translation saves independently',
  );
  await app!.close(main);
  app = undefined;
  main = undefined;
  frame = await start();
  assert.equal(
    await frame.evaluate(
      pageCall(
        () =>
          document.querySelector<HTMLInputElement>('input[aria-label="shoulder_pan radians"]')
            ?.value,
      ),
    ),
    '0.5',
  );
  assert.equal(
    await frame.evaluate(pageCall(() => document.querySelector<HTMLInputElement>('#base')?.value)),
    '0.05',
  );
  checks.push(
    'Cold restart restores the arm, all meshes, joint values and base position without providers',
  );
  await screenshot(main!, path.join(root, 'restart.png'));
  await frame.evaluate(
    pageCall(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="shoulder_pan definition"]')!
        .click(),
    ),
  );
  await until(
    () =>
      main!.evaluate(
        pageCall(() => {
          const open = [
            ...document.querySelectorAll<HTMLButtonElement>('.canvas-sources button'),
          ].find((button) => button.textContent === 'Open joint definition');
          open?.click();
          return !!open;
        }),
      ),
    Boolean,
    'open joint definition',
  );
  await until(
    () =>
      main!.evaluate(pageCall(() => document.querySelector('.evidence-line code')?.textContent)),
    (text) => !!text?.includes('<joint name="shoulder_pan"'),
    'source line is highlighted in URDF preview',
  );
  checks.push(
    'Open joint definition navigates to the original URDF and highlights the exact source line',
  );
  await app!.close(main);
  app = undefined;
  main = undefined;
  const exported = await canvases.export(1, canvas.id, root);
  const reopened = await canvases.import(
    1,
    path.join(exported, 'canvas.viewer.json'),
    randomUUID(),
  );
  assert.equal(reopened.state['joint.shoulder_pan'], 0.5);
  assert.equal(reopened.state.baseX, 0.05);
  assert.equal(reopened.sources[0]!.path, undefined);
  assert.equal(reopened.assets.length, 13);
  assert.equal(reopened.sources[0]!.hash, bound.source.hash);
  checks.push('Portable export reopens with input state, original source hash and all 13 meshes');
  const importedPane = state.workspaces[0]!.panes[0]!;
  assert.equal(importedPane.type, 'canvas');
  if (importedPane.type === 'canvas') importedPane.canvasID = reopened.id;
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
  frame = await start(reopened.id);
  assert.equal(
    await frame.evaluate(pageCall(() => document.querySelector<HTMLInputElement>('#base')?.value)),
    '0.05',
  );
  assert.equal(
    await frame.evaluate(
      pageCall(
        () =>
          document.querySelector<HTMLInputElement>('input[aria-label="shoulder_pan radians"]')
            ?.value,
      ),
    ),
    '0.5',
  );
  await screenshot(main!, path.join(root, 'imported.png'));
  checks.push(
    'The imported canvas renders its meshes and saved pose in a fresh app process without original-file authority',
  );
  await app!.close(main);
  app = undefined;
  main = undefined;
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        binary,
        profile,
        revision: manifest.revision,
        checks,
        exported,
        canvasID: canvas.id,
        retained: true,
      },
      null,
      2,
    ),
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
