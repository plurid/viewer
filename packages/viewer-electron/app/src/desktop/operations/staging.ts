import { mkdtemp, lstat, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { macFiles } from '../native/macos-files';
import { removeEmptyDirectory } from './removal';

/** Keep partial transfers in a private directory. Cleanup removes it only while
 * it is the same, empty directory. Leftover partial content is claimed by rename,
 * checked by inode and moved to the Trash; without a Trash it is kept and its
 * path returned. Nothing in a stage is permanently deleted. */
export async function privateStage(
  directory: string,
  prefix: string,
  trash?: (file: string) => Promise<unknown>,
) {
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
    /** Resolves with the path of partial content kept for inspection, if any. */
    async dispose(): Promise<string | undefined> {
      if (!(await owned(root)))
        throw new Error('The temporary transfer location changed. It was kept for inspection.');
      if (process.env.VIEWER_TEST_NO_REMOVAL === '1' || process.env.VIEWER_TEST_PRESERVE === '1') {
        // Successful publication leaves only an empty artifact. Partial content remains at
        // its original generated path and is reported without invoking a removal adapter.
        return (await readdir(root)).length ? root : undefined;
      }
      try {
        await removeEmptyDirectory(root);
        return;
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error;
      }
      // A visible name: hidden folders in the Trash would use space unnoticed.
      const cleanup = path.join(
        directory,
        'Viewer incomplete transfer ' + randomUUID().slice(0, 8),
      );
      await move(root, cleanup);
      if (!(await owned(cleanup))) {
        await move(cleanup, root).catch(() => {});
        throw new Error(
          'The temporary transfer location changed during cleanup. Its contents were kept.',
        );
      }
      if (!trash) return cleanup;
      try {
        await trash(cleanup);
      } catch {
        return cleanup;
      }
      // An adapter can resolve without moving anything; report what actually remains.
      return (await lstat(cleanup).catch(() => null)) ? cleanup : undefined;
    },
  };
}
