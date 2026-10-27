import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  officeRuntimeFiles,
  officeRuntimeName,
  officeEngineFiles,
  officeEngineName,
} from '../src/desktop/previews/office-runtime-manifest';
import type { OfficeAssetPin } from '../src/desktop/previews/office-runtime-manifest';
import { verifyOfficeRuntime, verifyOfficeEngine } from '../src/desktop/previews/office-assets';
import { officeFontCache, officeFonts } from '../src/desktop/previews/office-font-manifest';
import { appendOfficeData, officeFontMetadata } from './office-font-package';
import { hashFile } from './qualification/source';
export { verifyOfficeRuntime } from '../src/desktop/previews/office-assets';

/** Build time only. Nothing is fetched by the installed application. Existing
 * outputs are verified, never replaced or removed, including partial downloads. */
async function prepareOfficeEngine(appRoot: string): Promise<string> {
  const directory = path.join(appRoot, 'assets', officeEngineName);
  await assetDirectory(directory);
  for (const [name, size, digest] of officeEngineFiles) {
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
    await downloadPinned(
      file,
      [name, size, digest],
      `https://cdn.zetaoffice.net/zetaoffice_latest/${name}`,
    );
  }
  await verifyOfficeEngine(directory);
  return directory;
}

async function assetDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Invalid Office asset folder. Preserve it for inspection.');
}

async function downloadPinned(file: string, pin: OfficeAssetPin, url: string): Promise<void> {
  const [name, size, digest] = pin;
  const response = await fetch(url, {
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

/** Compose a new, pinned filesystem package. Upstream binaries and existing caches
 * remain unchanged; installing a font into the host operating system is unnecessary. */
export async function prepareOfficeRuntime(appRoot: string): Promise<string> {
  const directory = path.join(appRoot, 'assets', officeRuntimeName);
  const present = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (present) {
    await verifyOfficeRuntime(directory);
    return directory;
  }
  const engine = await prepareOfficeEngine(appRoot);
  const fontDirectory = path.join(appRoot, 'assets', officeFontCache);
  await assetDirectory(fontDirectory);
  for (const font of officeFonts) {
    const file = path.join(fontDirectory, font.name);
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) await downloadPinned(file, [font.name, font.bytes, font.sha256], font.url);
    const stored = await lstat(file);
    if (
      !stored.isFile() ||
      stored.isSymbolicLink() ||
      stored.size !== font.bytes ||
      (await hashFile(file)) !== font.sha256
    )
      throw new Error('Bundled Office font differs from its reviewed source: ' + font.name);
  }
  const metadata = officeFontMetadata(
    JSON.parse(await readFile(path.join(engine, 'soffice.data.js.metadata'), 'utf8')),
    officeFonts,
  );
  const metadataPin = officeRuntimeFiles.find(([name]) => name === 'soffice.data.js.metadata')!;
  if (
    metadata.length !== metadataPin[1] ||
    createHash('sha256').update(metadata).digest('hex') !== metadataPin[2]
  )
    throw new Error('The composed Office font metadata differs from its reviewed package.');
  await mkdir(directory);
  for (const [name] of officeRuntimeFiles) {
    if (name === 'soffice.data')
      await appendOfficeData(path.join(directory, name), [
        path.join(engine, name),
        ...officeFonts.map((font) => path.join(fontDirectory, font.name)),
      ]);
    else if (name === 'soffice.data.js.metadata')
      await writeFile(path.join(directory, name), metadata, { flag: 'wx' });
    else await copyFile(path.join(engine, name), path.join(directory, name), 1);
  }
  await verifyOfficeRuntime(directory);
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareOfficeRuntime(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log('Bundled Office runtime verified.');
}
