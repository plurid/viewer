import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

/** The argument that hands a worker the folder the main process found the assets in. */
const rootArgument = '--viewer-asset-root=';

let root: string | undefined = launchedRoot();
/**
 * The root a worker must be told: in development a utility process's Resources are Electron's. A
 * worker hands on the one it was launched with, which only a development main process gives.
 */
let development = root;

/**
 * The asset root the main process launched this worker with. Only a utility process or a thread
 * reads one, since only the process that launches it sets its arguments: a person's argument to
 * the app itself never chooses where a native module loads from.
 */
function launchedRoot(): string | undefined {
  if (process.type !== 'utility' && isMainThread) return undefined;
  const value = process.argv
    .find((argument) => argument.startsWith(rootArgument))
    ?.slice(rootArgument.length);
  return value && path.isAbsolute(value) ? value : undefined;
}

/** Set once by the main process at startup, as only it knows whether the app is packaged. */
export function setAssetRoot(packaged: boolean, appPath: string): void {
  root = packaged ? process.resourcesPath : path.join(appPath, 'assets');
  development = packaged ? undefined : root;
}

/**
 * The arguments a worker is launched with, so that it finds the assets where the main process
 * does. A packaged worker's own Resources folder is the app's, so it is told nothing.
 */
export function assetRootArguments(): string[] {
  return development ? [rootArgument + development] : [];
}

/**
 * Where Viewer's bundled helpers and processors live: the app's Resources folder when packaged,
 * the source tree's `assets` folder in development. A worker has the one it was launched with, or
 * else its Resources folder; a script run with plain Node, such as a unit test, runs from the
 * source tree.
 */
export function assetPath(...parts: string[]): string {
  return path.join(root ?? process.resourcesPath ?? path.resolve('assets'), ...parts);
}

/** This platform's bundled media and PDF processors, as a folder under `assetPath()`. */
export const processorFolder = `viewer-processors-${process.platform}-${process.arch}`;
