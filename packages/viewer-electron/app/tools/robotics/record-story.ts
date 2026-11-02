/** Record a project acquiring new capabilities from retained agent sessions. No provider calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { parse } from 'jsonc-parser';
import { Canvases } from '../../src/desktop/canvases/service';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { chatDocumentSchema } from '../../src/domain/models/chat';
import type { SavedState } from '../../src/domain/contracts';
import { ownedApp, until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import { recordFrames, screenshot } from '../docs/record';
import type { Connection } from '../docs/record';
import { inputOverlay } from '../docs/input-overlay';
import { sessionReplay } from '../docs/session-replay';
import { prepareRobotPresentation } from './prepare-presentation';
import { presentationControls } from './presentation-controls';

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    binary: { type: 'string' },
    'opening-from': { type: 'string' },
  },
});
assert.ok(values.run && values.binary, 'Pass --run and --binary.');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = path.resolve(values.binary);
const presentation = await prepareRobotPresentation(values.run);
const { root, profile } = presentation;
const project = path.join(values.run, 'SO-101/Simulation/SO101');
const handoff = path.join(root, 'Handoff');
await mkdir(handoff);
const readJSON = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
const opening = values['opening-from']
  ? (JSON.parse(
      await readFile(path.join(values['opening-from'], 'story-capture.json'), 'utf8'),
    ) as {
      sourceRun: string;
      providerRequests: number;
      clips: { name: string }[];
    })
  : undefined;
if (opening) {
  assert.equal(opening.sourceRun, values.run);
  assert.equal(opening.providerRequests, 0);
  assert.equal(
    (
      (await readJSON(path.join(values['opening-from']!, 'story-completed.json'))) as {
        status: string;
      }
    ).status,
    'passed',
  );
}
const documents = await Promise.all(
  presentation.edits.map(async (edit) => ({
    stage: edit.stage,
    canvas: canvasDocumentSchema.parse(
      await readJSON(path.join(profile, 'canvas-documents', edit.id + '.json')),
    ),
  })),
);
const creation = documents.find((d) => d.stage === 'create')!.canvas;
const refinement = documents.find((d) => d.stage === 'refine')!.canvas;
const conversations = await Promise.all(
  [creation, refinement].map(async (d) =>
    chatDocumentSchema.parse(
      await readJSON(path.join(profile, 'chat-documents', d.conversationID + '.json')),
    ),
  ),
);
const service = new Canvases(profile, { changed: () => {} });
for (const original of [creation, refinement]) {
  const d = await service.read(1, original.id);
  await service.state(1, d.id, d.stateRevision, d.revision, {
    cam_px: 0.95,
    cam_py: -0.65,
    cam_pz: 0.6,
    cam_tx: 0.27,
    cam_ty: 0,
    cam_tz: 0.22,
  });
}
await service.flush();
for (const d of [creation, refinement]) {
  const file = path.join(profile, 'canvas-documents', d.id + '.json');
  const current = canvasDocumentSchema.parse(await readJSON(file));
  await writeFile(
    file,
    JSON.stringify({
      ...current,
      path: handoff,
      title: d.id === refinement.id ? 'Workcell test' : current.title,
    }),
  );
}
const configFile = path.join(profile, 'config.jsonc');
const config = parse(await readFile(configFile, 'utf8'));
assert.equal(config.settings.providers.length, 0);
config.settings.terminals.profiles = [
  {
    id: 'login',
    name: 'Login shell',
    executable: '',
    args: [],
    env: {},
  },
];
config.settings.terminals.profileID = 'login';
config.settings.terminalFont = {
  ...config.settings.terminalFont,
  fontSize: 17,
  fontWeight: 'normal',
  letterSpacing: 0,
};
await writeFile(configFile, JSON.stringify(config));
const guide = `<!doctype html><html><head><meta charset="utf-8"><title>SO-101 project notes</title><style>
body{margin:0;background:#292d34;color:#f2f4f6;font:18px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:740px;margin:64px auto;padding:0 36px}h1{font-size:36px;font-weight:600;line-height:1.2}h2{font-size:20px;margin-top:32px}p{color:#b1bac6}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #454b55}code{font-size:15px}small{color:#b1bac6}
</style></head><body><main><small>SO-101 / Workcell study</small><h1>Where should the arm go?</h1><p>Choose a base position that lets the gripper reach both marked work points.</p><h2>Project inputs</h2><table><tr><td>Robot</td><td>SO-101 follower</td></tr><tr><td>Geometry</td><td>Robot definition and 13 mesh files</td></tr><tr><td>Task</td><td>Two fixed points, A and B</td></tr><tr><td>Endpoint tolerance</td><td>1 mm</td></tr></table><h2>Working question</h2><p>Inspect the arm first. Then add target testing to compare base positions.</p><small>Local project notes for this demonstration.</small></main></body></html>`;
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(guide);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const stateFile = path.join(profile, 'viewer-state-v1.json');
const state = (await readJSON(stateFile)) as SavedState;
state.workspaces = [
  {
    id: 'project',
    name: 'SO-101 project',
    panes: [
      {
        id: 'files',
        type: 'folder',
        path: project,
        mode: 'list',
        sort: 'name',
        descending: false,
        showHidden: false,
        history: [project],
        historyIndex: 0,
        sidebar: { visible: false, width: 200 },
      },
      { id: 'browser', type: 'browser', path: project, url, title: 'Project notes' },
      { id: 'terminal', type: 'terminal', path: project, profileID: 'login' },
      {
        id: 'conversation',
        type: 'chat',
        path: creation.path,
        conversationID: creation.conversationID,
      },
    ],
    roots: ['files', 'browser', 'terminal', 'conversation'],
    activePane: 'files',
    arrangement: {},
  },
];
state.activeWorkspace = 'project';
state.openWindows = ['project'];
await writeFile(stateFile, JSON.stringify(state));
console.log(JSON.stringify({ root, profile, providerRequests: 0 }));
let app: Awaited<ReturnType<typeof ownedApp>> | undefined;
let main!: Connection;
let overlay!: Awaited<ReturnType<typeof inputOverlay>>;
let ui!: ReturnType<typeof presentationControls>;
let replay!: ReturnType<typeof sessionReplay>;
const clips: unknown[] = [],
  evidence: unknown[] = [],
  replays: unknown[] = [];
let marks: { seconds: number; action: string; narration: string }[] = [];
let started = 0;
let recording = false;
let recreatingOpening = false;
const scope = (id: string) => `[data-canvas-id="${id}"]`;
const chat = (id: string) => `[data-conversation-id="${id}"]`;
const mark = (action: string, narration: string) => {
  const entry = { seconds: (performance.now() - started) / 1000, action, narration };
  marks.push(entry);
  console.log(JSON.stringify(entry));
};
const save = () =>
  writeFile(
    path.join(root, 'story-capture.json'),
    JSON.stringify(
      {
        root,
        profile,
        sourceRun: values.run,
        binary,
        presentation,
        reusedOpening: values['opening-from'],
        providerRequests: 0,
        clips,
        evidence,
        replays,
        width: 2880,
        height: 1800,
        sourceFormat: 'png',
        presentationNote:
          'Saved request excerpts and generated revisions. Repair rounds condensed; reveal timing and layout locally refined. Native interactions and measurements follow.',
      },
      null,
      2,
    ),
  );
async function start() {
  app = await ownedApp(binary, profile, {
    mode: 'hidden',
    mockKeychain: true,
    label: 'interface-story',
    // Supply a plain shell to the owned process without changing the person's terminal profile.
    environment: { SHELL: '/bin/sh', ENV: '/dev/null', PS1: 'SO-101 $ ' },
  });
  const raw = await app.connect();
  await raw.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
    viewport: { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
  });
  await until(
    () => raw.evaluate(pageCall(() => !!document.querySelector('[data-viewer-plane="files"]'))),
    Boolean,
    'project workspace',
  );
  overlay = await inputOverlay(raw);
  main = overlay.connection;
  ui = presentationControls(main, overlay.mapPointer);
  replay = sessionReplay(main);
  await delay(1000);
}
async function close() {
  replays.push(replay.events);
  overlay.dispose();
  await app!.close(main);
  app = undefined;
}
async function click(selector: string, label?: string, cue = '', double = false, modifiers = 0) {
  console.log(JSON.stringify({ input: 'click', control: label ?? selector }));
  const p = await until(
    () =>
      main.evaluate(
        pageCall(
          (selector, label) => {
            const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
              (e) =>
                e.checkVisibility() &&
                !e.matches(':disabled') &&
                (!label || e.textContent?.trim() === label),
            );
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const x = r.x + r.width / 2,
              y = r.y + r.height / 2;
            return x > 0 && y > 0 && x < innerWidth && y < innerHeight ? { x, y } : null;
          },
          selector,
          label,
        ),
      ),
    Boolean,
    'visible ' + (label ?? selector),
  );
  assert.ok(p);
  overlay.cue(cue);
  const from = overlay.position();
  for (let i = 1; i <= 10; i++) {
    const t = i / 10,
      e = t * t * (3 - 2 * t);
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (p.x - from.x) * e,
      y: from.y + (p.y - from.y) * e,
    });
    await delay(20);
  }
  for (let n = 1; n <= (double ? 2 : 1); n++) {
    for (const type of ['mousePressed', 'mouseReleased'])
      await main.command('Input.dispatchMouseEvent', {
        type,
        ...p,
        button: 'left',
        clickCount: n,
        modifiers,
      });
    if (double && n === 1) await delay(70);
  }
  await delay(400);
  overlay.cue('');
}
async function key(cue: string, key: string, code: string, virtual: number, modifiers = 0) {
  console.log(JSON.stringify({ input: 'key', key, modifiers, cue }));
  overlay.cue(cue);
  await ui.key(key, code, virtual, modifiers);
  overlay.cue('');
  await delay(700);
}
async function all() {
  await click('[aria-label="Commands (⌘K)"]');
  await main.command('Input.insertText', { text: 'Frame all planes' });
  await key('Frame all planes', 'Enter', 'Enter', 13);
  await delay(700);
}
async function frame(id: string) {
  const selector = `[data-viewer-plane="${id}"] [aria-label="Frame plane"]`;
  if (recording) await click(selector, undefined, 'Focus this plane');
  else
    await main.evaluate(
      pageCall((selector) => {
        const control = document.querySelector<HTMLButtonElement>(selector);
        if (!control) throw Error('Missing framing control');
        control.click();
      }, selector),
    );
  await delay(900);
  await until(
    () =>
      main.evaluate(
        pageCall((id) => {
          const r = document.querySelector(`[data-viewer-plane="${id}"]`)!.getBoundingClientRect();
          return r.width > innerWidth * 0.65 && r.left >= -1 && r.right <= innerWidth + 1;
        }, id),
      ),
    Boolean,
    'framed ' + id,
  );
}
async function take(name: string, actions: () => Promise<void>, omitActions: string[] = []) {
  marks = [];
  overlay.reset();
  started = performance.now();
  const retained = opening?.clips.find((clip, index) => index < 6 && clip.name === name);
  if (retained) {
    // Recreate the workspace relationships, but retain the approved opening's exact source frames.
    recreatingOpening = true;
    try {
      await actions();
    } finally {
      recreatingOpening = false;
    }
    clips.push(retained);
    await save();
    console.log(JSON.stringify({ name, reused: values['opening-from'] }));
    return;
  }
  console.log('Recording ' + name);
  recording = true;
  const result = await recordFrames(main, path.join(root, name), actions, {
    width: 2880,
    height: 1800,
  });
  recording = false;
  clips.push({ name, ...result, marks, omitActions, inputs: overlay.events.slice() });
  await save();
  console.log(JSON.stringify({ name, seconds: result.seconds, frames: result.frames }));
}
async function beat(action: string, narration: string, seconds: number, work = async () => {}) {
  mark(action, narration);
  const time = performance.now();
  await work();
  if (!recreatingOpening) await delay(Math.max(0, seconds * 1000 - (performance.now() - time)));
}
async function readCanvas(id: string) {
  const result = await main.evaluate(
    pageCall((id) => window.viewer.canvas({ kind: 'read', id }), id),
  );
  assert.ok(result.document);
  return result.document;
}
async function endpointLabel(
  canvas: Awaited<ReturnType<typeof ui.canvas>>,
  endpoint?: { id: string; position: number[]; error: number },
) {
  const { state } = await readCanvas(refinement.id);
  const camera = {
    position: [Number(state.cam_px), Number(state.cam_py), Number(state.cam_pz)],
    target: [Number(state.cam_tx), Number(state.cam_ty), Number(state.cam_tz)],
  };
  assert.ok([...camera.position, ...camera.target].every(Number.isFinite));
  await canvas.frame.evaluate(
    pageCall(
      (endpoint, camera) => {
        let label = document.querySelector<HTMLDivElement>('#capture-endpoint');
        if (!endpoint) {
          if (label) label.hidden = true;
          return;
        }
        const view = document.querySelector<HTMLElement>('#viewBox')!;
        const normalize = (v: number[]) => {
          const length = Math.hypot(...v);
          return v.map((n) => n / length);
        };
        const cross = (a: number[], b: number[]) => [
          a[1]! * b[2]! - a[2]! * b[1]!,
          a[2]! * b[0]! - a[0]! * b[2]!,
          a[0]! * b[1]! - a[1]! * b[0]!,
        ];
        const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i]!, 0);
        const forward = normalize(camera.target.map((n, i) => n - camera.position[i]!));
        const right = normalize(cross(forward, [0, 0, 1]));
        const up = cross(right, forward);
        const relative = endpoint.position.map((n, i) => n - camera.position[i]!);
        const depth = dot(relative, forward);
        if (depth <= 0) throw Error('Endpoint is behind the recorded camera.');
        // The retained canvas uses a 45-degree perspective camera with Z up.
        const focal = view.clientHeight / (2 * Math.tan(Math.PI / 8));
        const x = view.clientWidth / 2 + (dot(relative, right) * focal) / depth;
        const y = view.clientHeight / 2 - (dot(relative, up) * focal) / depth;
        if (x < 0 || y < 0 || x > view.clientWidth - 180 || y > view.clientHeight - 60)
          throw Error('Checked endpoint label would leave the recorded view.');
        if (!label) {
          label = document.createElement('div');
          label.id = 'capture-endpoint';
          label.style.cssText =
            'position:absolute;pointer-events:none;padding:8px 12px;border-left:1px solid #b1bac6;' +
            'background:rgba(11,14,17,.9);color:#f2f4f6;font:500 15px/1.5 -apple-system,sans-serif;z-index:3;';
          view.append(label);
        }
        label.hidden = false;
        label.style.left = x + 20 + 'px';
        label.style.top = y + 12 + 'px';
        label.textContent = endpoint.id + ' · ' + (endpoint.error * 1000).toFixed(3) + ' mm';
      },
      endpoint ?? null,
      camera,
    ),
  );
}
async function watchPlayback(canvas: Awaited<ReturnType<typeof ui.canvas>>) {
  await canvas.frame.evaluate(
    pageCall(() => {
      const status = document.querySelector<HTMLElement>('#replayLine')!;
      const observer = new MutationObserver((records) => {
        const values = [
          status.textContent,
          ...records.flatMap((record) =>
            [...record.addedNodes, ...record.removedNodes].map((node) => node.textContent),
          ),
        ];
        const error = values.find((value) => value && /failed|unavailable|missing/i.test(value));
        if (error) status.dataset.capturePlaybackError = error;
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
    }),
  );
}
async function verifyPlayback(canvas: Awaited<ReturnType<typeof ui.canvas>>) {
  const error = await canvas.frame.evaluate(
    pageCall(
      () => document.querySelector<HTMLElement>('#replayLine')?.dataset.capturePlaybackError,
    ),
  );
  assert.equal(error, undefined, 'The recorded replay must not flash an error.');
}
try {
  await start();
  await all();
  await frame('files');
  await take('00-project', async () => {
    await beat(
      'personal',
      "Until twenty twenty-five, I'd written about a million lines of code. Since then, I've modified ten thousand at most, mostly configuration files.",
      14,
      async () => {
        await delay(1500);
        await click(
          '[data-file-path$="/so101_new_calib.urdf"]',
          undefined,
          'Open linked source',
          true,
          1,
        );
        await delay(5000);
        await key('Back to the project', 'ArrowUp', 'ArrowUp', 38, 5);
      },
    );
    await beat(
      'direction',
      'Now I spend more time deciding how a project fits together, what changes, and what that affects.',
      9,
      async () => {
        await click('[data-file-path$="/assets"]');
        await key('Expand folder', 'ArrowRight', 'ArrowRight', 39);
        await click(
          '[data-file-path$="/upper_arm_so101_v1.stl"]',
          undefined,
          'Open linked model',
          true,
          1,
        );
        await delay(2000);
        await all();
      },
    );
  });
  await frame('browser');
  await take('01-browser', async () => beat('browser', 'A browser.', 3));
  await all();
  const sourcePlane = await main.evaluate(
    pageCall(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-viewer-plane]')].find(
          (e) =>
            e.textContent?.includes('so101_new_calib.urdf') &&
            e.querySelector('[aria-label="Frame plane"]'),
        )?.dataset.viewerPlane,
    ),
  );
  assert.ok(sourcePlane);
  await frame(sourcePlane);
  await take('02-editor', async () =>
    beat('editor', 'An editor.', 3.5, async () => {
      await key('Edit the source', 'e', 'KeyE', 69, 4);
      await until(
        () => main.evaluate(pageCall(() => !!document.querySelector('.text-editor .cm-editor'))),
        Boolean,
        'native text editor',
      );
    }),
  );
  await all();
  await frame('terminal');
  await take('03-terminal', async () =>
    beat('terminal', 'A terminal.', 4, async () => {
      await click('.terminal-plane .xterm-screen', undefined, 'Project terminal');
      await main.command('Input.insertText', { text: 'ls' });
      await key('List project files', 'Enter', 'Enter', 13);
      await delay(800);
    }),
  );
  const request = conversations[0]!.messages.find((m) => m.role === 'user')!;
  await replay.mount(chat(creation.conversationID), request, 'SO-101 robot project', {
    end: request.text.indexOf('.') + 1,
    providerName: 'Meta',
  });
  await take('04-workspace', async () => {
    await beat(
      'keynote',
      'A browser. An editor. A terminal. Are you getting it? One workspace.',
      8,
      async () => {
        await all();
      },
    );
    await beat(
      'foundations',
      'This is Viewer. Plurid is its spatial engine. I was building both before this hackathon.',
      7,
    );
    await beat(
      'hackathon',
      "For the hackathon, I gave Meta a canvas. It builds working interfaces from the project's files.",
      8,
      async () => {
        await frame('conversation');
      },
    );
  });
  await take('05-create', async () => {
    await beat(
      'goal',
      'I need to choose where to mount this arm so its gripper can reach two fixed points. First, let me explore the model.',
      10,
      async () => {
        await click('[data-replay-composer] textarea', undefined, 'Ask for the tool');
        await delay(800);
        await replay.type(request, 4200);
        await key('Send request', 'Enter', 'Enter', 13, 4);
        await replay.coverCanvas();
        await click(
          chat(creation.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Open generated tool',
        );
        const canvas = await ui.canvas(creation.id);
        await replay.revealCanvas(canvas.frame, 'create');
      },
    );
    await beat(
      'joints',
      'The files become an interactive model. I can move a joint and open the definition behind it.',
      10,
      async () => {
        const canvas = await ui.canvas(creation.id);
        const before = await readCanvas(creation.id);
        overlay.cue('Move the shoulder');
        await canvas.drag('[data-jkey="jpos_shoulder_pan"]', 0.565, 0.72);
        overlay.cue('');
        assert.notEqual(
          (await readCanvas(creation.id)).state.jpos_shoulder_pan,
          before.state.jpos_shoulder_pan,
        );
        await canvas.press('.joint:first-child button');
        await click('.canvas-sources button', 'Open joint definition', 'Follow the source');
        await delay(1800);
        await key('Back to the tool', 'ArrowUp', 'ArrowUp', 38, 5);
      },
    );
  });
  await replay.dismiss();
  await close();
  const resumed = (await readJSON(stateFile)) as SavedState;
  const pane = resumed.workspaces[0]!.panes.find((p) => p.id === 'conversation');
  assert.ok(pane?.type === 'chat');
  pane.conversationID = refinement.conversationID;
  await writeFile(stateFile, JSON.stringify(resumed));
  await start();
  await all();
  await frame('conversation');
  const change = conversations[1]!.messages.find(
    (m) => m.id === '77911ad6-e3de-4fd3-a32a-96c321b0add8',
  )!;
  const beginning = change.text.indexOf('Read task.json');
  const ending = change.text.indexOf('. Start with') + 1;
  assert.ok(beginning >= 0 && ending > beginning);
  await replay.mount(chat(refinement.conversationID), change, 'Add target testing to this tool', {
    start: beginning,
    end: ending,
    providerName: 'Meta',
  });
  await take('06-evolve', async () => {
    await beat(
      'requirement',
      'Now add the two work points, and let me test the base position.',
      10,
      async () => {
        await replay.type(change, 4800);
        await key('Send request', 'Enter', 'Enter', 13, 4);
        await replay.coverCanvas();
        await click(
          chat(refinement.conversationID) + ' .chat-toolbar button',
          'Canvas',
          'Open the updated tool',
        );
        const canvas = await ui.canvas(refinement.id);
        await replay.revealCanvas(canvas.frame, 'refine');
      },
    );
    const canvas = await ui.canvas(refinement.id);
    await watchPlayback(canvas);
    await beat(
      'new-controls',
      'The same tool gains target controls, a solver, and a check against the robot model.',
      6,
      async () => {
        overlay.cue('Check the candidate poses');
        await canvas.press('#checkBtn');
        overlay.cue('');
      },
    );
    const original = await main.evaluate(
      pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), refinement.id),
    );
    assert.equal(original.robotReport?.status, 'checked');
    assert.equal(original.robotReport?.passed, false);
    evidence.push({ original: original.robotReport });
    await beat(
      'missed',
      'At this base position, the candidate poses miss both points.',
      4,
      async () => {
        const label = await main.evaluate(
          pageCall(
            (selector) =>
              [...document.querySelectorAll(selector + ' .canvas-inspector > summary')]
                .find((e) => e.textContent?.startsWith('Robot check'))!
                .textContent!.trim(),
            scope(refinement.id),
          ),
        );
        await click(
          scope(refinement.id) + ' .canvas-inspector > summary',
          label,
          'Inspect the measured result',
        );
        await delay(1300);
        await click(scope(refinement.id) + ' .canvas-inspector > summary', label);
      },
    );
    await beat(
      'move-base',
      'Move the base fifty-five centimetres, and solve again.',
      9,
      async () => {
        overlay.cue('Move the base');
        await canvas.press('details:has(#bx) > summary');
        await canvas.input('#bx', '0.55');
        await until(
          async () => (await readCanvas(refinement.id)).state.robotTask,
          (task) =>
            !!task &&
            typeof task === 'object' &&
            !Array.isArray(task) &&
            JSON.stringify(task.base) === JSON.stringify({ xyz: [0.55, 0, 0], rpy: [0, 0, 0] }),
          'changed base is saved before solving',
        );
        await canvas.press('details:has(#bx) > summary');
        overlay.cue('');
        await delay(1700);
        overlay.cue('Solve for both targets');
        await canvas.press('#solveBoth');
        overlay.cue('');
        await until(
          () =>
            canvas.frame.evaluate(
              pageCall(() => document.querySelector<HTMLButtonElement>('#solveBoth')?.disabled),
            ),
          (d) => d === false,
          'solver completes',
        );
        await canvas.press('#checkBtn');
      },
    );
    const checked = await until(
      async () =>
        (
          await main.evaluate(
            pageCall((id) => window.viewer.canvas({ kind: 'robot-report', id }), refinement.id),
          )
        ).robotReport,
      (r) => r?.status === 'checked' && r.passed,
      'new endpoint check passes',
    );
    assert.ok(checked?.status === 'checked');
    assert.equal(checked.input.base.xyz[0], 0.55);
    assert.deepEqual(checked.input.targets, original.robotReport?.input.targets);
    evidence.push({ alternative: checked, targetsUnchanged: true });
    await beat(
      'result',
      'Both points are within a millimetre. That gives me a base position.',
      5.5,
      async () => {
        const label = await main.evaluate(
          pageCall(
            (selector) =>
              [...document.querySelectorAll(selector + ' .canvas-inspector > summary')]
                .find((e) => e.textContent?.startsWith('Robot check'))!
                .textContent!.trim(),
            scope(refinement.id),
          ),
        );
        await click(
          scope(refinement.id) + ' .canvas-inspector > summary',
          label,
          'Inspect the checked result',
        );
        await screenshot(main, path.join(root, 'checked-result.png'));
        await delay(1300);
        await click(scope(refinement.id) + ' .canvas-inspector > summary', label);
      },
    );
    await beat('endpoints', '', 7, async () => {
      const taskBeforeReplay = (await readCanvas(refinement.id)).state.robotTask;
      overlay.cue('Show target A');
      await canvas.press('#scrub');
      await ui.key('Home', 'Home', 36, 0, canvas.frame.sessionId);
      overlay.cue('');
      await until(
        async () => (await readCanvas(refinement.id)).state.replayIdx,
        (position) => position === 0,
        'replay starts at target A',
      );
      const show = async (id: string) => {
        const target = checked.input.targets.find((target) => target.id === id)!;
        const pose = checked.poses.find((pose) => pose.targetID === id)!;
        assert.ok(pose.withinTolerance && pose.violations.length === 0);
        await endpointLabel(canvas, { id, position: target.position, error: pose.residual });
      };
      await show('A');
      await delay(1300);
      await endpointLabel(canvas);
      overlay.cue('Replay to target B');
      await canvas.press('#playBtn');
      overlay.cue('');
      await until(
        async () => (await readCanvas(refinement.id)).state.replayIdx,
        (position) => position === 1,
        'replay arrives at target B',
      );
      await show('B');
      await delay(1500);
      await endpointLabel(canvas);
      assert.deepEqual((await readCanvas(refinement.id)).state.robotTask, taskBeforeReplay);
      await verifyPlayback(canvas);
      evidence.push({
        endpointLabels: checked.poses,
        annotation: 'Checked values at sampled endpoints only',
      });
    });
  });
  let importedID = '';
  await take(
    '07-keep-working',
    async () => {
      const before = await readCanvas(refinement.id);
      mark('save-tool', '');
      const earlierExports = new Set(await readdir(handoff));
      await click(scope(refinement.id) + ' button', 'Export canvas…', 'Save the working tool');
      await click('.viewer-file-picker footer .primary', undefined, 'Export canvas');
      const exported = await until(
        () => readdir(handoff),
        (names) => names.some((n) => n.startsWith('Viewer canvas ') && !earlierExports.has(n)),
        'export saved',
      ).then((names) =>
        path.join(
          handoff,
          names.find((n) => n.startsWith('Viewer canvas ') && !earlierExports.has(n))!,
        ),
      );
      mark('handoff-navigation', '');
      await key('Back to the tool', 'ArrowUp', 'ArrowUp', 38, 5);
      await click(scope(refinement.id) + ' button', 'Conversation');
      await click(
        chat(refinement.conversationID) + ' .chat-toolbar button',
        'Open canvas…',
        'Reopen saved tool',
      );
      await ui.folder(exported);
      mark('reopen-tool', '');
      await click('.viewer-file-picker footer .primary', undefined, 'Open saved canvas');
      const known = documents.map((d) => d.canvas.id);
      const found = await until(
        () =>
          main.evaluate(
            pageCall(
              (known) =>
                [...document.querySelectorAll<HTMLElement>('[data-canvas-id]')]
                  .map((e) => e.dataset.canvasId!)
                  .find((id) => !known.includes(id)),
              known,
            ),
          ),
        Boolean,
        'imported canvas',
      );
      assert.ok(found);
      importedID = found;
      const imported = await ui.canvas(importedID);
      await watchPlayback(imported);
      assert.deepEqual((await readCanvas(importedID)).state.robotTask, before.state.robotTask);
      overlay.cue('Continue in the saved tool');
      await imported.press('#scrub');
      await ui.key('Home', 'Home', 36, 0, imported.frame.sessionId);
      await until(
        async () => (await readCanvas(importedID)).state.replayIdx,
        (position) => position === 0,
        'reopened replay starts at target A',
      );
      overlay.cue('');
      await delay(500);
      evidence.push({ exported, importedID, restoredTask: true });
    },
    ['handoff-navigation'],
  );
  await take('08-closing', async () => {
    const planeFor = (id: string) =>
      main.evaluate(
        pageCall((id) => {
          let element = document.querySelector(`[data-canvas-id="${id}"]`);
          while (element) {
            const header = element.querySelector<HTMLElement>('[data-viewer-plane]');
            if (header) return header.dataset.viewerPlane;
            element = element.parentElement;
          }
        }, id),
      );
    await beat(
      'tool-evolution',
      'When I started, I could inspect the robot. Then I needed to test where to put it. So I asked for those controls.',
      11,
      async () => {
        await all();
        const originalPlane = await planeFor(creation.id);
        assert.ok(originalPlane);
        await frame(originalPlane);
        const inspector = await ui.canvas(creation.id);
        overlay.cue('The first tool: joint controls');
        await inspector.drag('[data-jkey="jpos_shoulder_pan"]', 0.72, 0.57);
        overlay.cue('');
        await delay(600);
        await all();
      },
    );
    await beat(
      'closing',
      'I want to work like this: open my project, explain what I need, and use the tool as it takes shape.',
      10,
      async () => {
        const savedPlane = await planeFor(importedID);
        assert.ok(savedPlane);
        await frame(savedPlane);
        const canvas = await ui.canvas(importedID);
        overlay.cue('The added tool: target testing');
        await canvas.press('#playBtn');
        overlay.cue('');
        await until(
          async () => (await readCanvas(importedID)).state.replayIdx,
          (position) => position === 1,
          'reopened tool reaches its saved endpoint',
        );
        await verifyPlayback(canvas);
        await screenshot(main, path.join(root, 'final-tool.png'));
      },
    );
  });
  await replay.dismiss();
  await close();
  await save();
  await writeFile(
    path.join(root, 'story-completed.json'),
    JSON.stringify({ status: 'passed', root, providerRequests: 0 }),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ status: 'passed', root }));
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  await writeFile(path.join(root, 'story-failure.txt'), message, { flag: 'wx' });
  throw error;
} finally {
  if (app) await app.close(main);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await save();
}
