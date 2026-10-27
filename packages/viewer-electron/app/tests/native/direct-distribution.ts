/** Inspect actual installer bytes and an untouched downloaded copy; retain every artifact. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';
import { hashFile } from '../../tools/qualification/source';
import { temporaryRoot } from '../../tools/temporary';
import { verifyOfficeRuntime } from '../../src/desktop/previews/office-assets';
import { storeConfiguration } from '../../tools/mas-configuration';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.platform, 'darwin', 'Direct distribution acceptance requires macOS.');
const expectedTeam = storeConfiguration.parse(
  JSON.parse(await readFile('mac-app-store.json', 'utf8')),
).teamID;
const receiptFile = process.env.VIEWER_TEST_DISTRIBUTION_RECEIPT;
assert.ok(receiptFile, 'Choose the exact completed direct-release receipt.');
const receipt = JSON.parse(await readFile(receiptFile, 'utf8')) as {
  status: string;
  app: string;
  installer: string;
};
assert.equal(receipt.status, 'Accepted');
const installer = path.resolve(receipt.installer);
assert.equal(path.dirname(installer), path.dirname(path.resolve(receiptFile)));
const installerInfo = await lstat(installer);
assert.ok(installerInfo.isFile() && !installerInfo.isSymbolicLink());
const expected = (
  await readFile(path.join(path.dirname(installer), 'SHA256SUMS.txt'), 'utf8')
).split(/\s+/)[0];
assert.equal(await hashFile(installer), expected);
const root = await temporaryRoot('viewer-installed-release-', path.resolve('out'));
const mount = path.join(root, 'Mounted');
const installed = path.join(root, 'Installed', 'Viewer.app');
await Promise.all([mkdir(mount), mkdir(path.dirname(installed))]);
const exec = promisify(execFile);
const checks: { name: string; passed: boolean; log: string }[] = [];
const check = async (name: string, file: string, args: string[]) => {
  const log = name + '.log';
  try {
    const result = await exec(file, args, { timeout: 120000, maxBuffer: 4_000_000 });
    await writeFile(path.join(root, log), result.stdout + result.stderr, { flag: 'wx' });
    checks.push({ name, passed: true, log });
    return result;
  } catch (error) {
    await writeFile(path.join(root, log), String(error), { flag: 'wx' });
    checks.push({ name, passed: false, log });
    throw error;
  }
};
let mounted = false;
let passed = false;
const manifests: { name: string; filesChecked: number; signedFiles: string[] }[] = [];
try {
  await check('dmg-signature', '/usr/bin/codesign', ['--verify', '--strict', installer]);
  await check('dmg-ticket', '/usr/bin/xcrun', ['stapler', 'validate', installer]);
  await check('dmg-gatekeeper', '/usr/sbin/spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=4',
    installer,
  ]);
  await check('dmg-integrity', '/usr/bin/hdiutil', ['verify', installer]);
  await check('mount-read-only', '/usr/bin/hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mount,
    '-plist',
    installer,
  ]);
  mounted = true;
  const source = path.join(mount, 'Viewer.app');
  await check('mounted-app-signature', '/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    source,
  ]);
  await check('install-copy', '/usr/bin/ditto', [source, installed]);
  const archive = 'Contents/Resources/app.asar';
  const archiveHash = await hashFile(path.join(installed, archive));
  assert.equal(archiveHash, await hashFile(path.join(source, archive)));
  assert.equal(archiveHash, await hashFile(path.join(path.resolve(receipt.app), archive)));
  const quarantine =
    '0083;' +
    Math.floor(Date.now() / 1000).toString(16) +
    ';Viewer distribution qualification;' +
    randomUUID();
  await check('download-quarantine', '/usr/bin/xattr', [
    '-w',
    'com.apple.quarantine',
    quarantine,
    installed,
  ]);
  await check('installed-app-signature', '/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    installed,
  ]);
  await check('installed-app-ticket', '/usr/bin/xcrun', ['stapler', 'validate', installed]);
  await check('installed-app-gatekeeper', '/usr/sbin/spctl', [
    '--assess',
    '--type',
    'execute',
    '--verbose=4',
    installed,
  ]);
  const identity = await check('installed-app-identity', '/usr/bin/codesign', [
    '-dv',
    '--verbose=4',
    installed,
  ]);
  assert.ok(identity.stderr.includes('TeamIdentifier=' + expectedTeam));
  assert.ok(identity.stderr.includes('runtime'));
  const fuses = await getCurrentFuseWire(path.join(installed, 'Contents/MacOS/Viewer'));
  assert.equal(fuses.version, FuseVersion.V1);
  for (const option of [
    FuseV1Options.RunAsNode,
    FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    FuseV1Options.EnableNodeCliInspectArguments,
  ])
    assert.equal(fuses[option], FuseState.DISABLE);
  for (const option of [
    FuseV1Options.OnlyLoadAppFromAsar,
    FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  ])
    assert.equal(fuses[option], FuseState.ENABLE);
  const resources = path.join(installed, 'Contents/Resources');
  await verifyOfficeRuntime(path.join(resources, 'viewer-office-v1'));
  for (const name of [
    'viewer-processors-darwin-arm64',
    'viewer-optimizers-darwin-arm64',
    'viewer-raw-v3-darwin-arm64',
  ]) {
    const directory = path.join(resources, name);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    const signedFiles: string[] = [];
    for (const [relative, expected] of Object.entries(manifest.files)) {
      assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
      const file = path.join(directory, relative);
      const info = await lstat(file);
      assert.ok(info.isFile() && !info.isSymbolicLink());
      if ((await hashFile(file)) === expected) continue;
      const handle = await open(file, 'r');
      const header = Buffer.alloc(4);
      try {
        await handle.read(header, 0, 4, 0);
      } finally {
        await handle.close();
      }
      assert.ok(
        ['cffaedfe', 'cefaedfe', 'feedface', 'feedfacf', 'cafebabe', 'bebafeca'].includes(
          header.toString('hex'),
        ),
        'Non-native asset changed: ' + relative,
      );
      await exec('/usr/bin/codesign', ['--verify', '--strict', file], { timeout: 15000 });
      signedFiles.push(relative);
    }
    manifests.push({ name, filesChecked: Object.keys(manifest.files).length, signedFiles });
  }
  passed = true;
  console.log(
    JSON.stringify({
      passed,
      installedApp: path.relative(process.cwd(), installed),
      filesChecked: manifests.reduce((sum, value) => sum + value.filesChecked, 0),
    }),
  );
} finally {
  if (mounted) await check('detach-image', '/usr/bin/hdiutil', ['detach', mount]);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        installer: path.relative(process.cwd(), installer),
        installedApp: path.relative(process.cwd(), installed),
        installerSHA256: expected,
        checks,
        manifests,
        officeAssets: 'six pinned assets verified',
        runtime: 'separate installed-copy checks required',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log('Preserved distribution evidence: ' + path.relative(process.cwd(), root));
}
