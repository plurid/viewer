import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  officeRuntimeFiles,
  officeRuntimeName,
} from '../src/desktop/previews/office-runtime-manifest';
import { verifyOfficeRuntime } from '../src/desktop/previews/office-assets';
export { verifyOfficeRuntime } from '../src/desktop/previews/office-assets';

/** Build time only. Nothing is fetched by the installed application. Existing
 * outputs are verified, never replaced or removed, including partial downloads. */
export async function prepareOfficeRuntime(appRoot: string): Promise<string> {
  const directory = path.join(appRoot, 'assets', officeRuntimeName);
  await mkdir(directory, { recursive: true });
  for (const [name, size, digest] of officeRuntimeFiles) {
    const file = path.join(directory, name);
    const present = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (present) continue; // Final verification refuses stale files and links.
    if (name === 'zeta.js' || name === 'zetaHelper.js') {
      const bytes = await readFile(path.join(appRoot, 'assets/vendor/zetajs-1.2.0', name));
      if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== digest)
        throw new Error('Review the vendored ZetaJS bridge checksum.');
      await copyFile(path.join(appRoot, 'assets/vendor/zetajs-1.2.0', name), file, 1);
      continue;
    }
    const response = await fetch(`https://cdn.zetaoffice.net/zetaoffice_latest/${name}`, {
      signal: AbortSignal.timeout(180000),
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`Office download failed: ${name}`);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > size) throw new Error(`Office download exceeds the pinned size: ${name}`);
      chunks.push(chunk);
    }
    // fetch decodes Content-Encoding. These pins concern the actual WASM/data,
    // never a compressed HTTP transfer saved under a misleading extension.
    const bytes = Buffer.concat(chunks);
    if (length !== size || createHash('sha256').update(bytes).digest('hex') !== digest)
      throw new Error(`Office download differs from the reviewed build: ${name}`);
    await writeFile(file, bytes, { flag: 'wx' });
  }
  await verifyOfficeRuntime(directory);
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareOfficeRuntime(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log('Bundled Office runtime verified.');
}
