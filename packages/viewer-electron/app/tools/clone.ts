import { cp, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execRelease as run } from './release-environment';

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

/** A new output can have several missing parents below a link back into the seed. */
export async function assertOutsideSeed(seed: string, output: string) {
  const source = await realpath(seed);
  let parent = path.dirname(path.resolve(output));
  for (;;) {
    try {
      const existing = await realpath(parent);
      if (existing === source || existing.startsWith(source + path.sep))
        throw new Error('Choose an output outside the seed bundle.');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      parent = path.dirname(parent);
    }
  }
}

/** The prepared runtime replaces only the matching resource in the new bundle. Clone
 * sibling trees whole so framework symlinks and APFS cloning are preserved. */
export async function cloneWithSpeechRuntime(seed: string, output: string, runtime: string) {
  await assertOutsideSeed(seed, output);
  async function copyDirectory(source: string, target: string, parents: string[]) {
    if (!(await lstat(source)).isDirectory())
      throw new Error('The seed bundle must contain ordinary Contents and Resources directories.');
    await mkdir(target);
    const child = parents[0] ?? path.basename(runtime);
    for (const name of await readdir(source)) {
      if (name !== child) await cloneTree(path.join(source, name), path.join(target, name));
    }
    if (parents.length)
      await copyDirectory(path.join(source, child), path.join(target, child), parents.slice(1));
    else await cloneTree(runtime, path.join(target, child));
  }
  await copyDirectory(seed, output, ['Contents', 'Resources']);
}
