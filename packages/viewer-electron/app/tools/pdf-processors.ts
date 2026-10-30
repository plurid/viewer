import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { x as extract } from 'tar';
import { download, hash, run } from './processors';
import { compatibleMacOSMinimum } from './native-build/macos-target';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = [
  {
    name: 'qpdf',
    version: '12.4.2',
    directory: 'qpdf-12.4.2',
    url: 'https://codeload.github.com/qpdf/qpdf/tar.gz/refs/tags/v12.4.2',
    sha256: '88ddeb5f25c6e9156f3113fc3994d3a5e0cdfeee398cd09dd00fabc9dac9f573',
  },
  {
    name: 'libjpeg-turbo',
    version: '3.1.3',
    directory: 'libjpeg-turbo-3.1.3',
    url: 'https://codeload.github.com/libjpeg-turbo/libjpeg-turbo/tar.gz/refs/tags/3.1.3',
    sha256: '3a13a5ba767dc8264bc40b185e41368a80d5d5f945944d1dbaa4b2fb0099f4e5',
  },
] as const;
/** Independent pinned resources keep an existing FFmpeg/Sharp build reusable.
 * Every build uses fresh retained source/build directories. No clean/uninstall runs. */
export async function preparePDFProcessors(minimum: string, arch = process.arch) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
    throw new Error('PDF processors require a macOS arm64 or x64 target.');
  const output = path.join(appRoot, `assets/viewer-optimizers-darwin-${arch}`),
    descriptor = path.join(output, 'manifest.json');
  const existing = (await readFile(descriptor, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)) as
    | {
        buildRevision?: number;
        minimum: string;
        arch: string;
        sources: unknown;
        files: Record<string, string>;
      }
    | undefined;
  if (existing) {
    if (
      !compatibleMacOSMinimum(existing.minimum, minimum) ||
      existing.arch !== arch ||
      JSON.stringify(existing.sources) !== JSON.stringify(sources)
    )
      throw new Error(
        'The existing PDF processor build differs from this target. It was preserved.',
      );
    for (const [file, expected] of Object.entries(existing.files))
      if (hash(await readFile(path.join(output, file)), 'sha256', 'hex') !== expected)
        throw new Error(`PDF processor resource changed: ${file}`);
    if (existing.buildRevision === 2) return;
    if (existing.buildRevision !== undefined)
      throw new Error('Unknown PDF processor build revision. Its resources were preserved.');
  }
  const cache = path.join(appRoot, 'out/processor-sources');
  await mkdir(cache, { recursive: true });
  const build = await mkdtemp(path.join(cache, 'pdf-build-')),
    log = path.join(build, 'build.log');
  if (existing)
    await cp(output, path.join(build, 'previous-resources'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  // A user CPATH can outrank CMake's -isystem include and silently mix an
  // installed JPEG 8 header with our pinned JPEG 6 ABI static library.
  const environment = {
    CPATH: '',
    C_INCLUDE_PATH: '',
    CPLUS_INCLUDE_PATH: '',
    OBJC_INCLUDE_PATH: '',
    LIBRARY_PATH: '',
  };
  console.log('Preparing PDF/JPEG optimizers. Retained build:', build);
  for (const source of sources) {
    const archive = path.join(cache, source.directory + '.tar.gz'),
      provided =
        process.env.VIEWER_PDF_PROCESSOR_SOURCES &&
        path.join(process.env.VIEWER_PDF_PROCESSOR_SOURCES, source.directory + '.tar.gz');
    if (provided && !(await stat(archive).catch(() => undefined))) {
      const bytes = await readFile(provided);
      if (hash(bytes, 'sha256', 'hex') !== source.sha256)
        throw new Error('The supplied optimizer source does not match its pin.');
      await copyFile(provided, archive, 1);
    }
    await download(archive, source.url, source.sha256, 'sha256');
    await extract({
      file: archive,
      cwd: build,
      strict: true,
      keep: true,
      filter: (_name, item) =>
        'type' in item &&
        ['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(item.type),
    });
  }
  const target = arch === 'x64' ? 'x86_64' : 'arm64',
    jpegSource = path.join(build, sources[1].directory),
    jpegBuild = path.join(build, 'jpeg-build'),
    prefix = path.join(build, 'jpeg-install');
  const common = [
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${minimum}`,
    `-DCMAKE_OSX_ARCHITECTURES=${target}`,
    '-DCMAKE_BUILD_TYPE=Release',
  ];
  await run(
    'cmake',
    [
      '-S',
      jpegSource,
      '-B',
      jpegBuild,
      ...common,
      '-DENABLE_SHARED=OFF',
      '-DENABLE_STATIC=ON',
      '-DWITH_TURBOJPEG=OFF',
      '-DWITH_SIMD=OFF',
      `-DCMAKE_INSTALL_PREFIX=${prefix}`,
    ],
    build,
    log,
    environment,
  );
  await run('cmake', ['--build', jpegBuild, '--parallel', '8'], build, log, environment);
  await run('cmake', ['--install', jpegBuild], build, log, environment);
  const qpdfSource = path.join(build, sources[0].directory),
    qpdfBuild = path.join(build, 'qpdf-build');
  const flags = [
    '-S',
    qpdfSource,
    '-B',
    qpdfBuild,
    ...common,
    '-DBUILD_SHARED_LIBS=OFF',
    '-DBUILD_STATIC_LIBS=ON',
    '-DBUILD_TESTING=OFF',
    '-DBUILD_DOC=OFF',
    '-DINSTALL_MANUAL=OFF',
    '-DUSE_IMPLICIT_CRYPTO=OFF',
    '-DREQUIRE_CRYPTO_NATIVE=ON',
    '-DSTATIC_JPEG=ON',
    `-DLIBJPEG_STATIC_PATH=${prefix}/lib/libjpeg.a`,
    `-DLIBJPEG_LIB_PATH=${prefix}/lib/libjpeg.a`,
    `-DLIBJPEG_H_PATH=${prefix}/include`,
    '-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local',
  ];
  await run('cmake', flags, build, log, {
    ...environment,
    PKG_CONFIG_LIBDIR: path.join(prefix, 'lib/pkgconfig'),
    PKG_CONFIG_PATH: '',
  });
  await run(
    'cmake',
    ['--build', qpdfBuild, '--target', 'qpdf', '--parallel', '8'],
    build,
    log,
    environment,
  );
  await mkdir(path.join(output, 'sources'), { recursive: true });
  const executables = {
    qpdf: path.join(qpdfBuild, 'qpdf/qpdf'),
    jpegtran: path.join(prefix, 'bin/jpegtran'),
  };
  for (const file of Object.values(executables)) {
    const libraries = execFileSync('otool', ['-L', file], { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' ')[0])
      .filter(Boolean);
    if (
      libraries.some(
        (library) => !library!.startsWith('/usr/lib/') && !library!.startsWith('/System/Library/'),
      )
    )
      throw new Error('Optimizer linked to a non-system dynamic library. Its build was preserved.');
  }
  for (const [name, file] of Object.entries(executables)) {
    await copyFile(file, path.join(output, name), existing ? 0 : 1);
    await chmod(path.join(output, name), 0o755);
  }
  for (const source of sources) {
    await copyFile(
      path.join(cache, source.directory + '.tar.gz'),
      path.join(output, 'sources', source.directory + '.tar.gz'),
      existing ? 0 : 1,
    );
    const folder = path.join(build, source.directory);
    for (const file of await readdir(folder))
      if (/^(LICENSE|COPYING|NOTICE|README\.ijg)(\.|$)/i.test(file)) {
        const content = await readFile(path.join(folder, file)).catch(() => undefined);
        if (content)
          await writeFile(path.join(output, `${source.name}-${file}`), content, {
            flag: existing ? 'w' : 'wx',
          });
      }
  }
  await writeFile(
    path.join(output, 'build.txt'),
    `cmake libjpeg-turbo: ${common.join(' ')} -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DWITH_TURBOJPEG=OFF -DWITH_SIMD=OFF\ncmake qpdf: ${flags.join(' ')}\nBuild revision 2: clear CPATH, C_INCLUDE_PATH, CPLUS_INCLUDE_PATH, OBJC_INCLUDE_PATH and LIBRARY_PATH.\nNative crypto only; JPEG linked statically; source archives and licenses supplied.\n`,
    { flag: existing ? 'w' : 'wx' },
  );
  const files: Record<string, string> = {};
  const visit = async (directory: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (directory === output && item.name === 'manifest.json') continue;
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink())
        throw new Error('PDF processor resources may not be symbolic links.');
      if (item.isDirectory()) await visit(file);
      else files[path.relative(output, file)] = hash(await readFile(file), 'sha256', 'hex');
    }
  };
  await visit(output);
  await writeFile(
    descriptor,
    JSON.stringify({ version: 1, buildRevision: 2, minimum, arch, sources, files }, null, 2),
    { flag: existing ? 'w' : 'wx' },
  );
}
