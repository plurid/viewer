/** Real Cocoa claims and Worker cleanup; generated fixtures only. This does
 * not establish real cloud-provider hydration or signed picker authorization. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { FileCoordination } from '../src/desktop/file-coordination';
import { macFiles } from '../src/desktop/macos-files';

if (process.platform !== 'darwin') throw new Error('Native coordination requires macOS.');
const root = await mkdtemp('/private/tmp/viewer-coordination-native-');
const file = path.join(root, 'Generated.txt'),
  other = path.join(root, 'Independent.txt');
const coordination = new FileCoordination(macFiles, 10000);
const results: string[] = [];
let worker: Worker | undefined;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
try {
  await writeFile(file, 'Generated original');
  await writeFile(other, 'Independent');
  const reader = await coordination.acquire([{ path: file, mode: 'read' }]);
  let entered = false;
  const writer = coordination.run([{ path: file, mode: 'write' }], async () => {
    entered = true;
    await writeFile(coordination.path(file), 'Generated updated');
  });
  await delay(150);
  assert.equal(entered, false, 'A live read claim must block a competing writer.');
  await coordination.run([{ path: other, mode: 'write' }], async () => {
    await writeFile(coordination.path(other), 'Independent update');
  });
  results.push('Independent writer proceeds while another file has a read claim');
  await reader.release();
  await writer;
  assert.equal(await readFile(file, 'utf8'), 'Generated updated');
  results.push('Reader owns the lock until release; waiting writer proceeds afterward');

  const second = await coordination.acquire([{ path: file, mode: 'read' }]);
  const abort = new AbortController();
  let cancelledWork = false;
  const cancelled = coordination
    .run(
      [{ path: file, mode: 'write' }],
      async () => {
        cancelledWork = true;
      },
      abort.signal,
    )
    .then(
      () => false,
      () => true,
    );
  await delay(75);
  abort.abort();
  assert.equal(await cancelled, true);
  assert.equal(cancelledWork, false);
  await second.release();
  results.push('Cancel stops a blocked writer before its accessor runs');

  // Four parents can fill the root writer queue. Their private intermediate
  // claims must have a separate bounded queue to avoid waiting on themselves.
  const starts = Array.from({ length: 8 }, (_, i) => path.join(root, `Source-${i}`));
  await Promise.all(starts.map((source) => writeFile(source, 'Generated')));
  await Promise.all(
    starts.map((source) =>
      coordination.run(
        [
          { path: source, mode: 'move' },
          { path: source + '-destination', mode: 'write' },
        ],
        async () => {
          await coordination.run(
            [
              { path: source, mode: 'move' },
              { path: source + '-intermediate', mode: 'write' },
            ],
            async () => {
              await macFiles().renameExclusive(
                coordination.path(source),
                coordination.path(source + '-intermediate'),
                coordination.purpose(),
              );
            },
          );
        },
      ),
    ),
  );
  for (const source of starts)
    assert.equal(await readFile(source + '-intermediate', 'utf8'), 'Generated');
  results.push(
    'Eight concurrent parent/intermediate claims complete without starving root writers',
  );

  const unicode = path.join(root, 'Résumé.txt'),
    temporary = path.join(root, '.generated-rename'),
    destination = path.join(root, 'résumé.txt');
  await writeFile(unicode, 'Generated Unicode');
  for (const [from, to] of [
    [unicode, temporary],
    [temporary, destination],
  ]) {
    await coordination.run(
      [
        { path: from, mode: 'move' },
        { path: to, mode: 'write' },
      ],
      async () => {
        await macFiles().renameExclusive(
          coordination.path(from),
          coordination.path(to),
          coordination.purpose(),
        );
      },
    );
  }
  assert.equal(await readFile(destination, 'utf8'), 'Generated Unicode');
  await assert.rejects(lstat(temporary), { code: 'ENOENT' });
  results.push('Existing and new decomposed Unicode aliases preserve a case-only rename');

  worker = new Worker(
    `
    const {workerData,parentPort}=require('node:worker_threads');
    const native=require(workerData.addon);
    native.coordinateStart('generated-worker-reader',[{path:workerData.file,mode:'read'}],'generated-worker-purpose')
      .then(()=>parentPort.postMessage('ready'),error=>{throw error});
  `,
    { eval: true, workerData: { file, addon: path.resolve('assets/viewer-macos-files.node') } },
  );
  await new Promise<void>((resolve, reject) => {
    worker!.once('error', reject);
    worker!.once('message', () => resolve());
  });
  let afterWorker = false;
  const queued = coordination.run([{ path: file, mode: 'write' }], async () => {
    afterWorker = true;
  });
  await delay(100);
  assert.equal(afterWorker, false);
  await worker.terminate();
  worker = undefined;
  await queued;
  assert.equal(afterWorker, true);
  results.push(
    'Worker termination releases its live native claim before an independent writer continues',
  );

  for (let i = 0; i < 100; i++)
    await coordination.run([{ path: file, mode: 'read' }], async () => {
      assert.equal(await readFile(coordination.path(file), 'utf8'), 'Generated updated');
    });
  await coordination.close();
  results.push('100 repeated claims dispose and coordination closes');
  const evidence = { completed: true, platform: process.platform, results };
  if (process.env.VIEWER_COORDINATION_EVIDENCE)
    await writeFile(
      process.env.VIEWER_COORDINATION_EVIDENCE,
      JSON.stringify(evidence, null, 2) + '\n',
    );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await worker?.terminate();
  await coordination.close();
  await rm(root, { recursive: true, force: true });
}
