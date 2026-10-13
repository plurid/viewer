/** Signed/notarized local candidates only. This does not publish or upload a Store listing. */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  exec = promisify(execFile);
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('The initial direct release targets Apple Silicon macOS.');
  const identity = process.env.VIEWER_DIRECT_IDENTITY?.trim(),
    profile = process.env.VIEWER_NOTARY_PROFILE?.trim();
  if (!identity || !profile)
    throw new Error(
      'Set VIEWER_DIRECT_IDENTITY to the Developer ID Application identity and VIEWER_NOTARY_PROFILE to a notarytool Keychain profile. Private keys/passwords stay in Keychain.',
    );
  const identities = (await exec('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']))
    .stdout;
  const row = identities
    .split('\n')
    .find((line) => line.includes(identity) && line.includes('Developer ID Application:'));
  if (!row)
    throw new Error(
      'The selected Developer ID Application identity/private key is unavailable in Keychain.',
    );
  const signedIdentity = row.trim().split(/\s+/)[1];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['make'], {
      cwd: root,
      env: {
        ...process.env,
        VIEWER_MAC_CHANNEL: 'direct',
        VIEWER_DIRECT_IDENTITY: signedIdentity,
        VIEWER_NOTARY_PROFILE: profile,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Direct packaging failed.')),
    );
  });
  const app = path.join(root, 'out/Viewer-darwin-arm64/Viewer.app');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await exec('xcrun', ['stapler', 'validate', app]);
  await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  const version = (
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
  ).version;
  const directory = path.join(
    root,
    'out/direct-release',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(directory, { recursive: true });
  const stage = await mkdtemp(path.join(directory, 'stage-')),
    dmg = path.join(directory, `Viewer-${version}-arm64.dmg`);
  try {
    await cp(app, path.join(stage, 'Viewer.app'), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    await symlink('/Applications', path.join(stage, 'Applications'));
    await writeFile(
      path.join(stage, 'Install Viewer.txt'),
      'Drag Viewer.app to Applications, then open it. Viewer requires macOS 13 or later on Apple Silicon. Optional models need your provider configuration and explicit data approval.\n',
    );
    await exec(
      '/usr/bin/hdiutil',
      ['create', '-volname', 'Viewer', '-srcfolder', stage, '-format', 'UDZO', dmg],
      { maxBuffer: 2_000_000 },
    );
    await exec('/usr/bin/codesign', ['--force', '--timestamp', '--sign', signedIdentity, dmg]);
    const result = JSON.parse(
      (
        await exec(
          'xcrun',
          [
            'notarytool',
            'submit',
            dmg,
            '--keychain-profile',
            profile,
            '--wait',
            '--output-format',
            'json',
          ],
          { timeout: 30 * 60000, maxBuffer: 2_000_000 },
        )
      ).stdout,
    ) as { status: string; id: string };
    if (result.status !== 'Accepted')
      throw new Error(
        'Apple did not accept the DMG notarization: ' + result.status + ' (' + result.id + ').',
      );
    await exec('xcrun', ['stapler', 'staple', dmg]);
    await exec('xcrun', ['stapler', 'validate', dmg]);
    await exec('/usr/bin/hdiutil', ['verify', dmg], { maxBuffer: 2_000_000 });
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(dmg)) hash.update(chunk);
    await writeFile(
      path.join(directory, 'SHA256SUMS.txt'),
      hash.digest('hex') + '  ' + path.basename(dmg) + '\n',
    );
    await writeFile(
      path.join(directory, 'notarization.json'),
      JSON.stringify(
        { version: 1, app, installer: dmg, submissionID: result.id, status: result.status },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'Signed and notarized local installer: ' + dmg + '\nNo public publishing was performed.',
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
