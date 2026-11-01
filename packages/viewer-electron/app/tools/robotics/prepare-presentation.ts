import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Canvases } from '../../src/desktop/canvases/service';
import { canvasDocumentSchema } from '../../src/domain/canvases/document';
import { chatDocumentSchema } from '../../src/domain/models/chat';
import type { CanvasDocument } from '../../src/domain/canvases/document';
import type { SavedState } from '../../src/domain/contracts';
import { temporaryRoot } from '../temporary';
import { digest, readJSON, saveEvidence, verifyRobotRehearsal } from './rehearsal';
import { currentRobotSession, robotRehearsalStatus } from './rehearsal-session';
import { presentRobotDocument } from './presentation';

const require = createRequire(import.meta.url);
// Parsing only: scripts, resources and provider requests are never executed here.
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string) => {
    window: { document: Document; close(): void };
    serialize(): string;
  };
};

async function copy(source: string, destination: string) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('Presentation inputs must not be links.');
  if (info.isDirectory()) {
    await mkdir(destination);
    for (const name of await readdir(source))
      await copy(path.join(source, name), path.join(destination, name));
    return;
  }
  if (!info.isFile() || info.size > 24_000_000)
    throw new Error('Presentation input is not a bounded regular file.');
  await copyFile(source, destination, 1);
}

