import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * A rebuild trashes the previous build. Forge deletes `.vite` and its output folder before
 * writing new ones, which AGENTS.md forbids, so each rebuild waited for those two to be trashed by
 * hand. Packaging now first moves exactly those two to the system Trash (AGENTS.md names this
 * exception). A link in their place, or a Trash that fails, stops the build: nothing is deleted.
 */
export async function trashPreviousBuild(
  appRoot: string,
  { platform, arch, trash }: { platform: string; arch: string; trash(file: string): Promise<void> },
): Promise<string[]> {
  const targets = [
    path.join(appRoot, '.vite'),
    path.join(appRoot, 'out', `Viewer-${platform}-${arch}`),
  ];
  const present: string[] = [];
  for (const target of targets) {
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) continue;
    if (info.isSymbolicLink())
      throw new Error(`${target} is a link, not a previous build. It was left as it is.`);
    if (!info.isDirectory())
      throw new Error(`${target} is not a build folder. It was left as it is.`);
    present.push(target);
  }
  for (const target of present) await trash(target);
  return present;
}

const run = promisify(execFile);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') {
    console.log('The previous build is moved to the Trash on macOS only; nothing was moved.');
  } else {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const moved = await trashPreviousBuild(appRoot, {
      platform: process.platform,
      arch: process.env.VIEWER_BUILD_ARCH ?? process.arch,
      trash: async (file) => {
        await run('/usr/bin/trash', [file]);
      },
    });
    for (const file of moved) console.log(`Moved the previous build to the Trash: ${file}`);
  }
}
