import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cloneTree } from './clone';

export async function pdfRuntimeManifests(platform: string, arch: string, require: NodeJS.Require) {
  const pdf = require.resolve('pdfjs-dist/package.json');
  const canvas = createRequire(pdf).resolve('@napi-rs/canvas/package.json');
  const canvasRequire = createRequire(canvas);
  const metadata = JSON.parse(await readFile(canvas, 'utf8')) as {
    optionalDependencies: Record<string, string>;
  };
  const nativePackages: string[] = [];
  for (const dependency of Object.keys(metadata.optionalDependencies)) {
    let manifest: string;
    try {
      manifest = canvasRequire.resolve(dependency + '/package.json');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    const target = JSON.parse(await readFile(manifest, 'utf8')) as {
      os: string[];
      cpu: string[];
    };
    if (target.os.includes(platform === 'mas' ? 'darwin' : platform) && target.cpu.includes(arch)) {
      canvasRequire.resolve(dependency);
      nativePackages.push(manifest);
    }
  }
  if (!nativePackages.length)
    throw new Error(`Install PDF.js's canvas native dependency for ${platform}/${arch}.`);
  return [pdf, canvas, ...nativePackages];
}

/** Preserve PDF.js's ESM/import.meta.url and its Node canvas polyfills in the app. */
export async function copyPDFRuntime(
  buildPath: string,
  platform: string,
  arch: string,
  require = createRequire(import.meta.url),
) {
  for (const manifest of await pdfRuntimeManifests(platform, arch, require)) {
    const { name } = JSON.parse(await readFile(manifest, 'utf8')) as { name: string };
    await cloneTree(path.dirname(manifest), path.join(buildPath, 'node_modules', name));
  }
}