/** Keep provider evidence immutable and make the local presentation edits explicit and reproducible. */
export async function prepareRobotPresentation(directory: string) {
  assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
  assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
  const run = await realpath(directory);
  await verifyRobotRehearsal(run);
  const history = await robotRehearsalStatus(run);
  const creation = history.findLast(
    ({ result }) => result.stage === 'create' && result.status === 'generated',
  );
  assert.ok(
    creation?.result.canvas && creation.result.conversation,
    'Retain successful creation first.',
  );
  const refinement = await currentRobotSession(run, 'refine');
  const branch = await currentRobotSession(run, 'branch');
  for (const stage of [creation, refinement, branch]) {
    const review = (await readJSON(path.join(stage.folder, 'native-review.json'))) as {
      status: string;
    };
    assert.equal(
      review.status,
      'passed',
      'Qualify the provider output before presentation editing.',
    );
  }
  const root = await realpath(await temporaryRoot('viewer-robot-presentation-'));
  const profile = path.join(root, 'Profile');
  await mkdir(profile);
  const sourceFiles = [
    'canvas-assets',
    'canvas-documents',
    'chat-documents',
    'config.jsonc',
    'viewer-state-v1.json',
  ];
  for (const name of sourceFiles)
    await copy(path.join(run, 'Profile', name), path.join(profile, name));
  const config = JSON.parse(await readFile(path.join(profile, 'config.jsonc'), 'utf8'));
  assert.equal(
    config.settings.providers.length,
    0,
    'Presentation profiles have no configured models.',
  );

  const creationID = randomUUID();
  const conversationID = randomUUID();
  const creationReview = (await readJSON(path.join(creation.folder, 'native-review.json'))) as {
    result: { reviewedState: CanvasDocument['state'] };
  };
  const created = canvasDocumentSchema.parse({
    ...creation.result.canvas,
    id: creationID,
    conversationID,
    state: creationReview.result.reviewedState,
  });
  await saveEvidence(path.join(profile, 'canvas-documents', creationID + '.json'), created);
  await saveEvidence(
    path.join(profile, 'chat-documents', conversationID + '.json'),
    chatDocumentSchema.parse({
      ...creation.result.conversation,
      id: conversationID,
      canvasID: creationID,
    }),
  );
  const canvases = new Canvases(profile, { changed: () => {} });
  const css = await readFile(new URL('presentation.css', import.meta.url), 'utf8');
  const edits = [];
  const definitions = [
    {
      stage: 'create',
      id: creationID,
      title: 'Explore joints',
      source: creation.folder,
      center: 0.16,
    },
    {
      stage: 'refine',
      id: refinement.canvas.id,
      title: 'Original base',
      source: refinement.folder,
      center: 0.22,
    },
    {
      stage: 'branch',
      id: branch.canvas.id,
      title: 'Alternative base',
      source: branch.folder,
      center: 0.51,
    },
  ];
  for (const definition of definitions) {
    const before = await canvases.read(1, definition.id);
    const dom = new JSDOM(before.html);
    let html: string;
    let moduleHash: string;
    try {
      moduleHash = digest(
        [...dom.window.document.scripts].map((script) => script.outerHTML).join('\n'),
      );
      presentRobotDocument(dom.window.document, css);
      html = dom.serialize();
    } finally {
      dom.window.close();
    }
    const written = await canvases.write(
      1,
      before.id,
      before.revision,
      definition.title,
      html,
      before.defaults,
    );
    const framed = await canvases.state(1, written.id, written.stateRevision, written.revision, {
      cam_px: definition.center + 0.4,
      cam_py: -0.52,
      cam_pz: 0.52,
      cam_tx: definition.center,
      cam_ty: 0,
      cam_tz: 0.23,
    });
    if (before.robotCheck) {
      assert.deepEqual(framed.state.robotTask, before.state.robotTask);
      await canvases.checkRobot(
        1,
        framed.id,
        framed.revision,
        framed.stateRevision,
        before.robotCheck.sourceID,
        before.robotCheck.stateKey,
      );
    }
    await writeFile(path.join(root, definition.stage + '.provider.html'), before.html, {
      flag: 'wx',
    });
    await writeFile(path.join(root, definition.stage + '.presentation.html'), html, { flag: 'wx' });
    edits.push({
      ...definition,
      originalHTMLHash: digest(before.html),
      presentationHTMLHash: digest(html),
      unchangedModuleHash: moduleHash,
      originalRevision: before.revision,
      presentationRevision: framed.revision,
      changes: ['Static layout and styles', 'Control grouping and labels', 'Saved camera framing'],
      computations: 'Original provider scripts retained byte for byte',
    });
  }
  const stateFile = path.join(profile, 'viewer-state-v1.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const plane = (id: string, canvasID: string, title: string) => ({
    id,
    type: 'canvas' as const,
    canvasID,
    path: branch.canvas.path,
    title,
  });
  state.workspaces = [
    {
      id: 'explore',
      name: 'Explore the arm',
      panes: [plane('creation', creationID, 'Explore joints')],
      roots: ['creation'],
      activePane: 'creation',
      arrangement: {},
    },
    {
      id: 'targets',
      name: 'Check the targets',
      panes: [plane('refinement', refinement.canvas.id, 'Original base')],
      roots: ['refinement'],
      activePane: 'refinement',
      arrangement: {},
    },
    {
      id: 'compare',
      name: 'Compare base placements',
      panes: [
        plane('alternative', branch.canvas.id, 'Alternative base'),
        plane('original', refinement.canvas.id, 'Original base'),
        {
          id: 'conversation',
          type: 'chat',
          conversationID: branch.conversation.id,
          path: branch.canvas.path,
        },
      ],
      roots: ['alternative', 'original', 'conversation'],
      activePane: 'alternative',
      arrangement: {},
    },
  ];
  state.activeWorkspace = 'compare';
  state.openWindows = ['compare'];
  await writeFile(stateFile, JSON.stringify(state));
  const comparison = await canvases.robotComparison(1, branch.canvas.id);
  assert.equal(comparison.status, 'compared');
  await canvases.flush();
  assert.equal((await currentRobotSession(run, 'branch')).reviewToken, branch.reviewToken);
  assert.equal((await currentRobotSession(run, 'refine')).reviewToken, refinement.reviewToken);
  const manifest = { version: 1, run, root, profile, providerRequests: 0, edits, comparison };
  await saveEvidence(path.join(root, 'presentation.json'), manifest);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { run: { type: 'string' } } });
  if (!values.run)
    throw new Error('Pass --run <qualified robot rehearsal>. No provider is contacted.');
  const result = await prepareRobotPresentation(values.run);
  console.log(
    JSON.stringify({ root: result.root, profile: result.profile, providerRequests: 0 }, null, 2),
  );
}
