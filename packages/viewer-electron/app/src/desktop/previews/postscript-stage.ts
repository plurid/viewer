import { readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { privateStage } from '../operations/staging';
import { renameExclusive } from '../operations/rename-exclusive';
import { lstat } from '../files/stats';
import { sameItem } from '../files/item-identity';
import { scratchBytes } from '../transforms/process';

export interface PostScriptStageOptions {
  directory?: string;
  trash?(file: string): Promise<unknown>;
  stage?: typeof privateStage;
}

export class PostScriptStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostScriptStageError';
  }
}

/** Only interpreter scratch can reach the Trash; normal completion disposes an empty stage. */
export async function withPostScriptStage<T>(
  options: PostScriptStageOptions,
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const stage = await (options.stage ?? privateStage)(
    options.directory ?? os.tmpdir(),
    'viewer-ghostscript-',
  );
  const directory = path.dirname(stage.file);
  const original = await lstat(directory);
  let completed = false;
  try {
    const value = await run(directory);
    completed = true;
    return value;
  } finally {
    const current = await lstat(directory);
    if (current.isSymbolicLink() || !current.isDirectory() || !sameItem(original, current))
      throw new PostScriptStageError('The Ghostscript scratch folder changed and was kept.');
    if (!(await readdir(directory)).length) {
      await stage.dispose();
    } else {
      try {
        await scratchBytes(directory);
      } catch {
        throw new PostScriptStageError(
          'The Ghostscript scratch folder could not be safely checked and was kept.',
        );
      }
      const retained = path.join(
        path.dirname(directory),
        'Viewer Ghostscript scratch ' + randomUUID(),
      );
      await renameExclusive(directory, retained);
      const moved = await lstat(retained);
      if (!sameItem(original, moved) || moved.isSymbolicLink())
        throw new PostScriptStageError('The Ghostscript scratch folder changed and was kept.');
      if (!options.trash)
        throw new PostScriptStageError(
          'Ghostscript’s temporary files were kept because Viewer couldn’t move them to the Trash.',
        );
      try {
        await options.trash(retained);
        if (
          await lstat(retained).then(
            () => true,
            () => false,
          )
        )
          throw new Error('Scratch remains.');
      } catch {
        throw new PostScriptStageError(
          'Ghostscript scratch could not be moved to Trash and was kept.',
        );
      }
      if (completed)
        throw new PostScriptStageError(
          'Ghostscript left scratch behind after rendering; the scratch was moved to Trash.',
        );
    }
  }
}
