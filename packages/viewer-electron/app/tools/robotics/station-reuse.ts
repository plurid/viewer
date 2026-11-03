/** Reuse an exported plugin in an interrupted run without replacing its request ledger. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Canvases } from '../../src/desktop/canvases/service';
import { canvasAssetFile, canvasDocumentSchema } from '../../src/domain/canvases/document';
import { stationAuthorization } from './station-authorization';
import { RobotRehearsalLedger, digest, readRobotSessionResult, saveEvidence } from './rehearsal';
import { stationPrompts } from './station-contract';

const { values } = parseArgs({
  options: { run: { type: 'string' }, plugin: { type: 'string' }, instruction: { type: 'string' } },
});
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(values.run && values.plugin && values.instruction);
const root = await realpath(values.run);
const folder = await realpath(values.plugin);
const grant = await stationAuthorization(root);
const sessions = await new RobotRehearsalLedger(root).sessions();
assert.equal(sessions.length, 1, 'Reuse before continuing the interrupted creation stage.');
const result = (await readRobotSessionResult(sessions[0]!)) as { status: string };
assert.ok(['failed', 'stopped'].includes(result.status));
const used = (await readdir(sessions[0]!)).filter((name) =>
  /^request-\d{2}\.json$/.test(name),
).length;
assert.ok(used < grant.requestsPerSession, 'This session has no requests left.');
const plan = JSON.parse(await readFile(path.join(root, 'plan.json'), 'utf8')) as {
  canvasID: string;
};
const plugin = canvasDocumentSchema.parse(
  JSON.parse(await readFile(path.join(folder, 'canvas.viewer.json'), 'utf8')),
);
const library = plugin.assets.find((asset) => asset.name === 'robotics.js');
assert.ok(library);
const libraryPath = await realpath(path.join(folder, canvasAssetFile(library)));
assert.ok(libraryPath.startsWith(folder + path.sep));
const bytes = await readFile(libraryPath);
assert.equal(bytes.length, library.bytes);
assert.equal(digest(bytes), library.hash);
const service = new Canvases(path.join(root, 'Profile'), { changed() {} });
const before = await service.read(1, plan.canvasID);
assert.ok(!before.assets.some((asset) => asset.name === library.name));
for (const asset of plugin.assets.filter((asset) => asset.id !== library.id))
  assert.ok(
    before.assets.some((current) => current.name === asset.name && current.hash === asset.hash),
  );
assert.deepEqual(
  before.sources.map((s) => s.hash).sort(),
  plugin.sources.map((s) => s.hash).sort(),
);
const evidence = path.join(root, 'reused-plugin');
await mkdir(evidence, { mode: 0o700 });
await saveEvidence(path.join(evidence, 'before.json'), before);
await service.attach(
  1,
  before.id,
  library.name,
  bytes,
  undefined,
  'Reused existing robotics plugin; operator-supplied starting code.',
);
const attached = await service.read(1, before.id);
let starter = await service.write(
  1,
  before.id,
  attached.revision,
  plugin.title,
  plugin.html,
  plugin.defaults,
);
const camera = before.state.camera;
if (
  camera &&
  typeof camera === 'object' &&
  !Array.isArray(camera) &&
  Array.isArray(camera.pos) &&
  Array.isArray(camera.tgt)
)
  starter = await service.state(1, before.id, starter.stateRevision, starter.revision, {
    camera: { position: camera.pos, target: camera.tgt },
  });
await service.flush();
await saveEvidence(path.join(evidence, 'starter.json'), starter);
await saveEvidence(path.join(evidence, 'provenance.json'), {
  instruction: values.instruction,
  source: folder,
  htmlHash: digest(plugin.html),
  libraryHash: library.hash,
  previousRevision: before.revision,
  startingRevision: starter.revision,
  requestsAlreadyUsed: used,
  remainingInSession: grant.requestsPerSession - used,
  authorship:
    'Existing implementation supplied by the operator at the user’s request. Only subsequent edits are Meta output.',
  providerRequests: 0,
});
const guidance = `The user corrected the earlier blank-scaffold request: reuse the working plugin and extend it. The existing parser, solver and checker now live in the explicitly attached robotics.js asset, imported by the current HTML. This supplied starting code is not your output. The current canvas and source snapshots are already in context. Do not rebind sources or read files again. Preserve the attached library and its imports, actions, controls, state keys and mesh rendering. Never write state from rendering or a subscription. Only add the requested interface change, then use the existing actions. Keep the current revision and stateRevision from each tool result for the next call.`;
await writeFile(
  path.join(evidence, 'resume.txt'),
  `${guidance}\n\nAdd a compact per-target results table for the selected mounting point, showing target name, measured residual in mm and whether it meets the tolerance. Derive the table from state.study, and let its rows select the corresponding target in the viewport. Keep the rest of the existing interface. You have ${grant.requestsPerSession - used} provider requests remaining in this session. Use them as: (1) canvas_write with the complete revised HTML; (2) canvas_invoke evaluate with reserved=false,targetOffsetX=0; (3) canvas_invoke select with the least-movement eligible candidate returned; (4) a concise final answer based on those results. The external reviewer will call selfTest and inspectPose afterward, so keep those existing handlers. No separate selfTest invocation is needed in this continuation.\n`,
  { flag: 'wx', mode: 0o600 },
);
for (const stage of ['refine', 'branch'] as const)
  await writeFile(
    path.join(evidence, stage + '-guidance.txt'),
    `${guidance}\n\n${stationPrompts[stage]}\nRefer to the calculations as the plugin's calculations; they were reused, not generated in this request.\n`,
    { flag: 'wx', mode: 0o600 },
  );
assert.deepEqual(await stationAuthorization(root), grant);
console.log(
  JSON.stringify({
    root,
    evidence,
    revision: starter.revision,
    requestsAlreadyUsed: used,
    providerRequests: 0,
  }),
);
