import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { prepareSpeechRuntime } from './speech-runtime';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { licenseInventory } from './licenses';
import { ensureElectronHeaders } from './native-build/headers';
import { prepareProcessors } from './processors';
import { preparePDFProcessors } from './pdf-processors';
import { prepareRawProcessor } from './libraw';
import { prepareOfficeRuntime } from './office-runtime';
import { compatibleMacOSMinimum, macOSMinimum } from './native-build/macos-target';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = await licenseInventory();
await prepareOfficeRuntime(appRoot);
if (process.platform === 'darwin') {
  await prepareSpeechRuntime(appRoot);
  mkdirSync('assets', { recursive: true });
  const cache = path.join(os.tmpdir(), `viewer-swift-cache-${process.getuid?.() || 'build'}`);
  mkdirSync(cache, { recursive: true });
  // Build for Viewer's macOS minimum rather than the build machine's SDK default. Electron's
  // own minimum must not be newer, or the app would claim a macOS it cannot run on.
  const require = createRequire(import.meta.url);
  const electronMinimum = execFileSync(
    '/usr/libexec/PlistBuddy',
    [
      '-c',
      'Print :LSMinimumSystemVersion',
      path.join(
        path.dirname(require.resolve('electron/package.json')),
        'dist/Electron.app/Contents/Info.plist',
      ),
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!compatibleMacOSMinimum(electronMinimum, macOSMinimum))
    throw new Error(
      `Electron needs macOS ${electronMinimum}; raise macOSMinimum in tools/native-build/macos-target.ts.`,
    );
  const minimum = macOSMinimum;
  const arch = process.env.VIEWER_BUILD_ARCH ?? process.arch;
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error('Native helpers support arm64 and x64 builds.');
  const target = `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx${minimum}`;
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-target',
      target,
      '-module-cache-path',
      cache,
      '-O',
      'tools/image-preview.swift',
      '-o',
      'assets/viewer-image-preview',
    ],
    { stdio: 'inherit' },
  );
  await prepareProcessors(minimum, arch);
  await preparePDFProcessors(minimum, arch);
  await prepareRawProcessor(minimum, arch);
  const headers = await ensureElectronHeaders({
    appRoot,
    electronVersion: inventory.electron,
    arch,
  });
  execFileSync(
    'xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-target',
      target,
      '-I',
      headers,
      '-framework',
      'Foundation',
      '-framework',
      'AppKit',
      '-framework',
      'Quartz',
      '-framework',
      'Security',
      'tools/macos-files.mm',
      '-o',
      'assets/viewer-macos-files.node',
    ],
    { stdio: 'inherit' },
  );
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-target',
      target,
      '-module-cache-path',
      cache,
      '-O',
      'tools/ocr.swift',
      '-o',
      'assets/viewer-ocr',
    ],
    {
      stdio: 'inherit',
    },
  );
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-target',
      target,
      '-module-cache-path',
      cache,
      '-O',
      'tools/applications.swift',
      '-o',
      'assets/viewer-applications',
    ],
    { stdio: 'inherit' },
  );
}
