import path from 'node:path';
import { app } from 'electron';

/**
 * Where Viewer's bundled helpers and processors live: the app's Resources folder when packaged,
 * the source tree's `assets` folder in development. Never the working directory, which a launch
 * from a terminal or the `viewer` command can set anywhere.
 */
export function assetPath(...parts: string[]): string {
  // Utility processes have no `app`; like the packaged app, they run from Resources.
  const root =
    !app || app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'assets');
  return path.join(root, ...parts);
}

/** This platform's bundled media and PDF processors, as a folder under `assetPath()`. */
export const processorFolder = `viewer-processors-${process.platform}-${process.arch}`;
