import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextAlphaVersion } from '../src/domain/updates/version';

export async function nextManifestVersion(file: string): Promise<string> {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const version = nextAlphaVersion(manifest.version);
  manifest.version = version;
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = fileURLToPath(new URL('../package.json', import.meta.url));
  console.log(await nextManifestVersion(file));
}
