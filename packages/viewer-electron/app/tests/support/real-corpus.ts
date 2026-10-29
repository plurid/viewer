import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RemoteSample } from '../../tools/playground/types';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { sha256 } from '../../tools/playground/files';

/** The playground, or a retained corpus with its relative sample paths. */
const corpus = path.resolve(process.env.VIEWER_TEST_REAL_CORPUS ?? defaultPlaygroundDirectory);
/** Whether the corpus holds a pinned sample; a test that reads one is skipped without it. */
export const holds = (sample: RemoteSample) => existsSync(path.join(corpus, sample.path));
/** A pinned sample's bytes, refused unless they are its pinned size and hash. */
export async function pinned(sample: RemoteSample): Promise<Buffer> {
  const bytes = await readFile(path.join(corpus, sample.path));
  if (bytes.length !== sample.size || sha256(bytes) !== sample.sha256)
    throw new Error(`${sample.path} is not the pinned sample.`);
  return bytes;
}
