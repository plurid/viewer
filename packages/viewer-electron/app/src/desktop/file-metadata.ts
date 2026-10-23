import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { macFiles } from './macos-files';

/** A saved file keeps its Finder tags, comments, extended attributes and mode. */
export async function keepMetadata(file: string, output: FileHandle): Promise<void> {
  const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!input) return;
  try {
    if (process.platform === 'darwin')
      try {
        await macFiles().copyMetadata(input.fd, output.fd);
        return;
      } catch {
        // Keep at least the permissions below.
      }
    await output.chmod((await input.stat()).mode & 0o777);
  } finally {
    await input.close();
  }
}
