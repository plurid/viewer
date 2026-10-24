import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function treeHash(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(relative: string): Promise<void> {
    const file = path.join(directory, relative);
    const info = await lstat(file);
    hash.update(
      JSON.stringify([
        relative,
        info.mode & 0o777,
        info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : 'file',
      ]),
    );
    if (info.isSymbolicLink()) hash.update(await readlink(file));
    else if (info.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
    } else hash.update(await hashFile(file));
  }
  await visit('');
  return hash.digest('hex');
}
