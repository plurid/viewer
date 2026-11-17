import { chmod, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * A private 0700 folder for Unix sockets. macOS allows 104 bytes for a socket path, which a long
 * TMPDIR can use up, so `/tmp` is the fallback, as for the agent broker's socket.
 *
 * @param longest the longest socket name the folder will hold, to check the budget before
 *   anything is created
 */
export async function privateSocketFolder(
  prefix: string,
  longest: string,
  validate: (file: string) => void,
  preferred = os.tmpdir(),
  fallback = '/tmp',
): Promise<string> {
  for (const parent of [preferred, fallback]) {
    try {
      validate(path.join(parent, prefix + 'XXXXXX', longest));
    } catch {
      continue;
    }
    const folder = await mkdtemp(path.join(parent, prefix));
    await chmod(folder, 0o700);
    return folder;
  }
  throw new Error('No temporary folder has a path short enough for a server connection socket.');
}
