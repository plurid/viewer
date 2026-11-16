/** The production operation engine and real helper on generated exFAT and FAT32 volumes.
 * Unmounting is the only cleanup. The disk image, profile and all inputs remain retained. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { OperationJob, OperationRequest } from '../../src/domain/contracts';
import type { NativeRenameRecovery } from '../../src/desktop/native/macos-files';
import { disposeRenameRecovery } from '../../src/desktop/operations/removal';
import { itemIdentity, nativeItemIdentity } from '../../src/domain/files/item-identity';
import { setAssetRoot } from '../../src/desktop/native/assets';
import { macFiles } from '../../src/desktop/native/macos-files';
import { fileCoordination } from '../../src/desktop/files/file-coordination';
import { readText } from '../../src/desktop/editing/text-files';
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
type ScenarioFilesystem = 'ExFAT' | 'MS-DOS FAT32';
async function scenario(filesystem: ScenarioFilesystem): Promise<void> {
  const root = await realpath(
    await temporaryRoot(filesystem === 'ExFAT' ? 'viewer-exfat-native-' : 'viewer-fat32-native-'),
  );
  const image = path.join(
    root,
    filesystem === 'ExFAT' ? 'Generated exFAT.dmg' : 'Generated FAT32.dmg',
  );
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
  const collisions: OperationJob[] = [];
  let recovery:
    { native: NativeRenameRecovery; notes: string[]; adapterPaths: string[] } | undefined;
  const retainedTrash = path.join(mount, 'Retained Trash');
  let trashIndex = 0;
  const operations = new Operations(
    async (file) => {
      const info = await lstat(file);
      const target = path.join(retainedTrash, 'Retained ' + ++trashIndex);
      await rename(file, target);
      return { path: target, directory: info.isDirectory() };
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

  async function waitCollision(id: string): Promise<OperationJob> {
    let job: OperationJob | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      job = operations.all().find((item) => item.id === id);
      if (job && !['queued', 'running'].includes(job.status)) break;
      await setTimeout(25);
    }
    assert.equal(job?.status, 'collision', JSON.stringify(job));
    collisions.push(job!);
    return job!;
  }
  async function collision(action: string, request: OperationRequest): Promise<void> {
    const id = operations.start(request);
    await waitCollision(id);
    operations.resolve(id, 'skip', false);
    await completed(action, id);
  }

  const lifetimes: Record<string, unknown> = {};
  async function identities(files: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [file, itemIdentity(await lstat(file, { bigint: true }))]),
      ),
    );
  }
  async function temporalFlows(
    incoming: string,
    copied: string,
    moved: string,
    device: string,
  ): Promise<void> {
    const text = path.join(incoming, 'Empty text.txt');
    await writeFile(text, '', { flag: 'wx' });
    const read = await readText(text);
    const empty = path.join(incoming, 'New empty.txt');
    const emptyJob = await operations.writeText(empty, '');
    assert.equal(emptyJob.status, 'completed', JSON.stringify(emptyJob));
    const moveSource = path.join(incoming, 'Move empty.txt');
    await writeFile(moveSource, '', { flag: 'wx' });
    const moveID = operations.start({ kind: 'move', sources: [moveSource], destination: moved });
    await completed('prepare empty move for delayed Undo', moveID);
    const folder = path.join(incoming, 'Empty child folder');
    await mkdir(folder);
    await writeFile(path.join(folder, 'Empty.txt'), '', { flag: 'wx' });
    const folderID = operations.start({ kind: 'copy', sources: [folder], destination: copied });
    await completed('prepare folder copy for delayed Undo', folderID);
    const replacement = path.join(incoming, 'Replace empty.txt');
    const replaced = path.join(copied, 'Replace empty.txt');
    await writeFile(replacement, 'Complete replacement.', { flag: 'wx' });
    await writeFile(replaced, '', { flag: 'wx' });
    const replaceID = operations.start({
      kind: 'copy',
      sources: [replacement],
      destination: copied,
    });
    await waitCollision(replaceID);
    const watched = [
      text,
      empty,
      path.join(moved, 'Move empty.txt'),
      path.join(copied, 'Empty child folder/Empty.txt'),
      replaced,
    ];
    const before = await identities(watched);
    console.log(filesystem + ': waiting 15 seconds for untouched synthetic inodes');
    await setTimeout(15000);
    const after = await identities(watched);
    lifetimes.pause = {
      milliseconds: 15000,
      before,
      after,
      changed: watched.filter((file) => before[file] !== after[file]),
    };
    operations.resolve(replaceID, 'replace', false);
    await completed('Replace after delayed empty-file collision', replaceID);
    const { sha256, ...version } = read.version;
    const saved = await operations.writeText(text, 'Saved after the pause.', { version, sha256 });
    assert.equal(saved.status, 'completed', JSON.stringify(saved));
    assert.equal(await readFile(text, 'utf8'), 'Saved after the pause.');
    await operations.undo(emptyJob.id);
    await assert.rejects(lstat(empty), { code: 'ENOENT' });
    await operations.undo(moveID);
    assert.equal((await lstat(moveSource)).size, 0);
    await operations.undo(folderID);
    await assert.rejects(lstat(path.join(copied, 'Empty child folder')), { code: 'ENOENT' });
    console.log(
      filesystem +
        ': delayed text save, empty-file Undo, move Undo, folder Undo and Replace passed',
    );

    // Preservation stops source removal, after the real cross-volume fingerprint validation.
    const outside = path.join(root, 'Cross-volume output');
    await mkdir(outside);
    const crossID = operations.start({ kind: 'move', sources: [folder], destination: outside });
    await operations.drained();
    const cross = operations.all().find((job) => job.id === crossID)!;
    assert.equal(cross.status, 'failed', JSON.stringify(cross));
    assert.ok(cross.errors.some((error) => error.message.includes('Validation must preserve')));
    assert.ok(cross.errors.every((error) => !error.message.includes('Source changed')));
    assert.equal((await lstat(path.join(outside, 'Empty child folder/Empty.txt'))).size, 0);
    assert.equal((await lstat(path.join(folder, 'Empty.txt'))).size, 0);
    lifetimes.crossVolume = cross;

    if (filesystem !== 'ExFAT') return;
    const remountSource = path.join(incoming, 'Remount source.txt');
    await writeFile(remountSource, 'Complete remount content.', { flag: 'wx' });
    const copyID = operations.start({
      kind: 'copy',
      sources: [remountSource],
      destination: copied,
    });
    await completed('prepare file copy for remount Undo', copyID);
    const remountMove = path.join(incoming, 'Remount move.txt');
    await writeFile(remountMove, 'Complete moved content.', { flag: 'wx' });
    const remountMoveID = operations.start({
      kind: 'move',
      sources: [remountMove],
      destination: moved,
    });
    await completed('prepare file move for remount Undo', remountMoveID);
    const paths = [path.join(copied, 'Remount source.txt'), path.join(moved, 'Remount move.txt')];
    const previous = await identities(paths);
    await run('/usr/sbin/diskutil', ['unmount', mount], { timeout: 45000 });
    await mkdir(mount, { recursive: true });
    await run('/usr/sbin/diskutil', ['mount', '-mountPoint', mount, device], { timeout: 45000 });
    const current = await identities(paths);
    lifetimes.remount = { before: previous, after: current };
    await operations.undo(copyID);
    await operations.undo(remountMoveID);
    assert.equal(await readFile(remountMove, 'utf8'), 'Complete moved content.');
    await assert.rejects(lstat(paths[0]!), { code: 'ENOENT' });
    console.log('exFAT: copy and move Undo after remount passed');
  }

  try {
    await mkdir(mount);
    await hdi([
      'create',
      '-size',
      '64m',
      '-fs',
      filesystem,
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
    assert.equal(disk.FilesystemType.toLowerCase(), filesystem === 'ExFAT' ? 'exfat' : 'msdos');
    await mkdir(retainedTrash);

    const probe = path.join(mount, 'Exclusive rename probe.txt');
    const probeTarget = path.join(mount, 'Unsupported probe output.txt');
    await writeFile(probe, 'Retained unsupported-rename probe.', { flag: 'wx' });
    if (filesystem === 'ExFAT') {
      await assert.rejects(macFiles().renameExclusive(probe, probeTarget), (error: unknown) =>
        ['ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? ''),
      );
      await assert.rejects(lstat(probeTarget), { code: 'ENOENT' });
    } else {
      await macFiles().renameExclusive(probe, probeTarget);
      assert.equal(await readFile(probeTarget, 'utf8'), 'Retained unsupported-rename probe.');
    }

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
    await operate(`copy file and folder onto ${filesystem}`, {
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
    await completed(`paste a picture onto ${filesystem}`, operations.createImage(copied, png));
    assert.deepEqual(await readFile(path.join(copied, 'Pasted image.png')), png);

    // A move across disks removes its original and is blocked by preservation. Same-disk moves
    // exercise the rename path without asking validation to remove any input.
    const moveSource = path.join(incoming, 'Move.txt');
    await writeFile(moveSource, 'Complete exFAT move.', { flag: 'wx' });
    await operate(`move within ${filesystem}`, {
      kind: 'move',
      sources: [moveSource],
      destination: moved,
    });
    const movedFile = path.join(moved, 'Move.txt');
    assert.equal(await readFile(movedFile, 'utf8'), 'Complete exFAT move.');
    await assert.rejects(lstat(moveSource), { code: 'ENOENT' });
    await operate(`rename on ${filesystem}`, {
      kind: 'rename',
      sources: [movedFile],
      name: 'Renamed.txt',
    });
    assert.equal(await readFile(path.join(moved, 'Renamed.txt'), 'utf8'), 'Complete exFAT move.');
    await assert.rejects(lstat(movedFile), { code: 'ENOENT' });
    assert.equal(await readFile(note, 'utf8'), 'Complete exFAT copy.');

    const report = path.join(incoming, 'report.txt');
    const taken = path.join(copied, 'report.txt');
    const renameSource = path.join(incoming, 'Rename source.txt');
    await writeFile(report, 'Incoming report.', { flag: 'wx' });
    await writeFile(taken, 'Existing report.', { flag: 'wx' });
    await writeFile(renameSource, 'Rename source.', { flag: 'wx' });
    assert.notEqual(
      itemIdentity(await lstat(report, { bigint: true })),
      itemIdentity(await lstat(taken, { bigint: true })),
    );
    await collision(`copy collision on ${filesystem}`, {
      kind: 'copy',
      sources: [report],
      destination: copied,
    });
    await collision(`move collision on ${filesystem}`, {
      kind: 'move',
      sources: [report],
      destination: copied,
    });
    await collision(`rename collision on ${filesystem}`, {
      kind: 'rename',
      sources: [renameSource],
      name: 'report.txt',
    });
    assert.equal(await readFile(report, 'utf8'), 'Incoming report.');
    assert.equal(await readFile(taken, 'utf8'), 'Existing report.');
    assert.equal(await readFile(renameSource, 'utf8'), 'Rename source.');

    if (filesystem === 'ExFAT') {
      // Only the standalone test algorithm fails commit. Its exclusive syscall and recovery use
      // the real exFAT image; production N-API has no failure-injection endpoint.
      const runner = path.join(root, 'exclusive-rename-test');
      await run('/usr/bin/xcrun', [
        'clang++',
        '-std=c++17',
        '-Wall',
        '-Wextra',
        '-Werror',
        path.join(appRoot, 'tools/exclusive-rename-test.cc'),
        '-o',
        runner,
      ]);
      const failedSource = path.join(incoming, 'Failed publication.txt');
      const failedTarget = path.join(copied, 'Failed publication.txt');
      const retained = path.join(root, 'Failure evidence');
      const adapterFolder = path.join(mount, 'Trash adapter');
      await mkdir(retained);
      await mkdir(adapterFolder);
      await writeFile(failedSource, 'Complete failed-publication source.', { flag: 'wx' });
      const failed = JSON.parse(
        (await run(runner, [failedSource, failedTarget, retained, 'native-fail', 'reserve']))
          .stdout,
      ) as NativeRenameRecovery & { error: number; reservations: number; commits: number };
      assert.notEqual(failed.error, 0);
      assert.equal(failed.reservations, 1);
      assert.equal(failed.commits, 1);
      const reservation = failed.entries.find((entry) => entry.kind === 'reservation');
      assert.ok(reservation && reservation.kind === 'reservation');
      assert.equal(
        itemIdentity(await lstat(reservation.path, { bigint: true })),
        nativeItemIdentity(reservation.identity),
      );
      const adapterPaths: string[] = [];
      const flags = [process.env.VIEWER_TEST_PRESERVE, process.env.VIEWER_TEST_NO_REMOVAL];
      let notes: string[];
      try {
        // Enable only this injected retained adapter. It moves entries within the generated image,
        // never calls the operating-system Trash and never deletes fixtures.
        process.env.VIEWER_TEST_PRESERVE = '0';
        process.env.VIEWER_TEST_NO_REMOVAL = '0';
        notes = await disposeRenameRecovery(failed, async (file) => {
          adapterPaths.push(file);
          const target = path.join(adapterFolder, 'Retained ' + adapterPaths.length);
          await rename(file, target);
          return { path: target, directory: (await lstat(target)).isDirectory() };
        });
      } finally {
        process.env.VIEWER_TEST_PRESERVE = flags[0];
        process.env.VIEWER_TEST_NO_REMOVAL = flags[1];
      }
      recovery = { native: failed, notes, adapterPaths };
      assert.ok(adapterPaths.includes(reservation.path));
      assert.ok(notes.join(' ').includes('moved to the Trash'));
      assert.ok(!notes.join(' ').includes('changed and was kept'));
      assert.equal((await lstat(path.join(adapterFolder, 'Retained 1'))).size, 0);
      assert.equal(await readFile(failedSource, 'utf8'), 'Complete failed-publication source.');
      await assert.rejects(lstat(failedTarget), { code: 'ENOENT' });
      console.log('failed publication reservation reached the retained Trash adapter: passed');
    }
    await temporalFlows(incoming, copied, moved, mounted['dev-entry']);
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
        filesystem,
        lifetimes,
        results,
        collisions,
        recovery,
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
}
try {
  await scenario('ExFAT');
  await scenario('MS-DOS FAT32');
} finally {
  await fileCoordination.close();
}
