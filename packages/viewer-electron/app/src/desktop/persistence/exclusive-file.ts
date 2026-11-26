import { randomUUID } from 'node:crypto';
import { link, open } from 'node:fs/promises';
import path from 'node:path';
import { discardOwnTemporaryFile } from '../operations/removal';
import { renameExclusive } from '../operations/rename-exclusive';
import { syncParentDirectory } from './directory-sync';

/** A failed write must never claim a destination that a later restore needs to create. */
export async function publishExclusiveFile(
  file: string,
  bytes: string | Buffer,
  published?: () => void,
): Promise<void> {
  const temporary = path.join(path.dirname(file), '.viewer-' + randomUUID() + '.tmp');
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform === 'darwin') await renameExclusive(temporary, file);
    else await link(temporary, file);
    published?.();
    await syncParentDirectory(file);
  } finally {
    await discardOwnTemporaryFile(temporary);
  }
}
