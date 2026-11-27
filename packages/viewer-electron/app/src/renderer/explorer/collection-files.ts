import type { FileEntry } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';

export async function readCollectionFiles(paths: readonly string[]) {
  const items: FileEntry[] = [],
    errors: string[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, paths.length) }, async () => {
      while (cursor < paths.length) {
        const index = cursor++;
        const file = paths[index];
        if (file === undefined) break;
        try {
          items[index] = await window.viewer.stat(file);
        } catch (error) {
          errors.push(file + ': ' + errorMessage(error));
        }
      }
    }),
  );

  return { entries: items.filter(Boolean), errors };
}
