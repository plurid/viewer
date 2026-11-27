import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { patchedNodePtySource } from './bundle-trim';
import { pdfRuntimeManifests } from './pdf-runtime';
import { buildDirectory, packageBuild, requireNewPackage } from './package-build';
import { execRelease, releaseEnvironment } from './release-environment';

export function assertMacPackagingArch(arch: string, nativeArch: string): void {
  if (!['arm64', 'x64'].includes(arch) || !['arm64', 'x64'].includes(nativeArch))
    throw new Error('Supported macOS build architectures are arm64 and x64.');
  if (arch !== nativeArch)
    throw new Error(
      `The packaging architecture ${arch} does not match the native resources (${nativeArch}).`,
    );
}

export function directSigningIdentity(input: string | undefined) {
  const identity = input?.trim();
  if (
    identity &&
    !/^[A-Fa-f0-9]{40}$/.test(identity) &&
    !identity.startsWith('Developer ID Application:')
  )
    throw new Error('VIEWER_DIRECT_IDENTITY must identify a Developer ID Application certificate.');
  return identity;
}

export function assertRetainedNotarization(profile: string | undefined): void {
  if (profile?.trim())
    throw new Error('Use pnpm direct:release to notarize and retain the submitted archive.');
}

export async function assertMakeOutputAvailable(out: string): Promise<void> {
  await buildDirectory(out);
  async function checkContents(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(out, file).split(path.sep).join('/');
      // MakerZIP clears its exact output even when a directory occupies that name.
      if (!entry.isDirectory() || !/^make\/zip(?:\/darwin(?:\/(?:arm64|x64))?)?$/.test(relative))
        throw new Error(`Move the prior output to another folder to preserve it: ${file}`);
      await checkContents(file);
    }
  }
  // Forge can rewrite or remove both the ZIP and its result manifest.
  for (const name of ['make', 'make-results']) {
    const directory = path.join(out, name);
    if (await buildDirectory(directory)) await checkContents(directory);
  }
}

/**
 * Forge clears these two destinations. The local macOS wrapper preserves them in the Trash
 * after its helpers succeed and before Forge starts.
 */
export async function trashPreviousBuild(
  appRoot: string,
  {
    platform,
    arch,
    trash,
    make,
  }: { platform: string; arch: string; trash(file: string): Promise<void>; make?: boolean },
): Promise<string[]> {
  if (platform !== 'darwin') throw new Error('This Trash exception applies to local macOS builds.');
  assertMacPackagingArch(arch, arch);
  const out = path.join(appRoot, 'out');
  await buildDirectory(out);
  if (make) await assertMakeOutputAvailable(out);
  const targets = [path.join(appRoot, '.vite'), path.join(out, `Viewer-${platform}-${arch}`)];
  const present: string[] = [];
  for (const target of targets) {
    if (await buildDirectory(target)) present.push(target);
  }
  for (const target of present) await trash(target);
  return present;
}

type BuildChild = (
  file: 'tsx' | 'electron-forge',
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;

async function checkForgeEntry(entry: string) {
  const script = await open(entry, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await script.stat()).isFile())
      throw new Error(`Expected a Forge CLI script at ${entry}.`);
  } finally {
    await script.close();
  }
}

async function moveToTrash(file: string) {
  await execRelease('/usr/bin/trash', [file]);
  console.log(`Moved the previous build to the Trash: ${file}`);
}

export async function localBuild(
  root: string,
  argv: string[],
  platform: string,
  arch: string,
  environment: NodeJS.ProcessEnv,
  child?: BuildChild,
  trash: (file: string) => Promise<void> = moveToTrash,
) {
  const [command, ...args] = argv;
  if (command !== 'package' && command !== 'make') throw new Error('Choose package or make.');
  const make = command === 'make';
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      arch: { type: 'string', short: 'a' },
      platform: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'V' },
      ...(make
        ? {
            targets: { type: 'string' as const },
            'from-package': { type: 'boolean' as const },
            'skip-package': { type: 'boolean' as const },
          }
        : {}),
    },
  });
  const env = releaseEnvironment(environment);
  const require = createRequire(path.join(root, 'package.json'));
  const forge = child
    ? undefined
    : path.resolve(
        path.dirname(require.resolve('@electron-forge/cli/package.json')),
        require('@electron-forge/cli/package.json').bin['electron-forge'],
      );
  const runChild: BuildChild =
    child ??
    (async (tool, args, env) => {
      const entry = tool === 'tsx' ? require.resolve('tsx/cli') : forge!;
      execFileSync(process.execPath, [entry, ...args], { cwd: root, env, stdio: 'inherit' });
    });
  if (values.help || values.version) return runChild('electron-forge', [command, ...args], env);
  if (
    positionals.length > 1 ||
    (positionals.length && path.resolve(root, positionals[0]!) !== root)
  )
    throw new Error('Local packaging runs in the Viewer app directory.');
  if (
    (values.platform && values.platform !== platform) ||
    (env.VIEWER_MAC_CHANNEL && env.VIEWER_MAC_CHANNEL !== 'direct')
  )
    throw new Error('Local packaging targets the host platform and the direct channel.');
  const targetArch = String(values.arch ?? arch);
  if (platform === 'darwin') {
    assertMacPackagingArch(arch, env.VIEWER_BUILD_ARCH ?? arch);
    assertMacPackagingArch(targetArch, arch);
  }
  directSigningIdentity(env.VIEWER_DIRECT_IDENTITY);
  assertRetainedNotarization(env.VIEWER_NOTARY_PROFILE);
  const fromPackage = !!(values['from-package'] || values['skip-package']);
  await packageBuild(
    root,
    platform,
    targetArch,
    (run) => runChild('electron-forge', [command, ...args], { ...env, VIEWER_PACKAGE_RUN: run }),
    async (run) => {
      if (make) await assertMakeOutputAvailable(path.join(root, 'out'));
      if (fromPackage) return;
      if (platform !== 'darwin') await requireNewPackage(root, platform, targetArch);
      await runChild('tsx', ['tools/build-helpers.ts'], { ...env, VIEWER_PACKAGE_RUN: run });
      if (platform === 'darwin') {
        await pdfRuntimeManifests(platform, targetArch, require);
        require.resolve('node-addon-api/package.json');
        const pty = path.dirname(require.resolve('node-pty/package.json'));
        await patchedNodePtySource(path.join(pty, 'src/unix/pty.cc'));
        if (make) {
          // Maker modules run with the same filtered environment as Forge.
          const checker = fileURLToPath(new URL('./make-targets.ts', import.meta.url));
          await execRelease(process.execPath, [checker, platform, String(values.targets ?? '')], {
            cwd: root,
            env: { ...env, VIEWER_PACKAGE_RUN: run },
          });
        }
        if (forge) await checkForgeEntry(forge);
        await trashPreviousBuild(root, { platform, arch: targetArch, trash, make });
      }
    },
    fromPackage,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await localBuild(root, process.argv.slice(2), process.platform, process.arch, process.env);
}
