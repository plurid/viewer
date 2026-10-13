import { mkdtemp, lstat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { macFiles } from './macos-files';

/** Keep partial transfers in a private directory. Cleanup first claims the
 * original directory by rename and checks its inode; a replaced path is kept. */
export async function privateStage(directory: string, prefix: string) {
  const root = await mkdtemp(path.join(directory, prefix)),
    info = await lstat(root);
  const owned = async (file: string) => {
    const current = await lstat(file);
    return current.dev === info.dev && current.ino === info.ino && current.isDirectory();
  };
  const move = (source: string, destination: string) =>
    process.platform === 'darwin'
      ? macFiles().renameExclusive(source, destination)
      : rename(source, destination);
  return {
    file: path.join(root, 'item'),
    async dispose() {
      if (!(await owned(root)))
        throw new Error('The temporary transfer location changed. It was kept for inspection.');
      const cleanup = path.join(directory, prefix + 'cleanup-' + randomUUID());
      await move(root, cleanup);
      if (!(await owned(cleanup))) {
        await move(cleanup, root).catch(() => {});
        throw new Error(
          'The temporary transfer location changed during cleanup. Its contents were kept.',
        );
      }
      await rm(cleanup, { recursive: true });
    },
  };
}
