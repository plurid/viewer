import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
if (process.platform === 'darwin') {
  mkdirSync('assets', { recursive: true });
  const cache = path.join(os.tmpdir(), `viewer-swift-cache-${process.getuid?.() || 'build'}`);
  mkdirSync(cache, { recursive: true });
  // Match Electron's macOS minimum rather than the build machine's SDK default.
  const require = createRequire(import.meta.url);
  const minimum = execFileSync(
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
  const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx${minimum}`;
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
