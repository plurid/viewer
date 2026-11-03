import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Canvases } from '../../../src/desktop/canvases/service';
import { inspectFile } from '../../../src/desktop/files/inspection';
import { buildRoboticsPlugin } from './build';
import { loadCanvasLibraries } from '../../canvas-libraries';
import { temporaryRoot } from '../../temporary';
import { digest, saveEvidence } from '../../robotics/rehearsal';

const { values } = parseArgs({ options: { corpus: { type: 'string' } } });
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(values.corpus, 'Choose the retained SO-101 corpus.');
const corpus = await realpath(values.corpus);
const root = await realpath(await temporaryRoot('viewer-robotics-plugin-'));
const manifest = JSON.parse(
  await readFile(
    new URL('../../../tests/fixtures/robotics/so101/manifest.json', import.meta.url),
    'utf8',
  ),
) as { files: { path: string; sha256: string; bytes: number }[] };
const libraries = await loadCanvasLibraries();
const service = new Canvases(path.join(root, 'Profile'), {
  changed() {},
  libraries: () => libraries,
});
const original = await service.create(1, randomUUID(), corpus);
const built = await buildRoboticsPlugin();
await service.attach(
  1,
  original.id,
  'robotics.js',
  Buffer.from(built.library),
  undefined,
  'Existing Viewer robotics implementation extracted into an optional plugin, not generated in this run.',
);
for (const file of manifest.files.filter((file) => file.path.endsWith('.stl'))) {
  const full = await realpath(path.join(corpus, file.path));
  assert.ok(full.startsWith(corpus + path.sep));
  const bytes = await readFile(full);
  assert.equal(bytes.length, file.bytes);
  assert.equal(digest(bytes), file.sha256);
  await service.attach(1, original.id, path.basename(full), bytes, full, 'Pinned SO-ARM100 source');
}
for (const file of ['Simulation/SO101/so101_new_calib.urdf', 'station.json']) {
  const doc = await service.read(1, original.id);
  const source = await service.source(
    1,
    doc.id,
    doc.revision,
    await inspectFile(path.join(corpus, file), { content: true }),
  );
  assert.equal(source.source.data.coverage.content, 'complete');
  assert.ok(!('robot' in source.source.data));
}
const current = await service.read(1, original.id);
const document = await service.write(
  1,
  current.id,
  current.revision,
  'Robotics workbench',
  built.html,
  { reserved: false, targetOffsetX: 0, ui: { targetIndex: 0 } },
);
const destination = path.join(root, 'Export');
await mkdir(destination);
const exported = await service.export(1, document.id, destination);
await service.flush();
await writeFile(
  path.join(exported, 'SO-101-LICENSE'),
  await readFile(new URL('../../../tests/fixtures/robotics/so101/LICENSE', import.meta.url)),
  { flag: 'wx' },
);
const require = createRequire(import.meta.url);
const notices = await Promise.all(
  ['zod', 'three'].map(async (name) => {
    const directory =
      name === 'three'
        ? path.dirname(path.dirname(require.resolve('three')))
        : path.dirname(require.resolve('zod/package.json'));
    return name + '\n\n' + (await readFile(path.join(directory, 'LICENSE'), 'utf8'));
  }),
);
await writeFile(path.join(exported, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'), {
  flag: 'wx',
});
await saveEvidence(path.join(root, 'package.json'), {
  status: 'built',
  exported,
  canvasID: document.id,
  htmlHash: digest(built.html),
  libraryHash: digest(built.library),
  authorship: 'Existing implementation packaged locally; no Meta generation claimed.',
  modules: built.modules,
  providerRequests: 0,
});
console.log(JSON.stringify({ root, exported, providerRequests: 0 }));
