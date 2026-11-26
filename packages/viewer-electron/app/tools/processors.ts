/** Pinned, script-free processor packages plus an LGPL-only official FFmpeg build.
 * Build folders, source archives and failed artifacts are deliberately retained. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { x as extract } from 'tar';
import { compatibleMacOSMinimum } from './native-build/macos-target';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ffmpeg = {
  version: '9.0.2',
  url: 'https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n9.0.2',
  sha256: '6e374ed621e48faa40639307dff48ba6fe574a509977956d2cce9669b7cc27e9',
};
export const processorPackages = [
  [
    'sharp',
    '0.35.5',
    'Ywn4OnzGukp7CDMrp08RQ50YKmuwG47brZgIVPTvBaaAfQlRlygrRqSrxdCiL9M+LlzLBiJ68IR1QqvzHyjC7g==',
  ],
  [
    '@img/colour',
    '1.1.0',
    'Td76q7j57o/tLVdgS746cYARfSyxk8iEfRxewL9h4OMzYhbW4TAcppl0mT4eyqXddh6L/jwoM75mo7ixa/pCeQ==',
  ],
  [
    'detect-libc',
    '2.1.2',
    'Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==',
  ],
  [
    'semver',
    '7.8.5',
    'Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==',
  ],
  [
    '@img/sharp-darwin-arm64',
    '0.35.5',
    'QRUlFQ0WxvdWyqqG/WtI3iupfD5rBzmCHXSdPsY91sAtVtTo7Q4cb6zOccZ3gqEqkr0f1As1ehLqmEpDsRf+lg==',
  ],
  [
    '@img/sharp-libvips-darwin-arm64',
    '1.3.4',
    '5R89nBYiRdUlSWJxPhO+GVtaXzXSxKnRu/xqMn3KTA3L9EB9Oy/P+Nn2f2vlhPuUdy/Zusb2DarbyTpGCfEDuw==',
  ],
  [
    '@img/sharp-darwin-x64',
    '0.35.5',
    '+BR255RhDlpygUpOc/Jdt1nT6DQ3XG/ERo5wbcdOf5Q320dKtPCKPLR1LJs9VGXRaMa8l1uUa0tkCNOXiAxZUw==',
  ],
  [
    '@img/sharp-libvips-darwin-x64',
    '1.3.4',
    'iR2OKH80yi0U+dUplyh3/xdpFvps6YkCwsXenIJxqxR1v9o+xtKTGbS9H7cps+2Vxjc8B1j96p75NmTGjIhtpQ==',
  ],
] as const;
export const hash = (bytes: Uint8Array, algorithm: string, encoding: 'hex' | 'base64') =>
  createHash(algorithm).update(bytes).digest(encoding);
class DownloadRefused extends Error {}
const downloadAttempts = 3;
/** A dropped connection, a timeout or a server error is tried again, twice; a missing file is not.
 * The checksum decides what is kept, so a retry cannot change the result. */
export async function fetchBytes(url: string, attempts = downloadAttempts): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const last = attempt === attempts;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      if (response.status < 500 || last)
        throw new DownloadRefused(`Processor download failed (${response.status}): ${url}`);
    } catch (error) {
      if (error instanceof DownloadRefused || last) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}
