import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { alphaVersionSchema } from '../src/domain/updates/version';

/** Packager stamps the Store number, but Electron reads the alpha version from this manifest. */
export async function restoreAlphaVersion(buildPath: string, version: string): Promise<void> {
  const alpha = alphaVersionSchema.parse(version);
  const file = path.join(buildPath, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.version = alpha;
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
