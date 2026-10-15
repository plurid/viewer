import { readFile } from 'node:fs/promises';
import { lookup } from 'mime-types';
import type { Plugin } from 'vite';

/** Serves package files at fixed app URLs in development and emits them into the build,
 * so libraries load their data and WebAssembly locally, never from a network. */
export function localAssets(name: string, discover: () => Promise<Map<string, string>>): Plugin {
  let files: Map<string, string> | undefined;
  let building = false;
  const known = async () => (files ??= await discover());
  return {
    name,
    configResolved(config) {
      building = config.command === 'build';
    },
    async buildStart() {
      if (!building) return;
      for (const [url, file] of await known())
        this.emitFile({ type: 'asset', fileName: url.slice(1), source: await readFile(file) });
    },
    async configureServer(server) {
      const served = await known();
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
        const file = served.get(pathname);
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
