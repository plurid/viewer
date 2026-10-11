import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.platform === 'darwin') {
  mkdirSync('assets', { recursive: true });
  execFileSync('xcrun', ['swiftc', '-O', 'tools/ocr.swift', '-o', 'assets/viewer-ocr'], {
    stdio: 'inherit',
  });
}
