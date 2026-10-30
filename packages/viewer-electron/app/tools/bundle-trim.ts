/** What the packaged app leaves out of Electron's template and node-pty: files this platform
 * never loads. Nothing is deleted; packaging copies less, or sets a folder aside. */
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Viewer's own text is English, so its bundle declares English only: the main bundle's
 * language folders decide the language of standard menu items. Chromium's locale.pak folders stay,
 * because they also set the locale web content formats dates and numbers with. */
export const keptLanguage = (name: string) =>
  /^en(?:_GB)?(?:_(?:FEMININE|MASCULINE|NEUTER))?\.lproj$/.test(name);

/** Electron's generic purpose strings for what Viewer never asks for. Every session refuses
 * camera and screen-audio capture (main.ts, browser planes, the Office renderer), so macOS never
 * shows them. Bluetooth keeps a Viewer string: a web page can make Chromium start Bluetooth. */
export const unusedPurposeStrings = ['NSCameraUsageDescription', 'NSAudioCaptureUsageDescription'];

/** Whether a node-pty file is loaded on this platform: its own prebuild, never another's, and
 * the Windows ConPTY and winpty files on Windows only. `relative` is inside the package. */
export function nodePtyFileUsed(relative: string, platform: string, arch: string): boolean {
  const [top, name] = relative.split(path.sep);
  const runtime = platform === 'mas' ? 'darwin' : platform;
  if (top === 'prebuilds' && name) return name === `${runtime}-${arch}`;
  if ((top === 'third_party' && name === 'conpty') || (top === 'deps' && name === 'winpty'))
    return runtime === 'win32';
  return true;
}

/** An XML property list without the given keys and their string values. */
export function withoutPlistStrings(text: string, keys: readonly string[]): string {
  return keys.reduce(
    (plist, key) =>
      plist.replace(new RegExp(`\\s*<key>${key}</key>\\s*<string>[^<]*</string>`), ''),
    text,
  );
}

/**
 * Trims the extracted Electron template before the packager builds Viewer.app from it. Other
 * languages move to a folder beside the template in the packager's own temporary workspace,
 * which the packager clears when it next runs.
 */
export async function trimElectronTemplate(template: string): Promise<string[]> {
  const contents = path.join(template, 'Electron.app', 'Contents');
  const plist = path.join(contents, 'Info.plist');
  await writeFile(plist, withoutPlistStrings(await readFile(plist, 'utf8'), unusedPurposeStrings));
  const aside = template + '-other-languages';
  const moved: string[] = [];
  const folder = path.join(contents, 'Resources');
  for (const name of (await readdir(folder)).sort()) {
    if (!name.endsWith('.lproj') || keptLanguage(name)) continue;
    const source = path.join(folder, name);
    const info = await lstat(source);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Expected an ordinary language folder: ' + source);
    const relative = path.relative(template, source);
    await mkdir(path.dirname(path.join(aside, relative)), { recursive: true });
    await rename(source, path.join(aside, relative));
    moved.push(relative);
  }
  return moved;
}
