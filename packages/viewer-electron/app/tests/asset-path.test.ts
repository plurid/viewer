/**
 * Bundled helpers are found from the app, never from the working directory: a development
 * launch from another folder, or the `viewer` command, once looked for them there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/Source/app' } as
    { isPackaged: boolean; getAppPath(): string } | undefined,
}));
const sourceApp = electron.app;
vi.mock('electron', () => electron);

const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
afterEach(() => {
  electron.app = sourceApp;
  if (resources) Object.defineProperty(process, 'resourcesPath', resources);
  else delete (process as unknown as Record<string, unknown>).resourcesPath;
});
function as(process: 'main' | 'utility', resourcesPath: string, packaged: boolean) {
  Object.defineProperty(globalThis.process, 'resourcesPath', {
    value: resourcesPath,
    configurable: true,
  });
  electron.app = process === 'utility' ? undefined : { ...sourceApp!, isPackaged: packaged };
}

describe('asset paths', () => {
  it('come from the source tree in development and Resources when packaged', async () => {
    const { assetPath } = await import('../src/desktop/native/assets');
    as('main', '/Electron/Resources', false);
    expect(assetPath('viewer-ocr')).toBe('/Source/app/assets/viewer-ocr');
    as('main', '/Viewer.app/Contents/Resources', true);
    expect(assetPath('viewer-ocr')).toBe('/Viewer.app/Contents/Resources/viewer-ocr');
    // a utility process has no `app`
    as('utility', '/Viewer.app/Contents/Resources', false);
    expect(assetPath('helper')).toBe('/Viewer.app/Contents/Resources/helper');
  });

  it('are never resolved against the working directory in the app', () => {
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : /\.tsx?$/.test(entry.name)
            ? [path.join(directory, entry.name)]
            : [],
      );
    const source = path.resolve(import.meta.dirname, '../src');
    const offenders = files(source).filter((file) => {
      const text = readFileSync(file, 'utf8');
      // macos-files.ts keeps one plain-Node fallback, for unit tests run from the source tree
      const allowed = file.endsWith('macos-files.ts') ? 1 : 0;
      return (text.match(/path\.resolve\('assets/g) ?? []).length > allowed;
    });
    expect(offenders).toEqual([]);
  });
});
