import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
/** The portable copier must not delete originals carrying unsupported macOS metadata. */
export async function guardMoveMetadata(file: string, signal: AbortSignal): Promise<void> {
  if (process.platform !== 'darwin' || (await lstat(file)).isSymbolicLink()) return;
  const options = { signal, timeout: 10000, maxBuffer: 64 * 1024, encoding: 'utf8' as const };
  // Read attribute names and ACL presence only; never print file metadata or use a shell.
  const attributes = await execute('/usr/bin/xattr', [file], options);
  const acl = await execute('/bin/ls', ['-lde', file], options);
  if (attributes.stdout.trim() || /^\s*\d+:\s/m.test(acl.stdout)) {
    throw new Error(
      'This item has macOS metadata that Viewer cannot copy yet. The original has been kept. Use Finder for this cross-volume move.',
    );
  }
}
