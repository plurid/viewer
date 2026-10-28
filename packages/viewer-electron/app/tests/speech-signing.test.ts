import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { SpeechRuntime } from '../src/desktop/speech/runtime';
import { speechRuntimeName } from '../src/desktop/speech/runtime-manifest';
import { verifySpeechRuntime } from '../tools/speech-runtime';
import { temporaryRoot } from '../tools/temporary';

it.skipIf(
  process.platform !== 'darwin' ||
    !existsSync(path.join('assets', speechRuntimeName(), 'manifest.json')),
)(
  'accepts normal package signing and rejects loose or package-tampered runtime bytes',
  async () => {
    const root = await temporaryRoot('viewer-speech-signing-'),
      bundle = path.join(root, 'Generated.app'),
      contents = path.join(bundle, 'Contents');
    const resources = path.join(contents, 'Resources', speechRuntimeName()),
      execute = promisify(execFile);
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.dirname(resources), { recursive: true });
    await cp(path.resolve('assets', speechRuntimeName()), resources, {
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
        path.resolve('assets/entitlements.mac.plist'),
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
