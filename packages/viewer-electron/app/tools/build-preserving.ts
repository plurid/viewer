/** Local rebuild from a direct package. Keeps every intermediate; never deletes. */
import { cp, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build, type UserConfig } from 'vite';
import { VitePlugin, type VitePluginConfig } from '@electron-forge/plugin-vite';
import forge from '../forge.config';
import { sourceHash, hashFile } from './qualification/source';
import { prepareOfficeRuntime, verifyOfficeRuntime } from './office-runtime';
import { officeRuntimeName } from '../src/desktop/previews/office-runtime-manifest';
import { documentTypes } from './document-types';

if (process.platform !== 'darwin') throw new Error('This local rebuild requires macOS.');
const source = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !source.endsWith('.app') || !(await lstat(source)).isDirectory())
  throw new Error('Provide an existing direct Viewer.app as the seed; it is kept unchanged.');
const output = path.resolve(process.argv[3] || 'out/Viewer-darwin-arm64/Viewer.app');
if (
  await lstat(output).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  )
)
  throw new Error(
    'Output already exists. Choose a new output or request approval to move it to Trash.',
  );
const require = createRequire(import.meta.url);
const cli = createRequire(require.resolve('@electron-forge/cli/package.json'));
const core = createRequire(cli.resolve('@electron-forge/core'));
const packager = createRequire(core.resolve('@electron/packager'));
const asar = (await import(pathToFileURL(packager.resolve('@electron/asar')).href)) as {
  extractAll(source: string, destination: string): void;
  createPackageWithOptions(
    source: string,
    destination: string,
    options: { unpack: string },
  ): Promise<void>;
  getRawHeader(file: string): { headerString: string };
};
const seedPackage = JSON.parse(
  asar.getRawHeader(path.join(source, 'Contents/Resources/app.asar')).headerString,
);
if (!seedPackage.files?.['.vite']) throw new Error('Seed is not a Viewer Vite package.');
const plugin = forge.plugins?.find((item) => item instanceof VitePlugin);
if (!plugin) throw new Error('The current Vite build configuration is unavailable.');
const config = (plugin as unknown as { config: VitePluginConfig }).config;
const viteBase = path.dirname(require.resolve('@electron-forge/plugin-vite'));
const generatorModule = (await import(
  pathToFileURL(path.join(viteBase, 'ViteConfig.js')).href
)) as {
  default: new (
    config: VitePluginConfig,
    root: string,
    production: boolean,
  ) => {
    getBuildConfigs(): Promise<UserConfig[]>;
    getRendererConfig(): Promise<UserConfig[]>;
  };
};
await mkdir(path.resolve('out'), { recursive: true });
const work = await mkdtemp(path.resolve('out/preserved-package-'));
const sourceBefore = await sourceHash(process.cwd());
const lockHash = await hashFile(path.resolve('../../../pnpm-lock.yaml'));
const generator = new generatorModule.default(config, process.cwd(), true);
for (const target of [
  ...(await generator.getBuildConfigs()),
  ...(await generator.getRendererConfig()),
]) {
  target.build = { ...target.build, emptyOutDir: false };
  target.logLevel = 'warn';
  await build(target);
}
const unpacked = path.join(work, 'source');
asar.extractAll(path.join(source, 'Contents/Resources/app.asar'), unpacked);
await cp(path.resolve('.vite'), path.join(unpacked, '.vite'), { recursive: true });
await mkdir(path.dirname(output), { recursive: true });
await cp(source, output, {
  recursive: true,
  force: false,
  errorOnExist: true,
  verbatimSymlinks: true,
});
// Current committed notices supplement inherited runtime notices in this new
// output only. Neither the seed nor source license files are modified.
await cp(path.resolve('assets/licenses'), path.join(output, 'Contents/Resources/licenses'), {
  recursive: true,
});
const officeRuntime = await prepareOfficeRuntime(process.cwd());
const officeOutput = path.join(output, 'Contents/Resources', officeRuntimeName);
if (
  await lstat(officeOutput).then(
    () => true,
    () => false,
  )
) {
  await verifyOfficeRuntime(officeOutput);
} else {
  await cp(officeRuntime, officeOutput, { recursive: true, force: false, errorOnExist: true });
}
// Optional freshly compiled N-API binding. Only the new output is changed;
// the seed and its native binary remain intact for rollback and comparison.
const nativeBinding = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
if (nativeBinding) {
  if (!(await lstat(nativeBinding)).isFile() || !nativeBinding.endsWith('.node'))
    throw new Error('Provide a compiled macOS N-API .node file.');
  await cp(nativeBinding, path.join(output, 'Contents/Resources/viewer-macos-files.node'));
  await promisify(execFile)('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    path.join(output, 'Contents/Resources/viewer-macos-files.node'),
  ]);
}
// An explicitly supplied freshly built RAW decoder is copied only into this new
// candidate. Preserve all seeds and validate every resource against its manifest.
const rawResources = process.argv[5] ? path.resolve(process.argv[5]) : undefined;
if (rawResources) {
  const name = path.basename(rawResources);
  if (
    name !== `viewer-raw-v3-darwin-${process.arch}` ||
    !(await lstat(rawResources)).isDirectory() ||
    (await lstat(rawResources)).isSymbolicLink()
  )
    throw new Error('Provide the matching reviewed RAW resource directory.');
  const manifest = JSON.parse(await readFile(path.join(rawResources, 'manifest.json'), 'utf8')) as {
    files: Record<string, string>;
  };
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (path.basename(file) !== file || !(await lstat(path.join(rawResources, file))).isFile())
      throw new Error('Invalid RAW resource manifest.');
    if (
      createHash('sha256')
        .update(await readFile(path.join(rawResources, file)))
        .digest('hex') !== digest
    )
      throw new Error('RAW resource checksum mismatch.');
  }
  await cp(rawResources, path.join(output, 'Contents/Resources', name), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}
