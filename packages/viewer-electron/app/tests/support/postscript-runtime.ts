import { mkdir, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { vi } from 'vitest';
import { privateStage } from '../../src/desktop/operations/staging';
import type { PostScriptStageOptions } from '../../src/desktop/previews/postscript-stage';

/** Exercise preview disposal without deleting artifacts or touching the operating-system Trash. */
export function recordingPostScriptStage(root: string) {
  const stages: string[] = [];
  const empty: string[] = [];
  const retained: string[] = [];
  const trash = vi.fn(async (file: string) => {
    const directory = path.join(root, 'recorded-trash');
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, path.basename(file));
    await rename(file, target);
    retained.push(target);
  });
  const stage: typeof privateStage = async (directory, prefix) => {
    const value = await privateStage(directory, prefix);
    const created = path.dirname(value.file);
    stages.push(created);
    return {
      file: value.file,
      dispose: async () => {
        if ((await readdir(created)).length)
          throw new Error('Only an empty stage may be disposed.');
        empty.push(created);
        return undefined;
      },
    };
  };
  const options: PostScriptStageOptions = { directory: root, trash, stage };
  return { options, stages, empty, retained, trash };
}
