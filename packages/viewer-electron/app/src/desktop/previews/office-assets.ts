import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { officeEngineFiles, officeRuntimeFiles } from './office-runtime-manifest';
import type { OfficeAssetPin } from './office-runtime-manifest';

export async function verifyOfficeRuntime(directory: string): Promise<void> {
  return verifyAssets(directory, officeRuntimeFiles);
}
export async function verifyOfficeEngine(directory: string): Promise<void> {
  return verifyAssets(directory, officeEngineFiles);
}
async function verifyAssets(directory: string, files: readonly OfficeAssetPin[]): Promise<void> {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error('Invalid Office runtime folder.');
  for (const [name, size, digest] of files) {
    const file = path.join(directory, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== size)
      throw new Error(`Invalid bundled Office asset: ${name}`);
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    if (hash.digest('hex') !== digest) throw new Error(`Office asset checksum mismatch: ${name}`);
  }
}
