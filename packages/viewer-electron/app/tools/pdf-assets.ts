import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { lookup } from 'mime-types';
import type { Plugin } from 'vite';

/** Keep PDF fonts, character maps, and decoders local in development and in ASAR. */
export function pdfAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const files = new Map<string, string>();
  let building = false;
  async function discover() {
    if (files.size) return;
    for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
      for (const file of await readdir(path.join(root, folder)))
        files.set(`/pdfjs/${folder}/${file}`, path.join(root, folder, file));
    }
  }
  return {
    name: 'viewer-local-pdf-assets',
    configResolved(config) {
      building = config.command === 'build';
    },
    async buildStart() {
      if (!building) return;
      await discover();
      for (const [url, file] of files)
        this.emitFile({ type: 'asset', fileName: url.slice(1), source: await readFile(file) });
    },
    async configureServer(server) {
      await discover();
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
        const file = files.get(pathname);
        if (!file) {
          next();
          return;
        }
        try {
          response.setHeader('Content-Type', lookup(file) || 'application/octet-stream');
          response.end(await readFile(file));
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
  };
}
