import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

/** Publish an atomic rename durably before acknowledging the owning write. */
export async function syncParentDirectory(file: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(
    path.dirname(file),
    constants.O_RDONLY | (constants.O_DIRECTORY || 0),
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
