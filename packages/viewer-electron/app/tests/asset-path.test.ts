/**
 * Bundled helpers are found from the app, never from the working directory: a development
 * launch from another folder, or the `viewer` command, once looked for them there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
afterEach(() => {
  if (resources) Object.defineProperty(process, 'resourcesPath', resources);
  else delete (process as unknown as Record<string, unknown>).resourcesPath;
  vi.resetModules();
});
function resourcesAt(value: string | undefined) {
  Object.defineProperty(process, 'resourcesPath', { value, configurable: true });
}

describe('asset paths', () => {
  it('come from the source tree in development and Resources when packaged', async () => {
    resourcesAt('/Viewer.app/Contents/Resources');
    const development = await import('../src/desktop/native/assets');
    development.setAssetRoot(false, '/Source/app');
    expect(development.assetPath('viewer-ocr')).toBe('/Source/app/assets/viewer-ocr');
    development.setAssetRoot(true, '/Source/app');
    expect(development.assetPath('viewer-ocr')).toBe('/Viewer.app/Contents/Resources/viewer-ocr');
  });

  it('use Resources in a utility process, and the source tree in plain Node', async () => {
    resourcesAt('/Viewer.app/Contents/Resources');
    expect((await import('../src/desktop/native/assets')).assetPath('helper')).toBe(
      '/Viewer.app/Contents/Resources/helper',
    );
    vi.resetModules();
    resourcesAt(undefined);
    expect((await import('../src/desktop/native/assets')).assetPath('helper')).toBe(
      path.resolve('assets/helper'),
    );
  });

  it('are never resolved against the working directory elsewhere in the app', () => {
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : /\.tsx?$/.test(entry.name)
            ? [path.join(directory, entry.name)]
            : [],
      );
    const source = path.resolve(import.meta.dirname, '../src');
    const offenders = files(source).filter(
      (file) =>
        !file.endsWith(path.join('native', 'assets.ts')) &&
        readFileSync(file, 'utf8').includes("path.resolve('assets"),
    );
    expect(offenders).toEqual([]);
  });
});
