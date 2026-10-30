import { app, shell } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bundleBuild } from '../../domain/updates/feed';
import type { InstalledRelease } from '../../domain/updates/feed';
import { assetPath } from '../native/assets';
import { applicationCopyright } from '../release';

/** CFBundleVersion from an XML Info.plist, as the packager writes it. */
export function plistBundleVersion(text: string): string | undefined {
  return /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1]?.trim();
}

/** This copy's version and build. A development run has no build of its own. */
export function installedRelease(): InstalledRelease {
  const version = app.getVersion();
  if (!app.isPackaged || process.platform !== 'darwin') return { version };
  try {
    const plist = path.join(path.dirname(process.execPath), '..', 'Info.plist');
    return { version, build: bundleBuild(plistBundleVersion(readFileSync(plist, 'utf8'))) };
  } catch {
    return { version };
  }
}

export function installAboutPanel(release: InstalledRelease): void {
  app.setAboutPanelOptions({
    applicationName: 'Viewer',
    applicationVersion: release.version,
    version: release.build === undefined ? 'development' : String(release.build),
    copyright: applicationCopyright,
    credits:
      'Viewer is built with Electron, React and other open-source software. Choose Viewer > Acknowledgements for their licenses.',
  });
}

/** The bundled licenses: a folder plane in the direct build, Finder in the sandboxed Store build. */
export async function openAcknowledgements(
  open?: (folder: string) => Promise<void>,
): Promise<void> {
  const folder = assetPath('licenses');
  if (open && !process.mas) return open(folder);
  const problem = await shell.openPath(folder);
  if (problem) throw new Error(problem);
}
