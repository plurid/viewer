/** Reproducible release evidence. A passing automated run is not Store approval. */
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, sourceHash, treeHash } from './qualification/source';
import { cloneTree } from './clone';
import { macOSMinimum } from './native-build/macos-target';
import {
  execRelease as exec,
  releaseEnvironment,
  spawnRelease as spawn,
} from './release-environment';
import store from '../mac-app-store.json' with { type: 'json' };

export { treeHash } from './qualification/source';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qualificationArch = 'arm64';

export async function qualificationStoreCandidate(
  appRoot: string,
  environment: NodeJS.ProcessEnv,
  build?: (env: NodeJS.ProcessEnv) => Promise<boolean>,
) {
  const bundle = path.join(appRoot, 'out/mac-app-store/mas-dev', qualificationArch, 'Viewer.app');
  if (!build) return bundle;
  const previous = await lstat(bundle, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const built = await build(
    releaseEnvironment({
      ...environment,
      VIEWER_MAC_CHANNEL: 'mas-dev',
      VIEWER_BUILD_ARCH: qualificationArch,
      VIEWER_MAS_ARCH: qualificationArch,
    }),
  );
  if (!built) return undefined;
  const current = await lstat(bundle, { bigint: true });
  if (!current.isDirectory() || (previous?.dev === current.dev && previous.ino === current.ino))
    throw new Error(
      'Store qualification found a retained or invalid bundle in the build destination.',
    );
  return bundle;
}
type Check = {
  id: string;
  result: 'passed' | 'failed' | 'blocked';
  seconds?: number;
  log?: string;
  reason?: string;
};
type Candidate = {
  channel: string;
  bundle: string;
  sha256: string;
  minimumOS: string;
  localNetworkUsageDescription: string;
  nativeFiles: { file: string; sha256: string; signature: string }[];
};
async function nativeInventory(bundle: string) {
  const files: Candidate['nativeFiles'] = [];
  async function visit(relative: string) {
    const file = path.join(bundle, relative),
      info = await lstat(file);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
      return;
    }
    const handle = await open(file, 'r'),
      buffer = Buffer.alloc(16);
    try {
      await handle.read(buffer, 0, buffer.length, 0);
    } finally {
      await handle.close();
    }
    if (
      ![0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(
        buffer.readUInt32BE(),
      )
    )
      return;
    // Rebuild also leaves relocatable .o files. They are resources rather than
    // executable/dylib code and cannot carry a code signature. Still inventory
    // and hash them; require signatures for actual loadable native code.
    const object =
      (buffer.readUInt32BE() === 0xcffaedfe && buffer.readUInt32LE(12) === 1) ||
      (buffer.readUInt32BE() === 0xfeedfacf && buffer.readUInt32BE(12) === 1);
    const signature = object
      ? 'Mach-O relocatable object (not loadable code)'
      : await exec('/usr/bin/codesign', ['-dv', '--verbose=4', file], {
          maxBuffer: 1_000_000,
        }).then((value) =>
          value.stderr
            .split('\n')
            .filter((line) =>
              /^(Identifier|TeamIdentifier|Authority|CodeDirectory|VersionMin|CDHash)=/.test(line),
            )
            .join('\n'),
        );
    files.push({ file: relative, sha256: await hashFile(file), signature });
  }
  await visit('Contents');
  return files;
}
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This qualification target requires an Apple Silicon Mac.');
  const args = process.argv.slice(2),
    mas = args.includes('--mas'),
    build = !args.includes('--no-build');
  for (const arg of args)
    if (!['--mas', '--no-build'].includes(arg) && !/^--soak-minutes=\d+(?:\.\d+)?$/.test(arg))
      throw new Error('Unknown qualification argument: ' + arg);
  const soak = Number(args.find((arg) => arg.startsWith('--soak-minutes='))?.split('=')[1] ?? 120);
  if (!Number.isFinite(soak) || soak < 0 || soak > 1440)
    throw new Error(
      'Soak duration must be between 0 and 1,440 minutes. Release acceptance requires at least 120.',
    );
  const directory = path.join(
    root,
    'out/qualification',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(directory, { recursive: true });
  const checks: Check[] = [],
    candidates: Candidate[] = [],
    started = new Date().toISOString(),
    source = await sourceHash(root);
  const report = {
    version: 1,
    started,
    finished: '',
    sourceSha256: source,
    environment: {
      platform: process.platform,
      arch: process.arch,
      kernel: os.release(),
      macOS: (await exec('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim(),
      node: process.versions.node,
      idleSleepAssertion: mas && soak > 0 ? 'Temporary caffeinate -i for this runner' : 'none',
    },
    checks,
    candidates,
    releaseReady: false,
    gates: [
      'Native Finder drag/copy exchange in both directions, physical keyboard and VoiceOver acceptance',
      'Real picker/cancel/cold bookmark/revoke and separately granted source/destination acceptance',
      'Disposable-volume eject/reconnect and cloud/file-provider coordination',
      'External Terminal/iTerm and private tmux handoff from the signed candidate',
      'Live configured model consent and cancellation acceptance (contract tests do not call paid providers)',
      'Complete representative corpus for every advertised preview format, including valid IGES and codec/provider edge cases',
      'Native low-disk-space, interrupted transfer and filesystem/provider failure acceptance',
      `Native acceptance on macOS ${macOSMinimum} and the current stable macOS release`,
      'Store distribution certificate/profile/installer, direct notarization, public privacy/support pages and reviewed listing',
    ],
  };
  if (!build)
    report.gates.push(
      'This run did not build the candidates from the recorded source; source-to-artifact provenance remains unverified.',
    );
  const save = () =>
    writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  async function run(id: string, args: string[], environment: NodeJS.ProcessEnv = {}) {
    const filename = id + '.log',
      log = createWriteStream(path.join(directory, filename), { flags: 'wx' }),
      start = Date.now();
    console.log('Qualification: ' + id);
    const child = spawn('pnpm', args, {
      cwd: root,
      env: releaseEnvironment({ ...process.env, ...environment }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.pipe(log, { end: false });
    child.stderr!.pipe(log, { end: false });
    const result = await new Promise<Check>((resolve) => {
      child.once('error', (error) => resolve({ id, result: 'failed', reason: error.message }));
      child.once('exit', (code, signal) =>
        resolve({
          id,
          result: code === 0 ? 'passed' : 'failed',
          reason: code === 0 ? undefined : `Exit ${code ?? signal}`,
        }),
      );
    });
    await new Promise<void>((resolve) => log.end(resolve));
    checks.push({ ...result, seconds: (Date.now() - start) / 1000, log: filename });
    await save();
    return result.result === 'passed';
  }
  async function freeze(channel: string, origin: string) {
    const bundle = path.join(directory, 'candidates', channel, 'Viewer.app');
    await mkdir(path.dirname(bundle), { recursive: true });
    await cloneTree(origin, bundle);
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    if (channel === 'mas-dev') {
      await exec('/usr/bin/lipo', [
        path.join(bundle, 'Contents/MacOS/Viewer'),
        '-verify_arch',
        qualificationArch,
      ]);
      const plist = path.join(bundle, 'Contents/Info.plist');
      const expected = {
        CFBundleIdentifier: store.bundleID,
        CFBundleVersion: build ? process.env.VIEWER_MAS_BUILD : undefined,
      };
      for (const [key, value] of Object.entries(expected))
        if (
          value &&
          (
            await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])
          ).stdout.trim() !== value
        )
          throw new Error(`The Store candidate has an unexpected ${key}.`);
    }
    const minimumOS = (
      await exec('/usr/bin/plutil', [
        '-extract',
        'LSMinimumSystemVersion',
        'raw',
        '-o',
        '-',
        path.join(bundle, 'Contents/Info.plist'),
      ])
    ).stdout.trim();
    const localNetworkUsageDescription = (
      await exec('/usr/bin/plutil', [
        '-extract',
        'NSLocalNetworkUsageDescription',
        'raw',
        '-o',
        '-',
        path.join(bundle, 'Contents/Info.plist'),
      ])
    ).stdout.trim();
    if (minimumOS !== macOSMinimum)
      throw new Error(`The candidate must declare macOS ${macOSMinimum}, not ${minimumOS}.`);
    if (!localNetworkUsageDescription)
      throw new Error('The candidate must explain its configured local-model network access.');
    const candidate = {
      channel,
      bundle,
      sha256: await treeHash(bundle),
      minimumOS,
      localNetworkUsageDescription,
      nativeFiles: await nativeInventory(bundle),
    };
    candidates.push(candidate);
    await save();
    return candidate;
  }
  let awake: ReturnType<typeof spawn> | undefined;
  try {
    if (mas && soak > 0) {
      // The endurance run needs an awake host. This assertion belongs only to
      // the test runner, allows display sleep and changes no power preferences.
      awake = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], {
        stdio: 'ignore',
      });
      await new Promise<void>((resolve, reject) => {
        awake!.once('spawn', resolve);
        awake!.once('error', reject);
      });
    }
    const staticChecks = await Promise.all([
      run('plurid-registry', ['exec', 'tsx', 'tools/plurid-registry.ts', '--registry']),
      run('types', ['check']),
      run('lint', ['lint']),
      run('format', ['format:check']),
      run('tests', ['test']),
    ]);
    await run('dependency-audit', ['audit', '--prod', '--json']);
    await run('build-dependency-audit', ['audit', '--json']);
    await run('licenses', ['exec', 'tsx', 'tools/licenses.ts']);
    if (staticChecks.some((passed) => !passed)) return;
    // Store packaging needs a vacant Vite directory. The direct package can then
    // use its approved Trash preflight, after the Store candidate has been frozen.
    let storeCandidate: Candidate | undefined;
    if (mas) {
      if (
        build &&
        (!process.env.VIEWER_MAS_IDENTITY ||
          !process.env.VIEWER_MAS_PROFILE ||
          !process.env.VIEWER_MAS_BUILD)
      )
        checks.push({
          id: 'mas-build',
          result: 'blocked',
          reason: 'Provide development signing identity, matching macOS profile and build number.',
        });
      else {
        const origin = await qualificationStoreCandidate(
          root,
          process.env,
          build ? (env) => run('mas-build', ['mas:dev'], env) : undefined,
        );
        if (origin) storeCandidate = await freeze('mas-dev', origin);
      }
    }
    // each build names its channel: one left exported must not turn either into the other
    if (
      build &&
      !(await run('direct-build', ['package'], {
        VIEWER_MAC_CHANNEL: 'direct',
        VIEWER_BUILD_ARCH: 'arm64',
        VIEWER_NOTARY_PROFILE: '',
      }))
    )
      return;
    const direct = await freeze(
      'direct',
      path.join(root, `out/Viewer-darwin-${process.arch}/Viewer.app`),
    );
    const directEnvironment = {
      VIEWER_TEST_BINARY: path.join(direct.bundle, 'Contents/MacOS/Viewer'),
    };
    await run('native-coordination', ['exec', 'tsx', 'tests/native-coordination.ts'], {
      VIEWER_COORDINATION_EVIDENCE: path.join(directory, 'native-coordination.json'),
    });
    for (const scenario of [
      'published-plane-input',
      'file-workflows',
      'daily-file-work',
      'chrome',
      'menus-models',
      'refinements',
      'drawings-workspaces',
      'foundations',
      'store-file-services',
      'shutdown',
      'alignment',
      'size',
      'entry',
    ])
      await run('direct-' + scenario, ['test:desktop'], {
        ...directEnvironment,
        VIEWER_TEST_SCENARIO: scenario,
      });
    await run(
      'window-placement',
      ['exec', 'tsx', 'tests/window-state-native.ts'],
      directEnvironment,
    );
    await run('direct-volumes', ['exec', 'tsx', 'tests/native-volumes.ts'], {
      ...directEnvironment,
      VIEWER_VOLUME_EVIDENCE: path.join(directory, 'direct-volumes.json'),
    });
    await run('direct-preview-limits', ['exec', 'tsx', 'tests/adverse-previews.ts'], {
      ...directEnvironment,
      VIEWER_ADVERSE_EVIDENCE: path.join(directory, 'direct-preview-limits.json'),
    });
    await run('direct-low-space', ['exec', 'tsx', 'tests/native-low-space.ts'], {
      ...directEnvironment,
      VIEWER_LOW_SPACE_EVIDENCE: path.join(directory, 'direct-low-space.json'),
    });
    // the laser job end to end; it keeps every file it makes and moves nothing to the Trash
    await run('direct-fabrication', ['test:fabrication-native'], {
      ...directEnvironment,
      VIEWER_TEST_PRESERVE: '1',
      VIEWER_TEST_NO_REMOVAL: '1',
    });
    if (mas) {
      if (checks.some((check) => check.result === 'failed')) {
        checks.push({
          id: 'mas-native',
          result: 'blocked',
          reason: 'Resolve the failed qualification checks before starting the signed soak.',
        });
        return;
      }
      if (storeCandidate) {
        if (
          await run('mas-model-consent', ['exec', 'tsx', 'tests/mas-model-consent.ts'], {
            VIEWER_TEST_MAS_BUNDLE: storeCandidate.bundle,
            VIEWER_MODEL_EVIDENCE: path.join(directory, 'mas-model-consent.json'),
          })
        )
          await run('mas-native', ['test:mas'], {
            VIEWER_TEST_MAS_BUNDLE: storeCandidate.bundle,
            VIEWER_TEST_SOAK_MINUTES: String(soak),
            VIEWER_TEST_EVIDENCE: path.join(directory, 'mas-lifecycle.json'),
          });
        else
          checks.push({
            id: 'mas-native',
            result: 'blocked',
            reason: 'Resolve the failed signed model-consent check before starting the soak.',
          });
      }
    } else
      checks.push({
        id: 'mas-native',
        result: 'blocked',
        reason: 'Run with --mas to qualify the actual signed App Sandbox runtime.',
      });
    if (soak < 120)
      report.gates.push(
        'The final signed candidate has not completed the required two-hour lifecycle soak.',
      );
  } catch (error) {
    checks.push({
      id: 'qualification',
      result: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    awake?.kill('SIGTERM');
    for (const candidate of candidates)
      if ((await treeHash(candidate.bundle)) !== candidate.sha256)
        checks.push({
          id: candidate.channel + '-immutable',
          result: 'failed',
          reason: 'Candidate changed during qualification.',
        });
    if ((await sourceHash(root)) !== source)
      checks.push({
        id: 'source-immutable',
        result: 'failed',
        reason: 'Source changed during the qualification run. Rebuild and rerun.',
      });
    report.finished = new Date().toISOString();
    await save();
    console.log('Evidence: ' + path.join(directory, 'report.json'));
    console.log('Release ready: false. See the explicit native/distribution gates in the report.');
    process.exitCode = checks.some((check) => check.result === 'failed') ? 1 : 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
