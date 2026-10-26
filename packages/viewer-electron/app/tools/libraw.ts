/** Pinned, separately linked RAW decoder. Every source/build folder is retained. */
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { x as extract } from 'tar';
import { download, hash, run } from './processors';
import { compatibleMacOSMinimum } from './native-build/macos-target';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = {
  version: '0.22.2',
  url: 'https://www.libraw.org/data/LibRaw-0.22.2.tar.gz',
  sha256: 'de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa',
};
export async function prepareRawProcessor(minimum: string, arch = process.arch) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
    throw new Error('The RAW helper requires macOS arm64 or x64.');
  const output = path.join(appRoot, `assets/viewer-raw-v3-darwin-${arch}`);
  const helper = path.join(appRoot, 'tools/raw-preview.mm');
  const helperHash = hash(await readFile(helper), 'sha256', 'hex');
  const descriptor = path.join(output, 'manifest.json');
  const existing = (await readFile(descriptor, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)) as
    | {
        source: typeof source;
        minimum: string;
        arch: string;
        helperHash: string;
        files: Record<string, string>;
      }
    | undefined;
  if (existing) {
    if (
      !compatibleMacOSMinimum(existing.minimum, minimum) ||
      existing.arch !== arch ||
      existing.helperHash !== helperHash ||
      JSON.stringify(existing.source) !== JSON.stringify(source)
    )
      throw new Error(
        'The existing RAW helper differs from the requested build. It was preserved.',
      );
    for (const [file, digest] of Object.entries(existing.files))
      if (hash(await readFile(path.join(output, file)), 'sha256', 'hex') !== digest)
        throw new Error(`RAW helper resource changed: ${file}`);
    return;
  }
  const cache = path.join(appRoot, 'out/processor-sources');
  await mkdir(cache, { recursive: true });
  const archive = path.join(cache, 'LibRaw-0.22.2.tar.gz');
  if (process.env.VIEWER_RAW_SOURCE_ARCHIVE) {
    const supplied = await readFile(process.env.VIEWER_RAW_SOURCE_ARCHIVE);
    if (hash(supplied, 'sha256', 'hex') !== source.sha256)
      throw new Error('The supplied LibRaw source differs from the pin.');
    await writeFile(archive, supplied, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  await download(archive, source.url, source.sha256, 'sha256');
  const build = await mkdtemp(path.join(cache, 'raw-build-'));
  const log = path.join(build, 'build.log');
  console.log('Preparing RAW preview helper. Retained build:', build);
  await extract({
    file: archive,
    cwd: build,
    strict: true,
    keep: true,
    filter: (_name, item) =>
      'type' in item &&
      ['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(item.type),
  });
  const directory = path.join(build, 'LibRaw-0.22.2');
  const target = arch === 'x64' ? 'x86_64' : 'arm64';
  const flags = [
    '-std=c++17',
    '-O2',
    '-fPIC',
    '-arch',
    target,
    `-mmacosx-version-min=${minimum}`,
    '-DLIBRAW_NOTHREADS',
    '-DUSE_ZLIB',
    '-I',
    directory,
  ];
  const environment = { CPATH: '', C_INCLUDE_PATH: '', CPLUS_INCLUDE_PATH: '', LIBRARY_PATH: '' };
  // Do not invoke configure/make/libtool: those scripts remove their probes and
  // intermediate linker objects. Compile the pinned source list directly instead.
  const makefile = await readFile(path.join(directory, 'Makefile.am'), 'utf8');
  const list = makefile.match(/lib_libraw_a_SOURCES\s*=([\s\S]*?)\n\n/)?.[1];
  const sources = list
    ?.replace(/\\\r?\n/g, ' ')
    .trim()
    .split(/\s+/);
  if (!sources?.length || sources.some((file) => !/^src\/[\w/]+\.cpp$/.test(file)))
    throw new Error('Review the pinned LibRaw source list before building.');
  const objects = path.join(build, 'objects');
  await mkdir(objects);
  const compiled: string[] = [];
  for (let start = 0; start < sources.length; start += 4) {
    const results = await Promise.allSettled(
      sources.slice(start, start + 4).map(async (file) => {
        const object = path.join(objects, file.replaceAll('/', '_') + '.o');
        await run(
          '/usr/bin/xcrun',
          ['clang++', ...flags, '-c', path.join(directory, file), '-o', object],
          directory,
          log,
          environment,
        );
        return object;
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      compiled.push(result.value);
    }
  }
  const dylib = 'libraw.25.dylib';
  await mkdir(output, { recursive: true });
  await run(
    '/usr/bin/xcrun',
    [
      'clang++',
      '-dynamiclib',
      '-arch',
      target,
      `-mmacosx-version-min=${minimum}`,
      ...compiled,
      '-lz',
      '-install_name',
      '@loader_path/' + dylib,
      '-compatibility_version',
      '26',
      '-current_version',
      '26.0',
      '-o',
      path.join(output, dylib),
    ],
    directory,
    log,
    environment,
  );
  await run(
    '/usr/bin/xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-O2',
      '-arch',
      target,
      `-mmacosx-version-min=${minimum}`,
      '-I',
      directory,
      helper,
      path.join(output, dylib),
      '-framework',
      'Foundation',
      '-framework',
      'CoreGraphics',
      '-framework',
      'ImageIO',
      '-o',
      path.join(output, 'viewer-raw'),
    ],
    directory,
    log,
    environment,
  );
  for (const file of ['LICENSE.LGPL', 'LICENSE.CDDL', 'COPYRIGHT'])
    await copyFile(path.join(directory, file), path.join(output, file), 1);
  await copyFile(archive, path.join(output, 'LibRaw-0.22.2.tar.gz'), 1);
  await copyFile(helper, path.join(output, 'raw-preview.mm'), 1);
  for (const file of [dylib, 'viewer-raw'])
    await run('/usr/bin/codesign', ['--sign', '-', path.join(output, file)], directory, log);
  await writeFile(
    path.join(output, 'build.txt'),
    `LibRaw ${source.version}\n${source.url}\nSHA256 ${source.sha256}\nEach lib_libraw_a_SOURCES entry from pinned Makefile.am is compiled directly (no configure/make/libtool or cleanup).\nclang++ ${flags.join(' ')} -c <source> -o <retained-object>\nclang++ -dynamiclib -arch ${target} -mmacosx-version-min=${minimum} <objects> -lz -install_name @loader_path/${dylib} -compatibility_version 26 -current_version 26.0 -o ${dylib}\nDynamically linked helper built from included raw-preview.mm using macOS ImageIO/CoreGraphics.\nLossy JPEG DNG, external color profiles and optional RawSpeed/DNG SDK codecs are not compiled.\n`,
    { flag: 'wx' },
  );
  const files: Record<string, string> = {};
  for (const file of await readdir(output))
    files[file] = hash(await readFile(path.join(output, file)), 'sha256', 'hex');
  await writeFile(
    descriptor,
    JSON.stringify({ source, minimum, arch, helperHash, files }, null, 2),
    { flag: 'wx' },
  );
}
