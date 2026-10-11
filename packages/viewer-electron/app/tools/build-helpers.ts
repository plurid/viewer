import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
if (process.platform === 'darwin') {
  mkdirSync('assets', { recursive: true });
  const cache = path.join(os.tmpdir(), `viewer-swift-cache-${process.getuid?.() || 'build'}`);
  mkdirSync(cache, { recursive: true });
  execFileSync(
    'xcrun',
    ['swiftc', '-module-cache-path', cache, '-O', 'tools/ocr.swift', '-o', 'assets/viewer-ocr'],
    {
      stdio: 'inherit',
    },
  );
  execFileSync(
    'xcrun',
    [
      'swiftc',
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