const archive = path.join(output, 'Contents/Resources/app.asar');
await promisify(execFile)('/usr/bin/plutil', [
  '-replace',
  'CFBundleDocumentTypes',
  '-json',
  JSON.stringify(documentTypes),
  path.join(output, 'Contents/Info.plist'),
]);
const imageHelper = process.argv[6] ? path.resolve(process.argv[6]) : undefined;
if (imageHelper) {
  const info = await lstat(imageHelper);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    path.basename(imageHelper) !== 'viewer-image-preview'
  )
    throw new Error('Provide the compiled viewer-image-preview helper.');
  const target = path.join(output, 'Contents/Resources/viewer-image-preview');
  await cp(imageHelper, target, { force: false, errorOnExist: true });
  await promisify(execFile)('/usr/bin/codesign', ['--force', '--sign', '-', target]);
}
await asar.createPackageWithOptions(unpacked, archive, { unpack: '**/node-pty/**' });
const hash = createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
const run = promisify(execFile);
await run('/usr/libexec/PlistBuddy', [
  '-c',
  'Set :ElectronAsarIntegrity:Resources/app.asar:hash ' + hash,
  path.join(output, 'Contents/Info.plist'),
]);
// Electron 41+ also binds this plist map to a digest inside its framework.
// Reuse the installed packager's bounded patcher without its cleanup hooks.
const framework = path.join(output, 'Contents/Frameworks/Electron Framework.framework');
const version = await run('/usr/bin/plutil', [
  '-extract',
  'CFBundleVersion',
  'raw',
  '-o',
  '-',
  path.join(framework, 'Resources/Info.plist'),
]);
interface IntegrityContext {
  opts: { electronVersion: string; quiet: boolean };
  renamedAppPath: string;
  frameworkBundlePath: string;
  asarIntegrity: Record<string, { algorithm: string; hash: string }>;
}
const mac = (await import(
  pathToFileURL(path.join(path.dirname(core.resolve('@electron/packager')), 'mac.js')).href
)) as {
  MacApp: { prototype: { setIntegrityDigest(this: IntegrityContext): Promise<boolean> } };
};
if (
  await mac.MacApp.prototype.setIntegrityDigest.call({
    opts: { electronVersion: version.stdout.trim(), quiet: false },
    renamedAppPath: output,
    frameworkBundlePath: framework,
    asarIntegrity: { 'Resources/app.asar': { algorithm: 'SHA256', hash } },
  })
) {
  await run('/usr/bin/codesign', [
    '--sign',
    '-',
    '--force',
    '--deep',
    '--preserve-metadata=entitlements,requirements,flags,runtime',
    framework,
  ]);
}
await run('/usr/bin/codesign', [
  '--force',
  '--sign',
  '-',
  '--entitlements',
  path.resolve('assets/entitlements.mac.plist'),
  output,
]);
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', output]);
// Make the limited purpose explicit: native dependencies/SDK/signing are inherited.
await writeFile(
  path.join(work, 'result.json'),
  JSON.stringify(
    {
      output,
      sourceBefore,
      sourceAfter: await sourceHash(process.cwd()),
      lockHash,
      seed: source,
      scope: imageHelper
        ? 'Local direct rebuild with a fresh isolated image helper. Seed and intermediates preserved. Not a Store/distribution build.'
        : nativeBinding
          ? 'Local direct rebuild with the specified fresh N-API binding. Seed and intermediates preserved. Not a Store/distribution build.'
          : 'Local JS-only direct rebuild. Source seed and intermediates preserved. Not a Store/distribution build.',
      ...(nativeBinding ? { nativeBinding } : {}),
      ...(rawResources ? { rawResources } : {}),
      ...(imageHelper ? { imageHelper, imageHelperHash: await hashFile(imageHelper) } : {}),
      inheritedVersion: JSON.parse(await readFile(path.join(unpacked, 'package.json'), 'utf8'))
        .version,
    },
    null,
    2,
  ),
);
console.log('Built preserved local app:', output);
console.log('Preserved intermediate folder:', work);
