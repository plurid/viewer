import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { speechRuntimeName } from './runtime-manifest';

/** Signing changes Mach-O bytes. A sealed package authenticates the signed files and manifest
 * together; loose development resources must still match their original byte checksums. */
export async function verifySpeechPackage(directory: string): Promise<void> {
  const resources = path.dirname(directory),
    contents = path.dirname(resources),
    bundle = path.dirname(contents);
  if (
    process.platform !== 'darwin' ||
    path.basename(directory) !== speechRuntimeName() ||
    path.basename(resources) !== 'Resources' ||
    path.basename(contents) !== 'Contents' ||
    !bundle.endsWith('.app')
  )
    throw new Error('The speech engine resource checksum differs.');
  for (const folder of [resources, contents, bundle]) {
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('The signed speech package must use ordinary folders.');
  }
  try {
    await promisify(execFile)('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
      timeout: 15000,
      maxBuffer: 32768,
      env: { PATH: '/usr/bin:/bin' },
    });
  } catch {
    throw new Error('The signed speech package could not be verified. Reinstall Viewer.');
  }
}
