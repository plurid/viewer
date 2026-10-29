import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hashFile } from '../filesystem/fingerprints';
import { downloadRetainedArtifact, type ArtifactFetcher } from './download';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type RuntimePlatform = 'darwin' | 'mas' | 'linux' | 'win32';

export type RuntimeExtractor = (archive: string, options: { dir: string }) => Promise<void>;

export interface ElectronRuntimeOptions {
  appRoot: string;
  platform?: string;
  arch?: string;
  cacheRoot?: string;
  environment?: NodeJS.ProcessEnv;
  request?: ArtifactFetcher;
  extract?: RuntimeExtractor;
}

export interface ElectronRuntime {
  packageRoot: string;
  distRoot: string;
  executable: string;
  version: string;
  platform: RuntimePlatform;
  arch: 'arm64' | 'x64';
}

export const electronRuntimeDistribution = 'https://github.com/electron/electron/releases/download';
const maximumArchiveBytes = 512 * 1024 * 1024;
const pending = new Map<
  string,
  { platform: string; arch: string; task: Promise<ElectronRuntime> }
>();

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function regularFile(file: string, limit: number): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > limit)
    throw new Error(`The Electron runtime contains an invalid regular file: ${file}`);
}

async function directory(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`The Electron runtime requires an ordinary directory: ${file}`);
}

