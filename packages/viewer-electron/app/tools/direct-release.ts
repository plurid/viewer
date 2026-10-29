/** Signed/notarized local candidates only. This does not publish or upload a Store listing. */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { temporaryRoot } from './temporary';
import { cloneTree } from './clone';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  exec = promisify(execFile);

interface Notarization {
  status: string;
  id: string;
}
type NotaryCommand = (args: string[]) => Promise<string>;
const runNotaryCommand: NotaryCommand = async (args) =>
  (await exec('xcrun', args, { timeout: 30 * 60000, maxBuffer: 2_000_000 })).stdout;

/** Stapler can fail at deeply nested checkout paths. Let Apple's tool modify a short,
 * retained whole-app copy; the submitted source and failed copies stay intact. */
export async function stapleApplicationRetained(
  app: string,
  run: NotaryCommand = runNotaryCommand,
): Promise<string> {
  const source = await lstat(app);
  if (!source.isDirectory() || source.isSymbolicLink())
    throw new Error('Stapling requires an ordinary application bundle directory.');
  const directory = await temporaryRoot('viewer-staple-');
  const copy = path.join(directory, path.basename(app));
  await cloneTree(app, copy);
  const ticket = await lstat(path.join(copy, 'Contents', 'CodeResources')).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  });
  // A repeat must validate the retained ticket, never ask stapler to remove it.
  if (!ticket) await run(['stapler', 'staple', copy]);
  await run(['stapler', 'validate', copy]);
  return copy;
}

/** Keep Apple's response even when a submission fails; never clean up its archive. */
export async function notarizeRetained(
  artifact: string,
  profile: string,
  record: string,
  run: NotaryCommand = runNotaryCommand,
): Promise<Notarization> {
  let output: string;
  try {
    output = await run([
      'notarytool',
      'submit',
      artifact,
      '--keychain-profile',
      profile,
      '--wait',
      '--output-format',
      'json',
    ]);
  } catch (error) {
    await writeFile(
      record,
      JSON.stringify(
        {
          status: 'Command failed',
          error: error instanceof Error ? error.message : String(error),
          ...(error && typeof error === 'object' && 'stdout' in error
            ? { stdout: String(error.stdout) }
            : {}),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    throw error;
  }
  await writeFile(record, output, { flag: 'wx' });
  const result: unknown = JSON.parse(output);
  if (
    !result ||
    typeof result !== 'object' ||
    !('id' in result) ||
    typeof result.id !== 'string' ||
    !('status' in result) ||
    typeof result.status !== 'string'
  )
    throw new Error('Apple returned an invalid notarization response; the response was retained.');
  if (result.status !== 'Accepted')
    throw new Error(
      'Apple did not accept notarization: ' + result.status + ' (' + result.id + ').',
    );
  return { id: result.id, status: result.status };
}

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
    const child = spawn('pnpm', ['package'], {
      cwd: root,
      env: {
        ...process.env,
        VIEWER_MAC_CHANNEL: 'direct',
        VIEWER_DIRECT_IDENTITY: signedIdentity,
        // Forge's automatic notarizer permanently removes its temporary archive.
        // This command owns the retained archive and submission instead.
        VIEWER_NOTARY_PROFILE: '',
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
  const version = (
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
  ).version;
  const parent = path.join(root, 'out/direct-release');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(
    path.join(parent, new Date().toISOString().replace(/[:.]/g, '-') + '-'),
  );
  const archive = path.join(directory, `Viewer-${version}-arm64.app.zip`);
  console.log('Notarizing app; evidence kept at ' + path.relative(root, directory));
  await exec('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
  const appSubmission = await notarizeRetained(
    archive,
    profile,
    path.join(directory, 'app-notarization.json'),
  );
  const stapled = await stapleApplicationRetained(app);
  await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', stapled]);
  const stage = await mkdtemp(path.join(directory, 'stage-')),
    dmg = path.join(directory, `Viewer-${version}-arm64.dmg`);
  try {
    await cloneTree(stapled, path.join(stage, 'Viewer.app'));
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
    console.log('Notarizing disk image.');
    const result = await notarizeRetained(
      dmg,
      profile,
      path.join(directory, 'dmg-notarization.json'),
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
        {
          version: 1,
          // A later package replaces the regular output. Retain the exact
          // notarized app used by this installer beside its receipt.
          app: path.relative(root, path.join(stage, 'Viewer.app')),
          installer: path.relative(root, dmg),
          appSubmissionID: appSubmission.id,
          submissionID: result.id,
          status: result.status,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'Signed and notarized local installer: ' +
        path.relative(root, dmg) +
        '\nNo public publishing was performed.',
    );
  } finally {
    // The disk-image source stays beside the installer for review; nothing is deleted.
    console.log('Disk image staging kept at ' + path.relative(root, stage));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
