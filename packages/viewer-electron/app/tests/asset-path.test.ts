/**
 * Bundled helpers are found from the app, never from the working directory: a development
 * launch from another folder, or the `viewer` command, once looked for them there. A development
 * utility process is told the source tree's folder: its own Resources folder is Electron's.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
const type = Object.getOwnPropertyDescriptor(process, 'type');
const argv = process.argv;
afterEach(() => {
  if (resources) Object.defineProperty(process, 'resourcesPath', resources);
  else delete (process as unknown as Record<string, unknown>).resourcesPath;
  if (type) Object.defineProperty(process, 'type', type);
  else delete (process as unknown as Record<string, unknown>).type;
  process.argv = argv;
  vi.resetModules();
});
function resourcesAt(value: string | undefined) {
  Object.defineProperty(process, 'resourcesPath', { value, configurable: true });
}
/** This process as Electron names it, launched with `launch`: `utility` for a utility process. */
function runAs(processType: string, launch: string[] = []) {
  Object.defineProperty(process, 'type', { value: processType, configurable: true });
  process.argv = [...argv.slice(0, 2), ...launch];
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

  it('reach a utility process from a development main process, and no further', async () => {
    // Electron's own bundle: what a development utility process has as its Resources folder
    resourcesAt('/Source/node_modules/electron/dist/Electron.app/Contents/Resources');
    runAs('browser');
    const main = await import('../src/desktop/native/assets');
    main.setAssetRoot(false, '/Source/app');
    const launch = main.assetRootArguments();
    expect(launch).toEqual(['--viewer-asset-root=/Source/app/assets']);
    vi.resetModules();
    runAs('utility', launch);
    const worker = await import('../src/desktop/native/assets');
    expect(worker.assetPath('viewer-macos-files.node')).toBe(
      '/Source/app/assets/viewer-macos-files.node',
    );
    // a worker it launches in turn is told the same
    expect(worker.assetRootArguments()).toEqual(launch);
    // packaged, a worker's Resources are the app's, and it is told nothing
    main.setAssetRoot(true, '/Source/app');
    expect(main.assetRootArguments()).toEqual([]);
  });

  it('never come from an argument given to the main process', async () => {
    resourcesAt('/Viewer.app/Contents/Resources');
    runAs('browser', ['--viewer-asset-root=/Elsewhere']);
    const main = await import('../src/desktop/native/assets');
    expect(main.assetPath('viewer-macos-files.node')).toBe(
      '/Viewer.app/Contents/Resources/viewer-macos-files.node',
    );
    expect(main.assetRootArguments()).toEqual([]);
    // nor from a relative one, in a worker
    vi.resetModules();
    runAs('utility', ['--viewer-asset-root=assets']);
    expect((await import('../src/desktop/native/assets')).assetPath('helper')).toBe(
      '/Viewer.app/Contents/Resources/helper',
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