export async function download(file: string, url: string, expected: string, algorithm = 'sha512') {
  let bytes: Buffer | undefined = await readFile(file).catch(() => undefined);
  if (!bytes) {
    bytes = await fetchBytes(url);
    if (hash(bytes, algorithm, algorithm === 'sha256' ? 'hex' : 'base64') !== expected)
      throw new Error(`Processor checksum mismatch: ${url}`);
    await writeFile(file, bytes, { flag: 'wx' });
  }
  if (hash(bytes, algorithm, algorithm === 'sha256' ? 'hex' : 'base64') !== expected)
    throw new Error(`Processor cache changed; it was preserved: ${file}`);
}
export async function run(
  command: string,
  args: string[],
  cwd: string,
  log: string,
  environment: NodeJS.ProcessEnv = {},
) {
  const handle = await open(log, 'a');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', handle.fd, handle.fd],
        env: { ...process.env, ...environment, LC_ALL: 'C' },
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Processor build failed (${command}, ${code}). Retained log: ${log}`)),
      );
    });
  } finally {
    await handle.close();
  }
}
async function processorFiles(output: string, arch: string, packageNames: string[]) {
  const files = new Map<string, string>();
  async function visit(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else if (!item.isFile()) throw new Error(`Invalid processor resource: ${file}`);
      else if (file !== path.join(output, 'manifest.json')) {
        files.set(path.relative(output, file), hash(await readFile(file), 'sha256', 'hex'));
      }
    }
  }
  await visit(output);
  const sharp = `@img/sharp-darwin-${arch}`;
  const sharpVersion = processorPackages.find(([name]) => name === sharp)![1];
  for (const name of [
    'ffmpeg',
    'ffprobe',
    'COPYING.LGPLv2.1',
    'ffmpeg-build.txt',
    `sources/ffmpeg-n${ffmpeg.version}.tar.gz`,
    ...packageNames.map((name) => `node_modules/${name}/package.json`),
    ...[
      'sharp/dist/index.cjs',
      '@img/colour/index.cjs',
      'detect-libc/lib/detect-libc.js',
      'semver/index.js',
      sharp + '/index.cjs',
      `${sharp}/lib/sharp-darwin-${arch}-${sharpVersion}.node`,
      `@img/sharp-libvips-darwin-${arch}/lib/libvips-cpp.8.18.7.dylib`,
    ].map((name) => 'node_modules/' + name),
  ]) {
    if (!files.has(name)) throw new Error(`Missing processor resource: ${name}`);
  }
  for (const name of ['ffmpeg', 'ffprobe'])
    if (!((await lstat(path.join(output, name))).mode & 0o111))
      throw new Error(`The processor ${name} is not executable.`);
  return Object.fromEntries(files);
}

export async function prepareProcessors(minimum: string, arch = process.arch, root = appRoot) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
    throw new Error('Packaged transform processors require a macOS arm64 or x64 build target.');
  const selectedPackages = processorPackages.filter(
    ([name]) => !name.includes('darwin-') || name.endsWith('-' + arch),
  );
  const packagePins = selectedPackages.map(([name, version, integrity]) => ({
    name,
    version,
    integrity: 'sha512-' + integrity,
  }));
  const output = path.join(root, `assets/viewer-processors-${process.platform}-${arch}`);
  const descriptor = path.join(output, 'manifest.json');
  const folder = await lstat(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  const names = packagePins.map((pin) => pin.name);
  if (folder) {
    if (!folder.isDirectory() || !(await lstat(descriptor)).isFile())
      throw new Error(`Invalid processor cache: ${output}`);
    const existing = JSON.parse(await readFile(descriptor, 'utf8')) as {
      version: string;
      minimum: string;
      arch: string;
      ffmpeg: typeof ffmpeg;
      packages: typeof packagePins;
      files: Record<string, string>;
    };
    if (
      existing.version !== ffmpeg.version ||
      !compatibleMacOSMinimum(existing.minimum, minimum) ||
      existing.arch !== arch ||
      !isDeepStrictEqual(existing.ffmpeg, ffmpeg) ||
      !isDeepStrictEqual(existing.packages, packagePins)
    )
      throw new Error(
        `The processor build differs from this target. Preserve and relocate it before rebuilding: ${output}`,
      );
    if (!isDeepStrictEqual(await processorFiles(output, arch, names), existing.files))
      throw new Error(`The retained processor files differ from the inventory: ${output}`);
    return;
  }
  const cache = path.join(root, 'out/processor-sources');
  await mkdir(cache, { recursive: true });
  const sourceArchive = path.join(cache, 'ffmpeg-n9.0.2.tar.gz');
  const supplied = process.env.VIEWER_PROCESSOR_SOURCE_ARCHIVE;
  if (supplied && !(await stat(sourceArchive).catch(() => undefined))) {
    const data = await readFile(supplied);
    if (hash(data, 'sha256', 'hex') !== ffmpeg.sha256)
      throw new Error('The supplied FFmpeg source archive does not match its pin.');
    await copyFile(supplied, sourceArchive, 1);
  }
  await download(sourceArchive, ffmpeg.url, ffmpeg.sha256, 'sha256');
  const build = await mkdtemp(path.join(cache, 'build-'));
  console.log('Preparing Viewer processors. Retained build:', build);
  await extract({
    file: sourceArchive,
    cwd: build,
    strict: true,
    keep: true,
    filter: (_name, item) =>
      'type' in item &&
      ['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(item.type),
  });
  const source = path.join(build, 'FFmpeg-n9.0.2');
  const target = arch === 'x64' ? 'x86_64' : 'arm64';
  const flags = [
    '--disable-gpl',
    '--disable-nonfree',
    '--disable-autodetect',
    '--disable-network',
    '--disable-doc',
    '--disable-debug',
    '--disable-ffplay',
    '--disable-shared',
    '--enable-static',
    '--enable-small',
    '--enable-videotoolbox',
    '--enable-audiotoolbox',
    '--enable-zlib',
    ...(arch === process.arch
      ? []
      : ['--enable-cross-compile', '--target-os=darwin', `--arch=${target}`, '--cc=clang']),
    ...(arch === 'x64' ? ['--disable-x86asm'] : []),
    `--extra-cflags=-arch ${target} -mmacosx-version-min=${minimum}`,
    `--extra-ldflags=-arch ${target} -mmacosx-version-min=${minimum}`,
  ];
  await run('./configure', flags, source, path.join(build, 'build.log'));
  await run('make', ['-j8', 'ffmpeg', 'ffprobe'], source, path.join(build, 'build.log'));
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await mkdir(path.join(output, 'sources'), { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe', 'COPYING.LGPLv2.1']) {
    await copyFile(path.join(source, name), path.join(output, name), 1);
    if (name !== 'COPYING.LGPLv2.1') await chmod(path.join(output, name), 0o755);
  }
  await copyFile(sourceArchive, path.join(output, 'sources/ffmpeg-n9.0.2.tar.gz'), 1);
  await writeFile(
    path.join(output, 'ffmpeg-build.txt'),
    `Official FFmpeg ${ffmpeg.version}\n${ffmpeg.url}\nSHA256 ${ffmpeg.sha256}\n./configure ${flags.join(' ')}\nmake -j8 ffmpeg ffprobe\nLGPL 2.1 or later; no GPL, nonfree or network components.\n`,
    { flag: 'wx' },
  );
  for (const [name, version, integrity] of selectedPackages) {
    const basename = name.split('/').at(-1)!;
    const url = `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
    const archive = path.join(cache, `${name.replace('/', '-')}-${version}.tgz`);
    await download(archive, url, integrity);
    const destination = path.join(output, 'node_modules', name);
    await mkdir(destination, { recursive: true });
    await extract({
      file: archive,
      cwd: destination,
      strip: 1,
      strict: true,
      keep: true,
      filter: (_name, item) =>
        'type' in item &&
        ['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(item.type),
    });
  }
  const files = await processorFiles(output, arch, names);
  await writeFile(
    descriptor,
    JSON.stringify(
      {
        version: ffmpeg.version,
        minimum,
        arch,
        ffmpeg,
        packages: packagePins,
        files,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
}
