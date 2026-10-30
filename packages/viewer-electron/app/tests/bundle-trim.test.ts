import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  keptLanguage,
  nodePtyFileUsed,
  trimElectronTemplate,
  withoutPlistStrings,
} from '../tools/bundle-trim';
import { temporaryRoot } from '../tools/temporary';

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>CFBundleName</key>
    <string>Electron</string>
    <key>NSAudioCaptureUsageDescription</key>
    <string>This app needs access to audio capture</string>
    <key>NSCameraUsageDescription</key>
    <string>This app needs access to the camera</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>This app needs access to the microphone</string>
  </dict>
</plist>
`;

describe('the packaged bundle', () => {
  it('keeps node-pty for this platform and architecture only', () => {
    const used = (file: string, platform = 'darwin', arch = 'arm64') =>
      nodePtyFileUsed(file.split('/').join(path.sep), platform, arch);
    expect(used('prebuilds/darwin-arm64/pty.node')).toBe(true);
    expect(used('prebuilds/darwin-arm64/pty.node', 'mas')).toBe(true);
    expect(used('prebuilds/darwin-x64')).toBe(false);
    expect(used('prebuilds/win32-x64/conpty.dll')).toBe(false);
    expect(used('prebuilds/darwin-x64/pty.node', 'darwin', 'x64')).toBe(true);
    expect(used('third_party/conpty/1.23/win10-x64/OpenConsole.exe')).toBe(false);
    expect(used('deps/winpty/src/winpty.gyp')).toBe(false);
    expect(used('deps/winpty', 'win32', 'x64')).toBe(true);
    for (const file of [
      'prebuilds',
      'src/unix/pty.cc',
      'lib/index.js',
      'package.json',
      'binding.gyp',
    ])
      expect(used(file)).toBe(true);
  });

  it('declares English only', () => {
    for (const name of ['en.lproj', 'en_GB.lproj', 'en_FEMININE.lproj', 'en_GB_NEUTER.lproj'])
      expect(keptLanguage(name)).toBe(true);
    for (const name of ['de.lproj', 'es_419.lproj', 'en_US_X.lproj', 'eng.lproj'])
      expect(keptLanguage(name)).toBe(false);
  });

  it('drops the camera and screen-audio purpose strings and keeps the rest', () => {
    const trimmed = withoutPlistStrings(plist, [
      'NSCameraUsageDescription',
      'NSAudioCaptureUsageDescription',
    ]);
    expect(trimmed).not.toContain('NSCameraUsageDescription');
    expect(trimmed).not.toContain('audio capture');
    expect(trimmed).toContain('<key>NSMicrophoneUsageDescription</key>');
    expect(trimmed).toContain('<key>CFBundleName</key>\n    <string>Electron</string>');
    expect(withoutPlistStrings(trimmed, ['NSCameraUsageDescription'])).toBe(trimmed);
  });

  it("sets the main bundle's other languages aside without deleting them, and keeps Chromium's", async () => {
    const root = await temporaryRoot('viewer-template-trim-');
    const template = path.join(root, 'darwin-arm64-template-generated');
    const contents = path.join(template, 'Electron.app', 'Contents');
    const framework = path.join(
      contents,
      'Frameworks/Electron Framework.framework/Versions/A/Resources',
    );
    for (const folder of [path.join(contents, 'Resources'), framework])
      for (const name of ['en.lproj', 'en_GB.lproj', 'de.lproj', 'ja.lproj']) {
        await mkdir(path.join(folder, name), { recursive: true });
        await writeFile(path.join(folder, name, 'locale.pak'), 'Generated ' + name);
      }
    await writeFile(path.join(contents, 'Info.plist'), plist);
    const moved = await trimElectronTemplate(template);
    expect(moved).toHaveLength(2);
    expect((await readdir(framework)).sort()).toEqual([
      'de.lproj',
      'en.lproj',
      'en_GB.lproj',
      'ja.lproj',
    ]);
    expect((await readdir(path.join(contents, 'Resources'))).sort()).toEqual([
      'en.lproj',
      'en_GB.lproj',
    ]);
    const aside = path.join(root, 'darwin-arm64-template-generated-other-languages');
    for (const relative of moved)
      expect((await lstat(path.join(aside, relative, 'locale.pak'))).isFile()).toBe(true);
    expect(await readFile(path.join(contents, 'Info.plist'), 'utf8')).not.toContain('camera');
  });
});
