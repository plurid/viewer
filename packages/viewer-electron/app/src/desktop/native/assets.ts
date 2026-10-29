import path from 'node:path';

let root: string | undefined;

/** Set once by the main process at startup, as only it knows whether the app is packaged. */
export function setAssetRoot(packaged: boolean, appPath: string): void {
  root = packaged ? process.resourcesPath : path.join(appPath, 'assets');
}

/**
 * Where Viewer's bundled helpers and processors live: the app's Resources folder when packaged,
 * the source tree's `assets` folder in development. A utility process has only its Resources
 * folder; a script run with plain Node, such as a unit test, runs from the source tree.
 */
export function assetPath(...parts: string[]): string {
  return path.join(root ?? process.resourcesPath ?? path.resolve('assets'), ...parts);
}

/** This platform's bundled media and PDF processors, as a folder under `assetPath()`. */
export const processorFolder = `viewer-processors-${process.platform}-${process.arch}`;
