import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashFile, treeHash } from '../filesystem/fingerprints';

export { hashFile, treeHash } from '../filesystem/fingerprints';

const sourceAssets = [
  'assets/icon.png',
  'assets/icon.icns',
  'assets/512x512.png',
  'assets/entitlements.mac.plist',
  'assets/licenses/README.txt',
  'assets/licenses/whisper-cpp.txt',
  'assets/licenses/opencascade.txt',
  'assets/licenses/occt-import-js.txt',
  'assets/licenses/ssf-0.11.2.txt',
  'assets/licenses/sam-parser-0.1.0.txt',
  'assets/vendor/ssf-0.11.2.mjs',
  'assets/vendor/ssf-0.11.2.d.mts',
  'assets/vendor/ssf-0.11.2.json',
  'assets/vendor/zetajs-1.2.0/zeta.js',
  'assets/vendor/zetajs-1.2.0/zetaHelper.js',
  'assets/licenses/zetajs-1.2.0.txt',
  'assets/licenses/libreoffice-mpl-2.0.txt',
  'assets/licenses/libreoffice-24.2-notices.xml',
] as const;

async function optionalFileHash(hash: ReturnType<typeof createHash>, file: string, name: string) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Qualification configuration must be a regular file: ${file}`);
    hash.update(JSON.stringify([name, 'present', await hashFile(file)]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    hash.update(JSON.stringify([name, 'absent']));
  }
}

/** Includes workspace policy and the presence of optional install configuration. */
export async function sourceHash(appRoot: string): Promise<string> {
  const hash = createHash('sha256');
  for (const name of ['src', 'tests', 'tools'])
    hash.update(name + (await treeHash(path.join(appRoot, name))));
  for (const file of sourceAssets) hash.update(file + (await hashFile(path.join(appRoot, file))));
  const files = (await readdir(appRoot))
    .filter((name) => /\.(ts|json|mjs|html)$/.test(name))
    .sort();
  for (const file of [
    ...files,
    '../../../pnpm-lock.yaml',
    '../../../package.json',
    '../../../pnpm-workspace.yaml',
  ])
    hash.update(file + (await hashFile(path.join(appRoot, file))));
  for (const file of ['../../../.npmrc', '.npmrc'])
    await optionalFileHash(hash, path.join(appRoot, file), file);
  return hash.digest('hex');
}
