/** The production operation engine and real helper on a generated exFAT volume.
 * Unmounting is the only cleanup. The disk image, profile and all inputs remain retained. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { OperationJob, OperationRequest } from '../../src/domain/contracts';
import { setAssetRoot } from '../../src/desktop/native/assets';
import { macFiles } from '../../src/desktop/native/macos-files';
import { fileCoordination } from '../../src/desktop/files/file-coordination';
import { Operations } from '../../src/desktop/operations/operations';
import { temporaryRoot } from '../../tools/temporary';

interface Entity {
  'mount-point'?: string;
  'dev-entry': string;
}
interface Attached {
  'system-entities': Entity[];
}
interface Inventory {
  images: { 'image-path': string; 'system-entities': Entity[] }[];
}
interface Result {
  action: string;
  job: OperationJob;
}

assert.equal(process.platform, 'darwin');
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binding = path.resolve(
  process.env.VIEWER_TEST_MAC_BINDING ?? path.join(appRoot, 'assets/viewer-macos-files.node'),
);
const root = await realpath(await temporaryRoot('viewer-exfat-native-'));
const image = path.join(root, 'Generated exFAT.dmg');
const mount = path.join(root, 'Volume');
const assets = path.join(root, 'assets');
await mkdir(assets);
await copyFile(binding, path.join(assets, 'viewer-macos-files.node'), constants.COPYFILE_EXCL);
setAssetRoot(false, root);
const bindingSHA256 = createHash('sha256')
  .update(await readFile(binding))
  .digest('hex');
const run = promisify(execFile);
const hdi = async (args: string[]) =>
  (await run('/usr/bin/hdiutil', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout;
function plist<T>(xml: string): T {
  return JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: xml,
      encoding: 'utf8',
      timeout: 5000,
    }),
  ) as T;
}

let attachAttempted = false;
let unmounted = false;
let failure: unknown;
const results: Result[] = [];
const operations = new Operations(
  async () => {
    throw new Error('This preserved scenario must never invoke the Trash.');
  },
  () => {},
  undefined,
  undefined,
  undefined,
  path.join(root, 'Profile'),
);
async function completed(action: string, id: string): Promise<void> {
  await operations.drained();
  const job = operations.all().find((job) => job.id === id)!;
  results.push({ action, job });
  assert.equal(job.status, 'completed', JSON.stringify(job));
  assert.equal(job.errorCount, 0, JSON.stringify(job.errors));
  console.log(action + ': passed');
}
async function operate(action: string, request: OperationRequest): Promise<void> {
  await completed(action, operations.start(request));
}

try {
  await mkdir(mount);
  await hdi([
    'create',
    '-size',
    '64m',
    '-fs',
    'ExFAT',
    '-layout',
    'MBRSPUD',
    '-type',
    'UDIF',
    '-nospotlight',
    '-volname',
    'ViewerQA',
    image,
  ]);
  attachAttempted = true;
  const attached = plist<Attached>(
    await hdi(['attach', image, '-noautoopen', '-mountpoint', mount, '-plist']),
  );
  const mounted = attached['system-entities'].find((entity) => entity['mount-point']);
  assert.ok(mounted?.['mount-point']);
  assert.equal(await realpath(mounted['mount-point']), await realpath(mount));
  const disk = plist<{ FilesystemType: string }>(
    (await run('/usr/sbin/diskutil', ['info', '-plist', mount])).stdout,
  );
  assert.equal(disk.FilesystemType.toLowerCase(), 'exfat');

  const probe = path.join(mount, 'Exclusive rename probe.txt');
  const probeTarget = path.join(mount, 'Unsupported probe output.txt');
  await writeFile(probe, 'Retained unsupported-rename probe.', { flag: 'wx' });
  await assert.rejects(macFiles().renameExclusive(probe, probeTarget), (error: unknown) =>
    ['ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? ''),
  );
  await assert.rejects(lstat(probeTarget), { code: 'ENOENT' });

  const inputs = path.join(root, 'Inputs');
  const copied = path.join(mount, 'Copies');
  const incoming = path.join(mount, 'Incoming');
  const moved = path.join(mount, 'Moved');
  for (const folder of [inputs, copied, incoming, moved]) await mkdir(folder);
  const note = path.join(inputs, 'Notes.txt');
  const folder = path.join(inputs, 'Photos');
  await writeFile(note, 'Complete exFAT copy.', { flag: 'wx' });
  await mkdir(folder);
  await writeFile(path.join(folder, 'Nested.txt'), 'Complete folder copy.', { flag: 'wx' });
  await operate('copy file and folder onto exFAT', {
    kind: 'copy',
    sources: [note, folder],
    destination: copied,
  });
  assert.equal(await readFile(path.join(copied, 'Notes.txt'), 'utf8'), 'Complete exFAT copy.');
  assert.equal(
    await readFile(path.join(copied, 'Photos/Nested.txt'), 'utf8'),
    'Complete folder copy.',
  );

  // createImage is the desktop picture-paste entry point. The scenario leaves the OS clipboard alone.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=',
    'base64',
  );
  await completed('paste a picture onto exFAT', operations.createImage(copied, png));
  assert.deepEqual(await readFile(path.join(copied, 'Pasted image.png')), png);

  // A move across disks removes its original and is blocked by preservation. Same-disk moves
  // exercise the rename path without asking validation to remove any input.
  const moveSource = path.join(incoming, 'Move.txt');
  await writeFile(moveSource, 'Complete exFAT move.', { flag: 'wx' });
  await operate('move within exFAT', { kind: 'move', sources: [moveSource], destination: moved });
  const movedFile = path.join(moved, 'Move.txt');
  assert.equal(await readFile(movedFile, 'utf8'), 'Complete exFAT move.');
  await assert.rejects(lstat(moveSource), { code: 'ENOENT' });
  await operate('rename on exFAT', { kind: 'rename', sources: [movedFile], name: 'Renamed.txt' });
  assert.equal(await readFile(path.join(moved, 'Renamed.txt'), 'utf8'), 'Complete exFAT move.');
  await assert.rejects(lstat(movedFile), { code: 'ENOENT' });
  assert.equal(await readFile(note, 'utf8'), 'Complete exFAT copy.');
  for (const name of (await readdir(copied)).filter((name) => name.startsWith('.viewer-')))
    assert.deepEqual(await readdir(path.join(copied, name)), []);
} catch (error) {
  failure = error;
} finally {
  try {
    await operations.close();
  } catch (error) {
    failure ??= error;
  }
  try {
    await fileCoordination.close();
  } catch (error) {
    failure ??= error;
  }
  if (attachAttempted) {
    try {
      const inventory = plist<Inventory>(await hdi(['info', '-plist']));
      const owned = inventory.images.find((entry) => entry['image-path'] === image);
      if (owned) {
        const device = owned['system-entities'].find((entity) =>
          /^\/dev\/disk\d+$/.test(entity['dev-entry']),
        );
        assert.ok(device, 'Only the generated image device may be detached.');
        await hdi(['detach', device['dev-entry']]);
      }
      unmounted = true;
    } catch (error) {
      console.error('Could not unmount the generated image; it was preserved:', image, error);
      failure ??= error;
    }
  }
}
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify(
    {
      passed: !failure,
      bindingSHA256,
      results,
      unmounted,
      error: failure ? String(failure) : undefined,
      limitations: [
        'Picture-paste engine, without the OS clipboard or UI.',
        'Same-volume move; cross-volume source removal is disabled.',
        'Not signed Store sandbox acceptance.',
      ],
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ passed: !failure, root, unmounted }));
if (failure) throw failure;
