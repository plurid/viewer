import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { treeHash } from '../filesystem/fingerprints';
import { extractHeaderArchive, inspectHeaderArchive } from './archive';
import { downloadRetainedArtifact, expectedArchiveHash, type ArtifactFetcher } from './download';

export const electronHeadersDistribution = 'https://electronjs.org/headers';

export interface ElectronHeadersOptions {
  appRoot: string;
  electronVersion: string;
  arch: string;
  /** A cache root; each Electron version has a separate directory beneath it. */
  cacheRoot?: string;
  environment?: NodeJS.ProcessEnv;
  request?: ArtifactFetcher;
}

interface HeaderReceipt {
  version: 1;
  electronVersion: string;
  distribution: string;
  archiveSha256: string;
  headersSha256: string;
}

const receiptName = 'viewer-electron-headers.json';
const maximumArchiveBytes = 64 * 1024 * 1024;
const requiredHeaders = [
  'node.h',
  'node_version.h',
  'node_api.h',
  'js_native_api.h',
  'js_native_api_types.h',
  'config.gypi',
] as const;

const pending = new Map<string, Promise<string>>();

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function directory(file: string): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`The Electron header cache must use ordinary directories: ${file}`);
}

async function regularFile(file: string, limit: number): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > limit)
    throw new Error(`The Electron header cache contains an invalid file: ${file}`);
}

async function inspectHeaders(versionRoot: string): Promise<string> {
  await directory(versionRoot);
  await directory(path.join(versionRoot, 'include'));
  const headers = path.join(versionRoot, 'include', 'node');
  await directory(headers);
  for (const name of requiredHeaders) await regularFile(path.join(headers, name), 2_000_000);
  const config = await readFile(path.join(headers, 'config.gypi'), 'utf8');
  if (!/["']built_with_electron["']\s*:\s*1\b/.test(config))
    throw new Error(`The header cache does not contain Electron headers: ${versionRoot}`);
  return headers;
}

async function inspectCache(versionRoot: string, electronVersion: string): Promise<string> {
  const headers = await inspectHeaders(versionRoot);
  const receiptFile = path.join(versionRoot, receiptName);
  await regularFile(receiptFile, 4096);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8')) as Partial<HeaderReceipt>;
  if (
    receipt.version !== 1 ||
    receipt.electronVersion !== electronVersion ||
    receipt.distribution !== electronHeadersDistribution ||
    typeof receipt.archiveSha256 !== 'string' ||
    !/^[a-f\d]{64}$/.test(receipt.archiveSha256) ||
    typeof receipt.headersSha256 !== 'string' ||
    receipt.headersSha256 !== (await treeHash(path.join(versionRoot, 'include')))
  )
    throw new Error(`The Electron header cache failed its recorded fingerprint: ${versionRoot}`);
  return headers;
}

async function provision(options: ElectronHeadersOptions, cacheRoot: string): Promise<string> {
  try {
    await directory(cacheRoot);
  } catch (error) {
    if (!missing(error)) throw error;
    await mkdir(cacheRoot, { recursive: true });
    await directory(cacheRoot);
  }
  const canonicalRoot = await realpath(cacheRoot);
  const versionRoot = path.join(canonicalRoot, options.electronVersion);
  let exists = true;
  try {
    await lstat(versionRoot);
  } catch (error) {
    if (!missing(error)) throw error;
    exists = false;
  }
  if (exists) {
    try {
      return await inspectCache(versionRoot, options.electronVersion);
    } catch (error) {
      throw new Error(
        `Existing Electron headers were preserved at ${versionRoot}. ` +
          'Choose a fresh VIEWER_ELECTRON_HEADERS_CACHE to build. ' +
          (error as Error).message,
        { cause: error },
      );
    }
  }

  // Attempts, downloads and partial extraction remain available for diagnosis.
  // No node-gyp installer is called: it removes extraction folders and rolls back on failure.
  const attempts = path.join(canonicalRoot, 'downloads');
  try {
    await mkdir(attempts);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await directory(attempts);
  const attempt = path.join(attempts, options.electronVersion + '-' + randomUUID());
  await mkdir(attempt, { mode: 0o700 });
  const request = options.request ?? fetch;
  const base = electronHeadersDistribution + '/v' + options.electronVersion + '/';
  const checksums = path.join(attempt, 'SHASUMS256.txt');
  await downloadRetainedArtifact(base + 'SHASUMS256.txt', checksums, 512 * 1024, request);
  const archiveName = 'node-v' + options.electronVersion + '-headers.tar.gz';
  const expected = expectedArchiveHash(await readFile(checksums, 'utf8'), archiveName);
  const archive = path.join(attempt, archiveName);
  const actual = await downloadRetainedArtifact(
    base + archiveName,
    archive,
    maximumArchiveBytes,
    request,
  );
  if (actual !== expected)
    throw new Error(
      `Electron header archive checksum mismatch. Downloads were kept at ${attempt}.`,
    );
  const selected = await inspectHeaderArchive(archive);
  // An exclusive directory claim prevents this process from replacing an existing cache.
  await mkdir(versionRoot, { mode: 0o700 });
  await extractHeaderArchive(archive, versionRoot, selected);
  const headers = await inspectHeaders(versionRoot);
  const receipt: HeaderReceipt = {
    version: 1,
    electronVersion: options.electronVersion,
    distribution: electronHeadersDistribution,
    archiveSha256: actual,
    headersSha256: await treeHash(path.join(versionRoot, 'include')),
  };
  await writeFile(path.join(versionRoot, receiptName), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return headers;
}

/** A fresh build downloads verified Electron headers into its own retained cache. */
export function ensureElectronHeaders(options: ElectronHeadersOptions): Promise<string> {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(options.electronVersion))
    return Promise.reject(new Error('An exact Electron version is required for native headers.'));
  if (options.arch !== 'arm64' && options.arch !== 'x64')
    return Promise.reject(new Error('Native helpers support arm64 and x64 builds.'));
  const environment = options.environment ?? process.env;
  const cacheRoot = path.resolve(
    options.appRoot,
    options.cacheRoot ?? environment.VIEWER_ELECTRON_HEADERS_CACHE ?? 'out/native-cache/electron',
  );
  const key = JSON.stringify([cacheRoot, options.electronVersion]);
  const active = pending.get(key);
  if (active) return active;
  const task = provision(options, cacheRoot).finally(() => {
    if (pending.get(key) === task) pending.delete(key);
  });
  pending.set(key, task);
  return task;
}
