import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface ReleasePlan {
  direct: string[];
  versions: Record<string, string>;
}
export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
export interface InstalledPackage {
  manifest: PackageManifest;
  directory: string;
}
export interface RegistryPackage extends PackageManifest {
  dist: { integrity: string; tarball: string };
}

export function updatedManifest<T extends { dependencies?: Record<string, string> }>(
  manifest: T,
  plan: ReleasePlan,
): T {
  const result = structuredClone(manifest);
  for (const name of plan.direct) {
    if (!result.dependencies?.[name] || !plan.versions[name])
      throw new Error(`Missing direct Plurid dependency: ${name}`);
    result.dependencies[name] = plan.versions[name];
  }
  return result;
}

export async function registryPackage(name: string, version: string): Promise<RegistryPackage> {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } },
  );
  if (!response.ok)
    throw new Error(
      `${name}@${version} is unavailable (HTTP ${response.status}). Publish Plurid before updating Viewer.`,
    );
  const data = (await response.json()) as RegistryPackage;
  if (data.name !== name || data.version !== version || !data.dist?.integrity || !data.dist.tarball)
    throw new Error(`Invalid registry metadata: ${name}@${version}`);
  return data;
}

export function inspectInstall(
  app: string,
  workspace: string,
  plan: ReleasePlan,
): InstalledPackage[] {
  const manifest = JSON.parse(
    readFileSync(path.join(app, 'package.json'), 'utf8'),
  ) as PackageManifest;
  for (const name of plan.direct)
    if (manifest.dependencies?.[name] !== plan.versions[name])
      throw new Error(
        `Pin ${name} to ${plan.versions[name]} with pnpm plurid:update after publishing.`,
      );
  const installation = path.join(workspace, 'node_modules');
  if (lstatSync(installation).isSymbolicLink())
    throw new Error(`Plurid local link replaces node_modules: ${installation}`);
  const nodeModules = realpathSync(installation);
  const pending = plan.direct.map((name) => ({ name, from: path.join(app, 'package.json') }));
  const visited = new Set<string>();
  const installed: InstalledPackage[] = [];
  for (const { name, from } of pending) {
    const entry = createRequire(from).resolve(name);
    let directory = path.dirname(realpathSync(entry));
    // Resolve from each package, so a stale nested copy cannot hide behind a correct root copy.
    while (!existsSync(path.join(directory, 'package.json'))) {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`Cannot find installed manifest: ${name}`);
      directory = parent;
    }
    const relative = path.relative(nodeModules, directory);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    )
      throw new Error(`Plurid local link outside this installation: ${directory}`);
    if (visited.has(directory)) continue;
    visited.add(directory);
    const data = JSON.parse(
      readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ) as PackageManifest;
    if (data.name !== name || data.version !== plan.versions[name])
      throw new Error(
        `Unexpected Plurid package: ${data.name}@${data.version}; expected ${name}@${plan.versions[name]}`,
      );
    for (const stamp of ['.synced-from.json', 'distribution/.synced-from.json'])
      if (existsSync(path.join(directory, stamp)))
        throw new Error(
          `Source-synced package cannot qualify: ${path.join(directory, stamp)}. Use a fresh checkout and package store.`,
        );
    installed.push({ manifest: data, directory });
    for (const dependency of new Set([
      ...Object.keys(data.dependencies ?? {}),
      ...Object.keys(data.peerDependencies ?? {}).filter(
        (dependency) => !data.peerDependenciesMeta?.[dependency]?.optional,
      ),
    ])) {
      if (!dependency.startsWith('@plurid/')) continue;
      if (!plan.versions[dependency]) throw new Error(`Unplanned Plurid dependency: ${dependency}`);
      pending.push({ name: dependency, from: path.join(directory, 'package.json') });
    }
  }
  return installed;
}

/** Compare actual installed outputs to the registry bytes, catching unstamped overlays too. */
export function verifyDistribution(
  installed: InstalledPackage,
  tarball: Buffer,
  integrity: string,
) {
  const actual = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
  if (actual !== integrity)
    throw new Error(`Registry integrity mismatch: ${installed.manifest.name}`);
  const tar = gunzipSync(tarball);
  const expected = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const file = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!file) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
      throw new Error('Invalid registry tarball');
    if (file.startsWith('package/distribution/') && (header[156] === 0 || header[156] === 48))
      expected.set(
        file.slice('package/distribution/'.length),
        tar.subarray(offset + 512, offset + 512 + size),
      );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!expected.size) throw new Error(`Missing packed distribution: ${installed.manifest.name}`);
  function visit(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected distribution symlink: ${file}`);
      if (entry.isDirectory()) visit(file, relative + '/');
      else {
        const bytes = expected.get(relative);
        if (!bytes || !readFileSync(file).equals(bytes))
          throw new Error(`Installed output differs from registry: ${file}`);
        expected.delete(relative);
      }
    }
  }
  visit(path.join(installed.directory, 'distribution'));
  if (expected.size)
    throw new Error(`Missing installed outputs: ${[...expected.keys()].join(', ')}`);
}
