import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { absolute } from '../files/filesystem';
import { fileCoordination } from '../files/file-coordination';

/** A batch's explicit source root determines only relative output folders. */
export function optimizationSubfolder(root: string, source: string): string {
  root = absolute(root);
  source = absolute(source);
  if (path.dirname(root) === root)
    throw new Error('Choose a source folder below the volume root to preserve folders.');
  const relative = path.relative(root, path.dirname(source));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep))
    throw new Error('Every source must be inside the selected batch folder.');
  return relative;
}

/** Create only the reviewed relative folders, under a short coordination claim.
 * Never follow a pre-existing link inside the output tree. Encoding holds no folder claim. */
export async function optimizationFolder(
  destination: string,
  relative: string,
  access: (files: readonly string[]) => Promise<void>,
): Promise<string> {
  destination = absolute(destination);
  await access([destination]);
  const root = await realpath(destination);
  await access([root]);
  const parts = relative ? relative.split(path.sep) : [];
  if (parts.length > 64 || parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('The batch output folder is invalid or too deeply nested.');
  return fileCoordination.run([{ path: root, mode: 'write' }], async () => {
    if (fileCoordination.path(root) !== root)
      throw new Error('The output folder moved during preparation. Choose it again.');
    let folder = root;
    for (const part of ['', ...parts]) {
      if (part) folder = path.join(folder, part);
      await access([folder]);
      let info = await lstat(folder).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!info) {
        await mkdir(folder).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
        info = await lstat(folder);
      }
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(folder)) !== folder)
        throw new Error('An output folder is a link or changed on disk. Choose another folder.');
    }
    await access([folder]);
    return folder;
  });
}
