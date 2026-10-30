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
import { directBuildNumber } from './build-number';
import { macOSMinimum } from './native-build/macos-target';
import { sourceHash } from './qualification/source';
import { releaseFeedEndpoint, releaseNotes, signingKey, writeSignedFeed } from './update-feed';
import { httpsAddress } from '../src/desktop/updates/signature';
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

/** Git's answer, as text. */
type GitCommand = (args: string[]) => Promise<string>;
const runGit: GitCommand = async (args) =>
  (await exec('git', args, { cwd: root, maxBuffer: 8_000_000 })).stdout;

export interface ReleaseSource {
  commit: string;
  build: string;
}

/** A release is built from committed source with its full history: the build number is the
 * commit count (tools/build-number.ts), and the receipt names the commit. */
export async function releaseSource(git: GitCommand = runGit): Promise<ReleaseSource> {
  if ((await git(['status', '--porcelain', '--untracked-files=normal'])).trim())
    throw new Error('Commit or stash every change first: a release is built from a clean tree.');
  if ((await git(['rev-parse', '--is-shallow-repository'])).trim() !== 'false')
    throw new Error('A release needs the full Git history: its build number is the commit count.');
  const commit = (await git(['rev-parse', 'HEAD'])).trim();
  const build = (await git(['rev-list', '--count', 'HEAD'])).trim();
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[1-9]\d{0,9}$/.test(build))
    throw new Error('Git did not report the release commit and its build number.');
  return { commit, build };
}

/** Run before packaging, from the app directory, with test folders preserved (AGENTS.md). */
export const releaseGates = ['check', 'lint', 'format:check', 'test', 'docs:check', 'plurid:check'];

function pnpm(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', [script], { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`pnpm ${script} failed; nothing was packaged.`)),
    );
  });
}

/** The release notes this version ships with, from release-notes/<version>.txt. */
export async function versionNotes(version: string): Promise<string> {
  const file = path.join(root, 'release-notes', version + '.txt');
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Write the release notes in ${path.relative(root, file)} and commit them.`);
  });
  return releaseNotes(text);
}

/** The values the packager stamped into Info.plist. */
async function bundleValue(app: string, key: string): Promise<string> {
  const plist = path.join(app, 'Contents', 'Info.plist');
  return (await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
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
  const version = (
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
  ).version;
  // Everything that can refuse the release does so before the long gates run.
  const source = await releaseSource();
  if (directBuildNumber(root) !== source.build)
    throw new Error('The packager would stamp a different build number than this release.');
  const notes = await versionNotes(version);
  const feedKey = await signingKey(process.env);
  const endpoint = releaseFeedEndpoint(feedKey);
  const name = `Viewer-${version}-${source.build}-arm64`;
  const download = httpsAddress(
    process.env.VIEWER_RELEASE_DOWNLOAD_URL?.trim() || new URL(name + '.dmg', endpoint.feed).href,
    'VIEWER_RELEASE_DOWNLOAD_URL',
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
  // The signing key stays in this process; the gates and the packager never see it.
  const { VIEWER_UPDATE_SIGNING_KEY: _key, ...environment } = process.env;
  for (const gate of releaseGates)
    await pnpm(gate, { ...environment, VIEWER_TEST_PRESERVE: '1', VIEWER_TEST_NO_REMOVAL: '1' });
  // The gates must leave the committed source as it was.
  if ((await releaseSource()).commit !== source.commit)
    throw new Error('The checked-out commit changed during the release gates.');
  const sourceSHA256 = await sourceHash(root);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['package'], {
      cwd: root,
      env: {
        ...environment,
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
  if (
    (await bundleValue(app, 'CFBundleShortVersionString')) !== version ||
    (await bundleValue(app, 'CFBundleVersion')) !== source.build
  )
    throw new Error(`The packaged app is not version ${version} build ${source.build}.`);
  const parent = path.join(root, 'out/direct-release');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(
    path.join(parent, new Date().toISOString().replace(/[:.]/g, '-') + '-'),
  );
  const archive = path.join(directory, name + '.app.zip');
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
    dmg = path.join(directory, name + '.dmg');
  try {
    await cloneTree(stapled, path.join(stage, 'Viewer.app'));
    await symlink('/Applications', path.join(stage, 'Applications'));
    await writeFile(
      path.join(stage, 'Install Viewer.txt'),
      `Drag Viewer.app to Applications, then open it. Viewer requires macOS ${macOSMinimum} or later on Apple Silicon. Optional models need your provider configuration and explicit data approval.\n`,
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
    const sha256 = hash.digest('hex');
    await writeFile(
      path.join(directory, 'SHA256SUMS.txt'),
      sha256 + '  ' + path.basename(dmg) + '\n',
    );
    const feed = await writeSignedFeed(
      directory,
      {
        version,
        build: Number(source.build),
        notes,
        url: download.href,
        sha256,
        minimumSystemVersion: macOSMinimum,
      },
      feedKey,
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
          release: { version, build: source.build, commit: source.commit, sourceSHA256 },
          updateFeed: {
            feed: path.relative(root, feed.feed),
            signature: path.relative(root, feed.signature),
            publishAt: endpoint.feed.href,
            download: download.href,
          },
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'Signed and notarized local installer: ' +
        path.relative(root, dmg) +
        `\nPublish it at ${download.href}, then ${path.basename(feed.feed)} and its .sig at ${endpoint.feed.href}.` +
        `\nTag the release: git tag v${version} ${source.commit}` +
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
