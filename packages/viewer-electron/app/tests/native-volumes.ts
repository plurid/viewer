// Native mount lifecycle regression. Owns exactly one generated disk image.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createFixtures } from './fixtures';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import { ownedApp, until } from './owned-app';
import type { Volume } from '../src/domain/volumes';
import type { ResourceRead } from '../src/domain/contracts';
type Entity = { 'mount-point'?: string; 'dev-entry': string };
type Attach = { 'system-entities': Entity[] };
type Inventory = { images: { 'image-path': string; 'system-entities': Entity[] }[] };

const binary = process.env.VIEWER_TEST_BINARY!,
  evidence = process.env.VIEWER_VOLUME_EVIDENCE!;
assert.ok(binary && evidence);
const fixture = await createFixtures(),
  id = randomUUID();
const qaRoot = await realpath(fixture.root);
const profile = path.join(qaRoot, 'volume-profile'),
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
function plist<T>(xml: string): T {
  return JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import plistlib,json,sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))',
      ],
      { input: xml, encoding: 'utf8', timeout: 5000 },
    ),
  ) as T;
}
let device = '',
  mounted = false,
  quit = false;
let app: Awaited<ReturnType<typeof ownedApp>> | undefined,
  connection: Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>> | undefined;
let busy: Awaited<ReturnType<typeof open>> | undefined;
const results: { scenario: string; result: string; details?: unknown }[] = [];
async function attach(readOnly = false) {
  const xml = await hdi([
    'attach',
    image,
    '-noautoopen',
    '-mountpoint',
    mount,
    '-plist',
    ...(readOnly ? ['-readonly'] : []),
  ]);
  mounted = true; // A failed ownership check must retain the fixture rather than delete a mount.
  const output = plist<Attach>(xml);
  const entity = output['system-entities'].find((e) => e['mount-point']);
  assert.ok(entity, 'Generated mount returned a mount point');
  const mountedPath = entity['mount-point'];
  assert.ok(mountedPath);
  assert.equal(await realpath(mountedPath), await realpath(mount));
  const ownedDevice =
    output['system-entities'].find((e) => /^\/dev\/disk\d+$/.test(e['dev-entry']))?.['dev-entry'] ||
    entity['dev-entry'].match(/^\/dev\/disk\d+/)?.[0];
  assert.ok(ownedDevice);
  device = ownedDevice;
  return await realpath(mount);
}
async function verifyOwnedDevice() {
  const info = plist<Inventory>(await hdi(['info', '-plist']));
  const entry = info.images.find((v) => v['image-path'] === image);
  assert.ok(entry, 'Only the generated image may be detached');
  assert.ok(entry['system-entities'].some((v) => v['dev-entry'] === device));
}
async function check(scenario: string, run: () => Promise<unknown>) {
  const details = await run();
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
  const root = await attach(),
    file = path.join(root, 'Generated volume.txt');
  await writeFile(file, 'Generated disposable volume content.\n', { mode: 0o600 });
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  const { evaluate } = connection;
  await until(
    () => evaluate('!!window.viewer && !!document.querySelector(".folder-explorer")'),
    Boolean,
    'Owned volume workspace',
  );
  const volumes = () => evaluate<Volume[]>('window.viewer.volumesList()');
  await check('Mounted generated image: inventory, capacity and writable state', async () => {
    const volume = await until(
      volumes,
      (items) => items.some((v) => v.path === root),
      'Mounted volume inventory',
    );
    const current = volume.find((v) => v.path === root)!;
    assert.ok(current.total > 0);
    assert.ok(current.available > 0 && current.available <= current.total);
    assert.equal(current.readOnly, false);
    assert.equal(current.ejectable, true);
    return current;
  });
  const unrelated = await evaluate<{ id: string }>(
    `window.viewer.resource(${JSON.stringify(path.join(fixture.files, 'README.md'))})`,
  );
  const baseline = await evaluate(`window.viewer.read(${JSON.stringify(unrelated.id)})`);
  busy = await open(file, 'r');
  await check('Busy eject fails visibly and preserves independent preview and mount', async () => {
    await verifyOwnedDevice();
    const result = await evaluate<{ success?: boolean; error?: string; code?: string }>(
      `window.viewer.volumeEject(${JSON.stringify(root)}).then(()=>({success:true}),error=>({error:error.message,code:error.code}))`,
    );
    assert.ok(result.error, 'An externally held descriptor prevents ordinary eject');
    assert.equal(result.code, 'EBUSY');
    assert.match(result.error, /disk is in use/i);
    assert.deepEqual(
      await evaluate(`window.viewer.read(${JSON.stringify(unrelated.id)})`),
      baseline,
    );
    assert.ok((await volumes()).some((v) => v.path === root));
    assert.match(await readFile(file, 'utf8'), /Generated/);
    return result;
  });
  await busy.close();
  busy = undefined;
  const volumeResource = await evaluate<{ id: string }>(
    `window.viewer.resource(${JSON.stringify(file)})`,
  );
  await evaluate(`window.viewer.watch(${JSON.stringify(root)},'generated-volume-watch')`);
  await check('Successful eject drains the owned watcher and preview', async () => {
    await verifyOwnedDevice();
    await evaluate(`window.viewer.volumeEject(${JSON.stringify(root)})`);
    await until(volumes, (items) => !items.some((v) => v.path === root), 'Ejected volume removed');
    mounted = false;
    const expired = await evaluate(
      `window.viewer.read(${JSON.stringify(volumeResource.id)}).then(()=>false,()=>true)`,
    );
    assert.equal(expired, true);
    assert.deepEqual(
      await evaluate(`window.viewer.read(${JSON.stringify(unrelated.id)})`),
      baseline,
    );
  });
  const restored = await attach(true);
  assert.equal(restored, root);
  await check('Read-only reconnect is rediscovered without restoring stale resources', async () => {
    const items = await until(
      volumes,
      (items) => items.some((v) => v.path === root),
      'Reconnected inventory',
    );
    const current = items.find((v) => v.path === root)!;
    assert.equal(current.readOnly, true);
    assert.ok(current.total > 0);
    assert.equal(
      await evaluate(
        `window.viewer.read(${JSON.stringify(volumeResource.id)}).then(()=>false,()=>true)`,
      ),
      true,
    );
    const next = await evaluate<ResourceRead>(
      `window.viewer.resource(${JSON.stringify(file)}).then(resource=>window.viewer.read(resource.id))`,
    );
    assert.match(next.text, /Generated/);
    return current;
  });
  await check('Read-only generated mount ejects cleanly', async () => {
    await verifyOwnedDevice();
    await evaluate(`window.viewer.volumeEject(${JSON.stringify(root)})`);
    await until(volumes, (items) => !items.some((v) => v.path === root), 'Final eject');
    mounted = false;
  });
  await evaluate(`window.viewer.release(${JSON.stringify(unrelated.id)})`);
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
        results,
        limitations: [
          'Direct packaged native runtime; not signed sandbox PowerBox evidence',
          'Generated local HFS+ disk image; physical/network/cloud provider acceptance remains pending',
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
  await busy?.close();
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
