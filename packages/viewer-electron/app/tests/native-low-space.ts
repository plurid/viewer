/** Native space exhaustion and receipt restart. Owns every file and mounted image. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createFixtures } from './fixtures';
import { ownedApp, until } from './owned-app';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import type { OperationJob, OperationRequest } from '../src/domain/contracts';

const binary = process.env.VIEWER_TEST_BINARY!,
  evidence = process.env.VIEWER_LOW_SPACE_EVIDENCE!;
assert.ok(binary && evidence);
const fixture = await createFixtures(),
  qaRoot = await realpath(fixture.root),
  id = randomUUID();
const profile = path.join(qaRoot, 'low-space-profile'),
  image = path.join(qaRoot, 'Generated-' + id + '.dmg'),
  mount = path.join(qaRoot, 'generated-mount');
await Promise.all([mkdir(profile), mkdir(mount)]);
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(fixture.state));
await writeFile(
  path.join(profile, 'settings-v1.json'),
  JSON.stringify({
    version: 1,
    revision: 0,
    settings: defaultSettings(fixture.files),
    ui: normalizePreferences(fixture.state.ui),
  }),
);
const run = promisify(execFile);
async function hdi(args: string[]) {
  return (await run('/usr/bin/hdiutil', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout;
}
function plist(xml: string) {
  return JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import plistlib,json,sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))',
      ],
      { input: xml, encoding: 'utf8', timeout: 5000 },
    ),
  );
}
let device = '',
  mounted = false,
  quit = false;
let app: Awaited<ReturnType<typeof ownedApp>> | undefined,
  connection: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>> | undefined;
const results: { scenario: string; result: string; details?: unknown }[] = [];
async function verifyOwnedDevice() {
  const info = plist(await hdi(['info', '-plist']));
  const entry = info.images.find((v: { 'image-path': string }) => v['image-path'] === image);
  assert.ok(entry, 'Only the generated image may be detached');
  assert.ok(
    entry['system-entities'].some((v: { 'dev-entry': string }) => v['dev-entry'] === device),
  );
}
async function writeSized(file: string, bytes: number) {
  const handle = await open(file, 'wx', 0o600),
    buffer = Buffer.alloc(256 * 1024, 0x5d);
  try {
    let total = 0;
    while (total < bytes) {
      const result = await handle.write(buffer, 0, Math.min(buffer.length, bytes - total), null);
      assert.ok(result.bytesWritten);
      total += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
async function check(scenario: string, work: () => Promise<unknown>) {
  const details = await work();
  results.push({ scenario, result: 'passed', details });
  console.log(scenario + ': passed');
}
try {
  await hdi([
    'create',
    '-size',
    '64m',
    '-fs',
    'HFS+',
    '-type',
    'UDIF',
    '-nospotlight',
    '-volname',
    'Viewer-QA-' + id,
    image,
  ]);
  const attached = plist(
    await hdi(['attach', image, '-noautoopen', '-mountpoint', mount, '-plist']),
  );
  const entities = attached['system-entities'] as { 'mount-point'?: string; 'dev-entry': string }[];
  const entity = entities.find((e) => e['mount-point']);
  assert.ok(entity);
  assert.equal(await realpath(entity['mount-point']!), await realpath(mount));
  device =
    entities.find((e) => /^\/dev\/disk\d+$/.test(e['dev-entry']))?.['dev-entry'] ||
    entity['dev-entry'].match(/^\/dev\/disk\d+/)?.[0] ||
    '';
  assert.ok(device);
  mounted = true;
  const root = await realpath(mount),
    freeBefore = await statfs(root),
    filler = path.join(root, 'Generated filler.bin');
  const available = freeBefore.bavail * freeBefore.bsize;
  assert.ok(available > 8 * 1024 * 1024);
  await writeSized(filler, available - 2 * 1024 * 1024);
  const constrained = await statfs(root),
    free = constrained.bavail * constrained.bsize;
  assert.ok(
    free > 256 * 1024 && free < 4 * 1024 * 1024,
    'Only the generated mounted image is space-constrained',
  );
  const source = path.join(qaRoot, 'Generated transfer.bin');
  await writeSized(source, 16 * 1024 * 1024);
  const sourceHash = await hash(source);
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  const { evaluate } = connection;
  await until(
    () => evaluate('!!window.viewer && !!document.querySelector(".folder-explorer")'),
    Boolean,
    'Owned low-space workspace',
  );
  async function operate(request: OperationRequest) {
    const id = await evaluate<string>(`window.viewer.operate(${JSON.stringify(request)})`);
    const jobs = await until(
      () => evaluate<OperationJob[]>('window.viewer.jobs()'),
      (jobs) =>
        jobs.some(
          (job) => job.id === id && ['completed', 'failed', 'cancelled'].includes(job.status),
        ),
      request.kind + ' terminal status',
    );
    return jobs.find((job) => job.id === id)!;
  }
  for (const kind of ['copy', 'move'] as const) {
    await check(
      'Native low-space ' + kind + ' preserves source and removes private partial output',
      async () => {
        const job = await operate({ kind, sources: [source], destination: root });
        assert.equal(job.status, 'failed');
        assert.equal(job.completed.length, 0);
        assert.equal(job.undoable, false);
        assert.match(job.errors.map((e) => e.message).join('\n'), /ENOSPC|space/i);
        assert.equal(await hash(source), sourceHash);
        assert.ok(
          !(await readdir(root)).some(
            (name) => name === path.basename(source) || name.startsWith('.viewer-transfer-'),
          ),
          'No published or staged partial transfer survives',
        );
        return {
          kind,
          status: job.status,
          error: job.errors[0]?.message,
          bytesDone: job.bytesDone,
          sourceSha256: sourceHash,
        };
      },
    );
  }
  await check('Operation queue remains usable after disk-space failures', async () => {
    const job = await operate({
      kind: 'mkdir',
      sources: [],
      destination: qaRoot,
      name: 'Generated recovery folder',
    });
    assert.equal(job.status, 'completed');
    assert.equal(job.errors.length, 0);
    return { status: job.status };
  });
  const before = await evaluate<OperationJob[]>('window.viewer.jobs()');
  await app.close(connection);
  quit = true;
  app = await ownedApp(binary, profile);
  quit = false;
  connection = await app.connect();
  await until(
    () => connection!.evaluate('!!window.viewer && !!document.querySelector(".folder-explorer")'),
    Boolean,
    'Cold low-space workspace ready',
  );
  await check(
    'Known disk-space failures retain their status and error count after cold relaunch',
    async () => {
      const restored = await connection!.evaluate<OperationJob[]>('window.viewer.jobs()');
      for (const job of before) {
        const current = restored.find((item) => item.id === job.id);
        assert.ok(current);
        assert.equal(current.status, job.status);
        assert.equal(current.errorCount, job.errorCount);
        assert.deepEqual(current.errors, job.errors);
        assert.equal(current.undoable, job.undoable);
      }
      assert.equal(await hash(source), sourceHash);
      return { jobs: before.length, unchangedInputSha256: sourceHash };
    },
  );
  await app.close(connection);
  quit = true;
  await writeFile(
    evidence,
    JSON.stringify(
      {
        version: 1,
        candidate: binary,
        channel: 'direct',
        completed: true,
        availableBefore: available,
        availableConstrained: free,
        results,
        limitations: [
          'Direct packaged native runtime; not signed sandbox or genuine PowerBox evidence',
          'Generated local HFS+ space exhaustion; physical/provider disconnection and low-space system/profile writes remain pending',
        ],
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  await writeFile(
    evidence,
    JSON.stringify(
      {
        version: 1,
        candidate: binary,
        completed: false,
        results,
        error: String(error),
        ownedDevice: device,
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  try {
    if (app && !quit) await app.close(connection);
  } finally {
    if (mounted) {
      await verifyOwnedDevice();
      await hdi(['detach', device]);
      mounted = false;
    }
    if (!mounted) await rm(fixture.root, { recursive: true, force: true });
  }
}