async function ensureDirectory(file: string): Promise<void> {
  try {
    await mkdir(file, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await directory(file);
}

function executablePath(platform: RuntimePlatform): string {
  if (platform === 'darwin' || platform === 'mas') return 'Electron.app/Contents/MacOS/Electron';
  return platform === 'win32' ? 'electron.exe' : 'electron';
}

async function inspectRuntime(runtime: ElectronRuntime): Promise<void> {
  await directory(runtime.distRoot);
  for (const file of ['version', 'LICENSE', 'LICENSES.chromium.html'])
    await regularFile(path.join(runtime.distRoot, file), 64 * 1024 * 1024);
  const installed = (await readFile(path.join(runtime.distRoot, 'version'), 'utf8')).trim();
  if (installed.replace(/^v/, '') !== runtime.version)
    throw new Error(
      `The Electron runtime version does not match its pinned package: ${runtime.distRoot}`,
    );
  await regularFile(runtime.executable, maximumArchiveBytes);
  if (runtime.platform === 'darwin' || runtime.platform === 'mas') {
    for (const component of [
      'Electron.app',
      'Electron.app/Contents',
      'Electron.app/Contents/MacOS',
    ])
      await directory(path.join(runtime.distRoot, component));
    await regularFile(path.join(runtime.distRoot, 'Electron.app/Contents/Info.plist'), 1024 * 1024);
  }
  if (runtime.platform !== 'win32' && !((await lstat(runtime.executable)).mode & 0o100))
    throw new Error(
      `The Electron runtime executable lacks execute permission: ${runtime.executable}`,
    );
}

async function inspectPathFile(file: string, expected: string): Promise<void> {
  await regularFile(file, 1024);
  if ((await readFile(file, 'utf8')) !== expected)
    throw new Error(`The existing Electron executable path was preserved: ${file}`);
}

async function runtimeArchive(
  runtime: ElectronRuntime,
  options: ElectronRuntimeOptions,
): Promise<string> {
  const checksumFile = path.join(runtime.packageRoot, 'checksums.json');
  await regularFile(checksumFile, 2 * 1024 * 1024);
  const checksums = JSON.parse(await readFile(checksumFile, 'utf8')) as Record<string, unknown>;
  const name = `electron-v${runtime.version}-${runtime.platform}-${runtime.arch}.zip`;
  const checksum = checksums[name];
  if (typeof checksum !== 'string' || !/^[a-f\d]{64}$/.test(checksum))
    throw new Error(`The pinned Electron package has no valid checksum for ${name}.`);
  const environment = options.environment ?? process.env;
  const cacheRoot = path.resolve(
    options.appRoot,
    options.cacheRoot ?? environment.VIEWER_ELECTRON_RUNTIME_CACHE ?? 'out/native-cache/runtime',
  );
  if (!(await exists(cacheRoot))) await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await directory(cacheRoot);
  const canonical = await realpath(cacheRoot);
  const versionCache = path.join(canonical, runtime.version);
  await ensureDirectory(versionCache);
  const artifactCache = path.join(versionCache, `${runtime.platform}-${runtime.arch}`);
  await ensureDirectory(artifactCache);
  const cached = path.join(artifactCache, name);
  if (await exists(cached)) {
    await regularFile(cached, maximumArchiveBytes);
    if ((await hashFile(cached)) !== checksum)
      throw new Error(`The cached Electron archive changed and was preserved: ${cached}`);
    return cached;
  }

  const attempt = path.join(artifactCache, 'attempt-' + randomUUID());
  await mkdir(attempt, { mode: 0o700 });
  const archive = path.join(attempt, name);
  const url = `${electronRuntimeDistribution}/v${runtime.version}/${name}`;
  await writeFile(
    path.join(attempt, 'artifact.json'),
    JSON.stringify({ version: 1, url, sha256: checksum, package: runtime.version }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const actual = await downloadRetainedArtifact(
    url,
    archive,
    maximumArchiveBytes,
    options.request ?? fetch,
    300_000,
  );
  if (actual !== checksum)
    throw new Error(`Electron runtime checksum mismatch. The download was preserved: ${archive}`);
  try {
    // Publishing a verified cache entry never replaces an earlier attempt or archive.
    await link(archive, cached);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await regularFile(cached, maximumArchiveBytes);
    if ((await hashFile(cached)) !== checksum)
      throw new Error(`A conflicting Electron archive was preserved: ${cached}`);
  }
  return cached;
}

async function provision(
  runtime: ElectronRuntime,
  options: ElectronRuntimeOptions,
): Promise<ElectronRuntime> {
  const relativeExecutable = executablePath(runtime.platform);
  const pathFile = path.join(runtime.packageRoot, 'path.txt');
  const hasPathFile = await exists(pathFile);
  if (hasPathFile) await inspectPathFile(pathFile, relativeExecutable);
  if (await exists(runtime.distRoot)) {
    try {
      await inspectRuntime(runtime);
    } catch (error) {
      throw new Error(
        `The existing Electron runtime was preserved: ${runtime.distRoot}. ` +
          (error as Error).message,
        { cause: error },
      );
    }
  } else {
    const archive = await runtimeArchive(runtime, options);
    // Electron's official extractor preserves framework symlinks and rejects escaping paths.
    // Loading it only for a new runtime also avoids an unnecessary native-addon policy dependency.
    const extract = options.extract ?? (await import('@electron-internal/extract-zip')).extract;
    await mkdir(runtime.distRoot, { mode: 0o755 });
    await extract(archive, { dir: runtime.distRoot });
    await inspectRuntime(runtime);
  }
  if (!hasPathFile) {
    try {
      await writeFile(pathFile, relativeExecutable, { flag: 'wx', mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await inspectPathFile(pathFile, relativeExecutable);
    }
  }
  return runtime;
}

/** The Electron a packaged macOS app runs: its framework's bundle version. */
export async function bundledElectronVersion(app: string): Promise<string> {
  const plist = path.join(
    app,
    'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist',
  );
  const { stdout } = await promisify(execFile)('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleVersion',
    plist,
  ]);
  return stdout.trim();
}

/** The electron package downloads its runtime lazily; bootstrap before reading its licenses or
 * application metadata. */
export function ensureElectronRuntime(options: ElectronRuntimeOptions): Promise<ElectronRuntime> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (!['darwin', 'mas', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch))
    return Promise.reject(new Error(`No supported Electron runtime for ${platform}/${arch}.`));
  const require = createRequire(path.join(options.appRoot, 'package.json'));
  const packageFile = require.resolve('electron/package.json');
  const { version } = require(packageFile) as { version: string };
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
    return Promise.reject(new Error('The installed Electron package must pin an exact version.'));
  const packageRoot = path.dirname(packageFile);
  const current = pending.get(packageRoot);
  if (current) {
    if (current.platform !== platform || current.arch !== arch)
      return Promise.reject(
        new Error('Another Electron platform is already being installed here.'),
      );
    return current.task;
  }
  const runtime: ElectronRuntime = {
    packageRoot,
    distRoot: path.join(packageRoot, 'dist'),
    executable: path.join(packageRoot, 'dist', executablePath(platform as RuntimePlatform)),
    version,
    platform: platform as RuntimePlatform,
    arch: arch as 'arm64' | 'x64',
  };
  const task = provision(runtime, options).finally(() => {
    if (pending.get(packageRoot)?.task === task) pending.delete(packageRoot);
  });
  pending.set(packageRoot, { platform, arch, task });
  return task;
}
