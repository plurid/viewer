/** Assemble a review copy without changing provider HTML or the retained live sessions. */
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Canvases } from '../../src/desktop/canvases/service';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { temporaryRoot } from '../temporary';
import {
  readJSON,
  readRobotSessionResult,
  fingerprint,
  digest,
  saveEvidence,
} from '../robotics/rehearsal';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import { ownedApp, until } from '../../tests/owned-app';
import { canvasFrame } from '../../tests/native/runtime/canvas';
import { pageCall } from '../../tests/native/runtime/page-function';
import { screenshot } from '../docs/record';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    'mounting-profile': { type: 'string' },
    'comparison-profile': { type: 'string' },
    binary: { type: 'string' },
  },
});
assert.ok(values.run && values['mounting-profile'] && values['comparison-profile']);
const run = await realpath(values.run);
const root = await realpath(await temporaryRoot('viewer-mounting-review-'));
const profile = path.join(root, 'Profile');
const project = path.join(root, 'Mounting plate');
await mkdir(project);
await cp(path.join(run, 'Profile'), profile, { recursive: true, errorOnExist: true, force: false });
for (const name of ['mounting-plate.dxf', 'mounting-plate-quote.md'])
  await writeFile(path.join(project, name), await readFile(path.join(run, name)), { flag: 'wx' });
const canvases = new Canvases(profile, { changed: () => {} });
const qualified: CanvasDocument[] = [];
const counts: number[] = [];
for (const [index, input] of [values['mounting-profile'], values['comparison-profile']].entries()) {
  const folder = path.join(run, 'sessions', String(index + 1).padStart(2, '0'));
  counts.push((await readdir(folder)).filter((name) => /^request-\d{2}\.json$/.test(name)).length);
  const original = ((await readRobotSessionResult(folder)) as { canvas: CanvasDocument }).canvas;
  const observed = canvasDocumentSchema.parse(
    await readJSON(path.join(input!, 'canvas-documents', original.id + '.json')),
  );
  assert.equal(observed.html, original.html);
  assert.equal(fingerprint(observed.sources), fingerprint(original.sources));
  assert.equal(fingerprint(observed.assets), fingerprint(original.assets));
  await writeFile(
    path.join(profile, 'canvas-documents', observed.id + '.json'),
    JSON.stringify({ ...observed, path: project }),
  );
  const titled =
    index === 0 && observed.title === 'null'
      ? await canvases.write(
          1,
          observed.id,
          observed.revision,
          'SO-101 mounting plate',
          observed.html,
          observed.defaults,
        )
      : observed;
  qualified.push(titled);
}
assert.ok(counts.every((n) => n <= 8) && counts.reduce((sum, n) => sum + n, 0) <= 16);
await canvases.flush();
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'mounting',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: qualified.map((canvas, index) => {
    const id = index ? 'comparison' : 'mounting';
    return {
      id,
      name: index ? 'Cutting quote' : 'SO-101 mounting',
      panes: [
        {
          id: id + '-canvas',
          type: 'canvas' as const,
          canvasID: canvas.id,
          path: project,
          title: canvas.title,
        },
      ],
      roots: [id + '-canvas'],
      activePane: id + '-canvas',
      arrangement: {},
    };
  }),
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
const report = {
  run,
  root,
  profile,
  project,
  requests: counts,
  totalRequests: counts.reduce((sum, n) => sum + n, 0),
  canvases: qualified.map((canvas) => ({
    id: canvas.id,
    title: canvas.title,
    htmlHash: digest(canvas.html),
    state: canvas.state,
  })),
  localChanges: [
    'Corrected the mounting title from the literal null.',
    'Copied native-tested user input state and directed new exports to this review folder.',
  ],
  unchanged:
    'Generated HTML, source snapshots, mesh assets and the original provider-session evidence.',
  limitations: [
    'This is a fictional demo job with assigned plate dimensions; no physical fabrication is part of the demonstration.',
    'Supplier prices are a local simulation; no order was sent.',
    'Mounting generation published its HTML at the request cap without a final chat reply.',
  ],
};
await saveEvidence(path.join(root, 'review.json'), report);
if (values.binary) {
  const app = await ownedApp(values.binary, profile, {
    label: 'mounting-review',
    mode: 'hidden',
    mockKeychain: true,
  });
  const main = await app.connect();
  try {
    const frame = await canvasFrame(main, qualified[0]!.id);
    await until(
      () =>
        frame.evaluate(
          pageCall(
            () => !!document.querySelector('#svg rect') && !!document.querySelector('#view canvas'),
          ),
        ),
      Boolean,
      'generated drawing and 3D viewport',
    );
    // Local protocol loads have no Resource Timing entries. Allow their first
    // renders to settle; the retained screenshot is the visual loading check.
    await frame.evaluate(pageCall(() => new Promise((resolve) => setTimeout(resolve, 1500))));
    await until(
      () =>
        main.evaluate(
          pageCall(() => {
            let node: Element | null = document.querySelector('.canvas-plane');
            while (node) {
              if (Number(getComputedStyle(node).opacity) < 0.99) return false;
              node = node.parentElement;
            }
            return true;
          }),
        ),
      Boolean,
      'settled mounting view',
    );
    await screenshot(main, path.join(root, 'mounting-review.png'));
  } finally {
    await app.close(main);
  }
}
console.log(
  JSON.stringify({ root, profile, project, requests: counts, totalRequests: report.totalRequests }),
);
