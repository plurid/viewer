/** A pinned prebuilt engine plus a small owned helper; all intermediates remain in out. */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import {
  speechRuntimeArchive,
  speechRuntimeName,
  speechRuntimeVersion,
} from '../src/desktop/speech/runtime-manifest';
import { hashFile } from './filesystem/fingerprints';
import { verifySpeechPackage } from '../src/desktop/speech/signed-resources';

const execute = promisify(execFile);
const prefix = 'build-apple/whisper.xcframework/macos-arm64_x86_64/whisper.framework/Versions/A/';
export async function verifySpeechRuntime(directory: string): Promise<void> {
  const folder = await lstat(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw new Error('The speech engine must be an ordinary folder.');
  const info = await lstat(path.join(directory, 'manifest.json'));
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
    throw new Error('Invalid speech engine manifest.');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
    version: string;
    archive: string;
    files: Record<string, string>;
  };
  if (manifest.version !== speechRuntimeVersion || manifest.archive !== speechRuntimeArchive.sha256)
    throw new Error('The bundled speech engine manifest does not match its pinned release.');
  let changedBySigning = false;
  for (const name of ['viewer-speech-recognizer', 'libwhisper.dylib']) {
    const file = path.join(directory, name),
      info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !/^[a-f0-9]{64}$/.test(manifest.files[name] ?? '')
    )
      throw new Error('The bundled speech engine failed verification.');
    if ((await hashFile(file)) !== manifest.files[name]) changedBySigning = true;
  }
  if (changedBySigning) await verifySpeechPackage(directory);
}

export async function prepareSpeechRuntime(
  appRoot: string,
  suppliedArchive?: string,
): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  const arch = process.env.VIEWER_BUILD_ARCH ?? process.arch;
  if (!['arm64', 'x64'].includes(arch))
    throw new Error('Choose a supported speech engine architecture.');
  const destination = path.join(appRoot, 'assets', speechRuntimeName(arch));
  const exists = await lstat(destination).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
  if (exists) {
    await verifySpeechRuntime(destination);
    return destination;
  }
  await mkdir(path.join(appRoot, 'out'), { recursive: true });
  const work = await mkdtemp(path.join(appRoot, 'out/speech-runtime-'));
  const archive = path.join(work, 'engine.zip');
  if (suppliedArchive) await copyFile(suppliedArchive, archive, constants.COPYFILE_EXCL);
  else {
    const response = await fetch(speechRuntimeArchive.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok)
      throw new Error('Cannot download the pinned speech engine (' + response.status + ').');
    if (!response.body) throw new Error('The speech engine download has no body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > speechRuntimeArchive.bytes)
        throw new Error('The speech engine archive exceeds its pinned size.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== speechRuntimeArchive.bytes)
      throw new Error('The speech engine archive has an unexpected size.');
    await writeFile(archive, bytes, { flag: 'wx' });
  }
  if ((await hashFile(archive)) !== speechRuntimeArchive.sha256)
    throw new Error('The speech engine archive checksum does not match.');
  const files = unzipSync(new Uint8Array(await readFile(archive)), {
    filter: (item) => item.name.startsWith(prefix) && !item.name.endsWith('/'),
  });
  const headers = path.join(work, 'headers'),
    output = path.join(work, 'resources');
  await mkdir(headers);
  await mkdir(output);
  for (const [name, bytes] of Object.entries(files)) {
    const local = name.slice(prefix.length);
    if (/^Headers\/[a-z0-9-]+\.h$/.test(local))
      await writeFile(path.join(headers, path.basename(local)), bytes, { flag: 'wx' });
  }
  const library = files[prefix + 'whisper'];
  if (!library?.length) throw new Error('The pinned macOS speech engine slice is missing.');
  const universal = path.join(work, 'universal.dylib');
  await writeFile(universal, library, { flag: 'wx' });
  const nativeArch = arch === 'x64' ? 'x86_64' : 'arm64';
  const dylib = path.join(output, 'libwhisper.dylib'),
    helper = path.join(work, 'viewer-speech-recognizer');
  await execute('/usr/bin/lipo', [universal, '-thin', nativeArch, '-output', dylib]);
  await execute('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-O2',
    '-target',
    nativeArch + '-apple-macos13.0',
    '-save-temps=obj',
    '-I',
    headers,
    path.join(appRoot, 'tools/speech-recognizer.cpp'),
    '-o',
    helper,
  ]);
  for (const file of [dylib, helper])
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', file]);
  await copyFile(helper, path.join(output, 'viewer-speech-recognizer'), constants.COPYFILE_EXCL);
  const hashes = Object.fromEntries(
    await Promise.all(
      ['viewer-speech-recognizer', 'libwhisper.dylib'].map(async (name) => [
        name,
        await hashFile(path.join(output, name)),
      ]),
    ),
  );
  await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        version: speechRuntimeVersion,
        archive: speechRuntimeArchive.sha256,
        commit: speechRuntimeArchive.commit,
        files: hashes,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  await cp(output, destination, { recursive: true, force: false, errorOnExist: true });
  await verifySpeechRuntime(destination);
  console.log('Prepared the bundled speech engine. Build intermediates were retained.');
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareSpeechRuntime(path.resolve('.'), process.argv[2]);
