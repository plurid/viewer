import { execFile } from 'node:child_process';
import { cp, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * A copy of a folder or file that shares the original's disk blocks until either changes: an APFS
 * clone. Release and acceptance builds keep many copies of the app; cloned, each costs a few
 * megabytes, not the app's 900 MB, and signing rewrites only the files it signs. Node's own copy
 * cannot clone on macOS, so the system's cp does, and copies where a volume cannot clone. Like
 * `cp(..., { errorOnExist: true })`, it never writes into an existing target.
 */
export async function cloneTree(source: string, target: string): Promise<void> {
  const exists = await lstat(target).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  // cp -R onto an existing folder copies into it
  if (exists) throw Object.assign(new Error(`${target} already exists.`), { code: 'EEXIST' });
  // as Node's copy does, missing parent folders are made
  await mkdir(path.dirname(target), { recursive: true });
  if (process.platform === 'darwin') {
    // -c clones, -R recurses, -P keeps links as links
    await run('/bin/cp', ['-c', '-R', '-P', source, target]);
    // A clone carries extended attributes, which Node's copy left out and code signing refuses
    // on bundle files: the clone's own are cleared, the source keeps its.
    await run('/usr/bin/xattr', ['-c', '-r', '-s', target]);
    return;
  }
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
  });
}
