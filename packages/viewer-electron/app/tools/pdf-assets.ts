import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { localAssets } from './local-assets';

/** Keep PDF fonts, character maps, and decoders local in development and in ASAR. */
export function pdfAssets() {
  return localAssets('viewer-local-pdf-assets', async () => {
    const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    const files = new Map<string, string>();
    for (const folder of ['cmaps', 'standard_fonts', 'wasm'])
      for (const file of await readdir(path.join(root, folder)))
        files.set(`/pdfjs/${folder}/${file}`, path.join(root, folder, file));
    return files;
  });
}
