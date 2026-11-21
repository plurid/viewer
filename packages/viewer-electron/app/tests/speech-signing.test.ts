import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import store from '../mac-app-store.json' with { type: 'json' };
import { SpeechRuntime } from '../src/desktop/speech/runtime';
import { speechRuntimeName } from '../src/desktop/speech/runtime-manifest';
import { storeConfiguration, storeEntitlements } from '../tools/mas-configuration';
import { verifySpeechRuntime } from '../tools/speech-runtime';
import { temporaryRoot } from '../tools/temporary';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const runtimeAssets = path.join(appRoot, 'assets', speechRuntimeName());

it.skipIf(process.platform !== 'darwin' || !existsSync(path.join(runtimeAssets, 'manifest.json')))(
  'accepts normal package signing and rejects loose or package-tampered runtime bytes',
  async () => {
    const root = await temporaryRoot('viewer-speech-signing-'),
      bundle = path.join(root, 'Generated.app'),
      contents = path.join(bundle, 'Contents');
    const resources = path.join(contents, 'Resources', speechRuntimeName()),
      execute = promisify(execFile);
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.dirname(resources), { recursive: true });
    await cp(runtimeAssets, resources, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await cp(
      path.join(resources, 'viewer-speech-recognizer'),
      path.join(contents, 'MacOS', 'Generated'),
    );
    await writeFile(
      path.join(contents, 'Info.plist'),
      '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Generated</string><key>CFBundleIdentifier</key><string>invalid.viewer.generated-speech</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
    );
    const manifest = await readFile(path.join(resources, 'manifest.json'));
    for (const name of ['viewer-speech-recognizer', 'libwhisper.dylib'])
      await execute('/usr/bin/codesign', [
        '--force',
        '--sign',
        '-',
        '--entitlements',
        path.join(appRoot, 'assets/entitlements.mac.plist'),
        path.join(resources, name),
      ]);
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', '--deep', bundle]);
    expect(await readFile(path.join(resources, 'manifest.json'))).toEqual(manifest);
    await expect(verifySpeechRuntime(resources)).resolves.toBeUndefined();
    expect((await new SpeechRuntime(resources).status()).recognitionAvailable).toBe(true);
    const loose = path.join(root, speechRuntimeName());
    await cp(resources, loose, { recursive: true, force: false, errorOnExist: true });
    await expect(verifySpeechRuntime(loose)).rejects.toThrow('checksum');
    await writeFile(path.join(resources, 'libwhisper.dylib'), 'Generated tampering fixture');
    await expect(verifySpeechRuntime(resources)).rejects.toThrow('could not be verified');
    expect((await new SpeechRuntime(resources).status()).recognitionAvailable).toBe(false);
  },
);

it.skipIf(process.platform !== 'darwin' || !existsSync(path.join(runtimeAssets, 'manifest.json')))(
  'signs a Store bundle with audio-input main entitlements and inheriting speech helper entitlements',
  async () => {
    const root = await temporaryRoot('viewer-speech-mas-signing-'),
      bundle = path.join(root, 'Generated.app'),
      contents = path.join(bundle, 'Contents');
    const resources = path.join(contents, 'Resources', speechRuntimeName()),
      execute = promisify(execFile);
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.dirname(resources), { recursive: true });
    await cp(runtimeAssets, resources, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await cp(
      path.join(resources, 'viewer-speech-recognizer'),
      path.join(contents, 'MacOS', 'Generated'),
    );
    await writeFile(
      path.join(contents, 'Info.plist'),
      '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Generated</string><key>CFBundleIdentifier</key><string>invalid.viewer.generated-speech-mas</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
    );
    const config = storeConfiguration.parse(store);
    const entitlements = storeEntitlements(
      config,
      'mas-dev',
      `${config.teamID}.${config.bundleID}`,
    );
    const mainPlist = path.join(root, 'main.plist');
    const inheritPlist = path.join(root, 'inherit.plist');
    await writeFile(mainPlist, entitlements.main, 'utf8');
    await writeFile(inheritPlist, entitlements.inherit, 'utf8');
    for (const name of ['viewer-speech-recognizer', 'libwhisper.dylib'])
      await execute('/usr/bin/codesign', [
        '--force',
        '--sign',
        '-',
        '--entitlements',
        inheritPlist,
        path.join(resources, name),
      ]);
    await execute('/usr/bin/codesign', [
      '--force',
      '--sign',
      '-',
      '--entitlements',
      mainPlist,
      bundle,
    ]);
    await expect(verifySpeechRuntime(resources)).resolves.toBeUndefined();
    expect((await new SpeechRuntime(resources).status()).recognitionAvailable).toBe(true);

    const { stdout: mainSigned } = await execute('/usr/bin/codesign', [
      '--display',
      '--entitlements',
      '-',
      '--xml',
      bundle,
    ]);
    expect(mainSigned).toContain('<key>com.apple.security.app-sandbox</key>');
    expect(mainSigned).toContain('<key>com.apple.security.device.audio-input</key>');
    expect(mainSigned).toContain('<key>com.apple.security.network.client</key>');

    const { stdout: helperSigned } = await execute('/usr/bin/codesign', [
      '--display',
      '--entitlements',
      '-',
      '--xml',
      path.join(resources, 'viewer-speech-recognizer'),
    ]);
    expect([...helperSigned.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])).toEqual([
      'com.apple.security.app-sandbox',
      'com.apple.security.inherit',
    ]);
  },
);
