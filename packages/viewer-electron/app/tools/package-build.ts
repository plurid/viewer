import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function buildDirectory(file: string) {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error(`${file} is a link. It was left as it is.`);
  if (info && !info.isDirectory())
    throw new Error(`${file} is not a build folder. It was left as it is.`);
  return info;
}

function requireConcreteArch(arch: string) {
  if (!['ia32', 'x64', 'armv7l', 'arm64', 'mips64el'].includes(arch))
    throw new Error('Choose one concrete architecture for each Viewer package.');
}

export async function requireNewPackage(root: string, platform: string, arch: string) {
  requireConcreteArch(arch);
  await buildDirectory(path.join(root, 'out'));
  for (const target of [
    path.join(root, '.vite'),
    path.join(root, 'out', `Viewer-${platform}-${arch}`),
  ]) {
    if (await buildDirectory(target))
      throw new Error(`Preserve this build folder in another location before packaging: ${target}`);
  }
}

/** Every build retains its ownership record. An interrupted wrapper may have live children,
 * so an unfinished run requires inspection before another build can use the same outputs. */
export async function packageBuild(
  root: string,
  platform: string,
  arch: string,
  build: (run: string) => Promise<void>,
  prepare?: () => Promise<void>,
  fromPackage = false,
) {
  requireConcreteArch(arch);
  const out = path.join(root, 'out');
  await buildDirectory(out);
  await mkdir(out, { recursive: true });
  const runs = path.join(out, 'package-runs');
  await buildDirectory(runs);
  await mkdir(runs, { recursive: true });
  const previous = (await readdir(runs))
    .filter((name) => /^[1-9]\d*$/.test(name))
    .reduce((latest, name) => Math.max(latest, Number(name)), 0);
  if (previous && !(await buildDirectory(path.join(runs, String(previous), 'finished'))))
    throw new Error(
      `A build owns these outputs. Check its run before retrying: ${path.join(runs, String(previous))}`,
    );
  const run = String(previous + 1);
  const directory = path.join(runs, run);
  await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new Error('Another build owns these outputs.');
    throw error;
  });
  try {
    await prepare?.();
    if (!fromPackage) await requireNewPackage(root, platform, arch);
    await build(run);
  } finally {
    await mkdir(path.join(directory, 'finished'));
  }
}

/** Raw Forge invocations must not race the wrapper's preflight or write its artifacts. */
export async function claimForgePhase(root: string, phase: 'prePackage' | 'preMake') {
  const run = process.env.VIEWER_PACKAGE_RUN ?? '';
  if (!/^[1-9]\d*$/.test(run))
    throw new Error('Use the Viewer package, make or Store build command.');
  const directory = path.join(root, 'out', 'package-runs', run);
  if (
    !(await buildDirectory(directory)) ||
    (await buildDirectory(path.join(directory, 'finished')))
  )
    throw new Error('The packaging run has ended.');
  await writeFile(path.join(directory, phase), '', { flag: 'wx' });
}
