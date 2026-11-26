import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { inspectHeaderArchive } from '../tools/native-build/archive';
import { downloadRetainedArtifact, expectedArchiveHash } from '../tools/native-build/download';
import { electronHeadersDistribution, ensureElectronHeaders } from '../tools/native-build/headers';
import { assertSeedArchitecture } from '../tools/native-build/runtime';
import { officeRuntimeName } from '../src/desktop/previews/office-runtime-manifest';

const preservingEntry = fileURLToPath(new URL('../tools/build-preserving.ts', import.meta.url));
const runPreserving = (args: string[], env: NodeJS.ProcessEnv, entry = preservingEntry) =>
  promisify(execFile)(process.execPath, ['--import', 'tsx', entry, ...args], { env });

it('filters publisher keys before the preserving build loads its dependencies', async () => {
  const root = await temporaryRoot('viewer-preserving-env-');
  const probe = path.join(root, 'probe.mjs');
  const captured = path.join(root, 'plugin-environment.json');
  const parent = path.join(root, 'launcher-pid');
  const publisher = {
    VIEWER_UPDATE_SIGNING_KEY: 'dummy',
    VIEWER_UPDATE_SIGNING_KEY_FILE: 'dummy',
    VIEWER_LICENSE_SIGNING_KEY: 'dummy',
    VIEWER_LICENSE_SIGNING_KEY_FILE: 'dummy',
  };
  await writeFile(
    probe,
    `
    import { isBuiltin, registerHooks } from 'node:module';
    import { writeFileSync } from 'node:fs';
    if (process.argv[1] === ${JSON.stringify(preservingEntry)})
      writeFileSync(${JSON.stringify(parent)}, String(process.pid), { flag: 'wx' });
    registerHooks({
      resolve(name, context, next) {
        const parentURL = context.parentURL || '';
        const fromBuild = parentURL.startsWith(${JSON.stringify(new URL('../', import.meta.url).href)})
          && /[.](?:[cm]?[jt]sx?)(?:[?#].*)?$/.test(parentURL)
          && !parentURL.includes('/node_modules/') && process.argv[1] !== ${JSON.stringify(preservingEntry)};
        const external = !isBuiltin(name) && !name.startsWith('.') && !name.startsWith('/') && !name.includes(':');
        if (fromBuild && external && ${JSON.stringify(Object.keys(publisher))}.some(key => key in process.env))
          throw new Error('Unfiltered third-party build import: ' + name);
        if (name === 'vite' && context.parentURL?.includes('build-preserving')) {
          const keys = Object.keys(process.env).filter(key => ${JSON.stringify(Object.keys(publisher))}.includes(key));
          writeFileSync(${JSON.stringify(captured)}, JSON.stringify({ keys, parent: process.ppid }), { flag: 'wx' });
          throw new Error('Stopped at the fixture plugin boundary.');
        }
        return next(name, context);
      }
    });`,
  );
  const env = {
    ...process.env,
    ...publisher,
    NODE_OPTIONS: '--import=' + pathToFileURL(probe).href,
  };
  const payload = fileURLToPath(new URL('../tools/build-preserving-payload.ts', import.meta.url));
  await expect(runPreserving([], env, payload)).rejects.toThrow(/publisher.*environment/i);
  const emptyKeys = Object.fromEntries(Object.keys(publisher).map((name) => [name, '']));
  await expect(runPreserving([], { ...env, ...emptyKeys }, payload)).rejects.toThrow(
    /publisher.*environment/i,
  );
  const implementation = new URL('../tools/build-preserving-rebuild.ts', import.meta.url);
  await expect(runPreserving([], env, fileURLToPath(implementation))).resolves.toMatchObject({
    stdout: '',
  });
  const call =
    'const { rebuildFromSeed } = await import(' +
    JSON.stringify(implementation.href) +
    '); await rebuildFromSeed()';
  await expect(
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', call],
      { env },
    ),
  ).rejects.toThrow(/publisher.*environment/i);
  await expect(lstat(captured)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(runPreserving([], env)).rejects.toThrow(/fixture plugin boundary/);
  expect(JSON.parse(await readFile(captured, 'utf8'))).toEqual({
    keys: [],
    parent: Number(await readFile(parent, 'utf8')),
  });
});

it.runIf(process.platform === 'darwin')(
  'refuses a speech target that differs from the seed executable',
  async () => {
    const root = await temporaryRoot('viewer-preserving-arch-');
    const seed = path.join(root, 'Seed.app');
    const contents = path.join(seed, 'Contents');
    const executable = path.join(contents, 'MacOS', 'Fixture');
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await writeFile(
      path.join(contents, 'Info.plist'),
      '<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>',
    );
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(2, 12);
    await writeFile(executable, header);
    await expect(assertSeedArchitecture(seed, 'arm64')).resolves.toBeUndefined();
    await expect(
      runPreserving([seed, path.join(root, 'Result.app')], {
        ...process.env,
        VIEWER_BUILD_ARCH: 'x64',
      }),
    ).rejects.toThrow(/seed.*arm64.*x64/i);
    expect(await readdir(root)).toEqual(['Seed.app']);

    const arm = path.join(root, 'arm64');
    await writeFile(arm, header);
    header.writeUInt32LE(0x01000007, 4);
    header.writeUInt32LE(3, 8);
    await writeFile(executable, header);
    await expect(assertSeedArchitecture(seed, 'x64')).resolves.toBeUndefined();
    const intel = path.join(root, 'x64');
    await writeFile(intel, header);
    const fat = path.join(root, 'universal');
    await promisify(execFile)('/usr/bin/lipo', ['-create', arm, intel, '-output', fat]);
    await writeFile(executable, await readFile(fat));
    await expect(assertSeedArchitecture(seed, 'arm64')).rejects.toThrow(/single-architecture/);
  },
);

it('uses the Forge ASAR unpack and microphone settings in preserving rebuilds', async () => {
  const source = await readFile(
    new URL('../tools/build-preserving-rebuild.ts', import.meta.url),
    'utf8',
  );
  expect(source).toMatch(/createPackageWithOptions\(unpacked, archive, \{ unpack: asarUnpack \}\)/);
  expect(source).toMatch(/packagerConfig\?\.asar/);
  expect(source).toMatch(/extendInfo[^\n]*NSMicrophoneUsageDescription/);
});

it('uploads the Office runtime version used by the smoke build', async () => {
  const workflow = await readFile(
    new URL('../../../../.github/workflows/office-runtime.yml', import.meta.url),
    'utf8',
  );
  expect(workflow.match(/packages\/viewer-electron\/app\/assets\/viewer-office-v\d+/g)).toEqual([
    'packages/viewer-electron/app/assets/' + officeRuntimeName,
  ]);
});

it('uses the bundled OpenCascade sample as the model navigation fixture', async () => {
  const source = await readFile(new URL('./native-model-navigation.ts', import.meta.url), 'utf8');
  const sample = 'test/testfiles/simple-basic-cube/cube.stp';
  expect(source).toContain('process.env.VIEWER_TEST_STEP_FILE');
  expect(source.includes(sample)).toBe(true);
  expect(/['"]\/Users\//.test(source)).toBe(false);
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('occt-import-js/package.json'));
  expect(await readFile(path.join(root, sample), 'utf8')).toContain('ISO-10303-21;');
});

const version = '44.7.0';
const archiveName = `node-v${version}-headers.tar.gz`;

interface ArchiveEntry {
  path: string;
  body?: string;
  type?: 'File' | 'SymbolicLink' | 'Link';
  linkpath?: string;
  declaredSize?: number;
}

function archive(entries: ArchiveEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const header = new Header({
      path: entry.path,
      mode: 0o644,
      size: entry.declaredSize ?? body.length,
      type: entry.type ?? 'File',
      linkpath: entry.linkpath,
    });
    header.encode();
    blocks.push(header.block!, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function nativeArchive(): Buffer {
  return archive(
    [
      'node.h',
      'node_version.h',
      'node_api.h',
      'js_native_api.h',
      'js_native_api_types.h',
      'config.gypi',
    ].map((name) => ({
      path: `node_headers/include/node/${name}`,
      body: name === 'config.gypi' ? '{"built_with_electron": 1}' : `// Generated ${name}\n`,
    })),
  );
}

function provider(bytes = nativeArchive(), checksum?: string) {
  const hash = checksum ?? createHash('sha256').update(bytes).digest('hex');
  return vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('SHASUMS256.txt')
      ? new Response(`${hash}  ${archiveName}\n`)
      : new Response(new Uint8Array(bytes)),
  );
}

async function fixture() {
  const root = await realpath(await temporaryRoot('viewer-native-build-'));
  const appRoot = path.join(root, 'app');
  await mkdir(appRoot);
  return { root, appRoot };
}

describe('retained Electron header provisioning', () => {
  it('downloads, verifies and reuses a fresh cache without a home directory or inherited npm overrides', async () => {
    const { root, appRoot } = await fixture();
    const request = provider();
    const options = {
      appRoot,
      electronVersion: version,
      arch: 'arm64',
      environment: {
        HOME: path.join(root, 'unused-home'),
        npm_config_devdir: '/must-not-use',
        npm_config_dist_url: 'http://must-not-use.invalid',
        npm_package_config_node_gyp_target: '1.0.0',
      },
      request,
    };
    const [headers, concurrent] = await Promise.all([
      ensureElectronHeaders(options),
      ensureElectronHeaders(options),
    ]);
    const cache = path.join(appRoot, 'out/native-cache/electron');
    expect(headers).toBe(path.join(cache, version, 'include/node'));
    expect(concurrent).toBe(headers);
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      `${electronHeadersDistribution}/v${version}/SHASUMS256.txt`,
      `${electronHeadersDistribution}/v${version}/${archiveName}`,
    ]);
    const attempts = await readdir(path.join(cache, 'downloads'));
    expect(attempts).toHaveLength(1);
    expect(await readdir(path.join(cache, 'downloads', attempts[0]!))).toEqual([
      'SHASUMS256.txt',
      archiveName,
    ]);
    expect(await readFile(path.join(headers, 'node_api.h'), 'utf8')).toContain('Generated');
    await expect(ensureElectronHeaders({ ...options, arch: 'x64' })).resolves.toBe(headers);
    expect(request).toHaveBeenCalledTimes(2);
    await expect(lstat(options.environment.HOME)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an edited or incomplete cache and refuses to re-extract over it', async () => {
    const { appRoot } = await fixture();
    const request = provider();
    const options = { appRoot, electronVersion: version, arch: 'arm64', request };
    const headers = await ensureElectronHeaders(options);
    const edited = path.join(headers, 'node_api.h');
    await writeFile(edited, '// Kept changed header\n');
    await expect(ensureElectronHeaders(options)).rejects.toThrow('preserved');
    expect(await readFile(edited, 'utf8')).toBe('// Kept changed header\n');
    expect(request).toHaveBeenCalledTimes(2);

    const fresh = await fixture();
    const cacheRoot = path.join(fresh.root, 'incomplete');
    await mkdir(path.join(cacheRoot, version), { recursive: true });
    const sentinel = path.join(cacheRoot, version, 'sentinel.txt');
    await writeFile(sentinel, 'preserve');
    const unused = provider();
    await expect(
      ensureElectronHeaders({ ...options, appRoot: fresh.appRoot, cacheRoot, request: unused }),
    ).rejects.toThrow('preserved');
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
    expect(unused).not.toHaveBeenCalled();
  });

  it('rejects linked cache roots and linked version entries without following or replacing them', async () => {
    const { root, appRoot } = await fixture();
    const actual = path.join(root, 'actual');
    const linked = path.join(root, 'linked');
    await mkdir(actual);
    await symlink(actual, linked, 'dir');
    const request = provider();
    const options = { appRoot, electronVersion: version, arch: 'arm64', request };
    await expect(ensureElectronHeaders({ ...options, cacheRoot: linked })).rejects.toThrow(
      'ordinary directories',
    );
    const cacheRoot = path.join(root, 'versions');
    await mkdir(cacheRoot);
    await symlink(actual, path.join(cacheRoot, version), 'dir');
    await expect(ensureElectronHeaders({ ...options, cacheRoot })).rejects.toThrow('preserved');
    expect((await lstat(path.join(cacheRoot, version))).isSymbolicLink()).toBe(true);
    expect(await readdir(actual)).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps checksum failures for diagnosis before creating an extraction directory', async () => {
    const { appRoot } = await fixture();
    const bytes = nativeArchive();
    await expect(
      ensureElectronHeaders({
        appRoot,
        electronVersion: version,
        arch: 'arm64',
        request: provider(bytes, '0'.repeat(64)),
      }),
    ).rejects.toThrow('checksum mismatch');
    const cache = path.join(appRoot, 'out/native-cache/electron');
    await expect(lstat(path.join(cache, version))).rejects.toMatchObject({ code: 'ENOENT' });
    const [attempt] = await readdir(path.join(cache, 'downloads'));
    expect(await readFile(path.join(cache, 'downloads', attempt!, archiveName))).toEqual(bytes);
    expect(
      await readFile(path.join(cache, 'downloads', attempt!, 'SHASUMS256.txt'), 'utf8'),
    ).toContain('0'.repeat(64));
  });

  it.each([
    { path: '../outside.h' },
    { path: '/outside.h' },
    { path: 'node_headers/include/node/../outside.h' },
    {
      path: 'node_headers/include/node/link.h',
      type: 'SymbolicLink' as const,
      linkpath: '/outside',
    },
    { path: 'node_headers/include/node/link.h', type: 'Link' as const, linkpath: '/outside' },
    { path: 'node_headers/include/node/huge.h', declaredSize: 17 * 1024 * 1024 },
  ])('rejects unsafe archive entry $path without extraction', async (entry) => {
    const { root } = await fixture();
    const file = path.join(root, 'unsafe.tar.gz');
    await writeFile(file, archive([entry]));
    await expect(inspectHeaderArchive(file)).rejects.toThrow();
    expect(await readFile(file)).toEqual(archive([entry]));
  });

  it('rejects archive names that would collide on a case-insensitive volume', async () => {
    const { root } = await fixture();
    const file = path.join(root, 'duplicates.tar.gz');
    await writeFile(
      file,
      archive([
        { path: 'node_headers/include/node/name.h' },
        { path: 'node_headers/include/node/NAME.h' },
      ]),
    );
    await expect(inspectHeaderArchive(file)).rejects.toThrow('Duplicate');
  });

  it.each([false, true])(
    'rejects conflicting file and directory entries in either order (%s)',
    async (reverse) => {
      const { root } = await fixture();
      const file = path.join(root, 'conflicting.tar.gz');
      const entries = [
        { path: 'node_headers/include/node/parent.h' },
        { path: 'node_headers/include/node/parent.h/child.h' },
      ];
      await writeFile(file, archive(reverse ? entries.reverse() : entries));
      await expect(inspectHeaderArchive(file)).rejects.toThrow('also a directory');
    },
  );

  it('rejects unsupported architecture and nonexact versions without starting a download', async () => {
    const { appRoot } = await fixture();
    const request = provider();
    await expect(
      ensureElectronHeaders({ appRoot, electronVersion: version, arch: 'ia32', request }),
    ).rejects.toThrow('arm64 and x64');
    await expect(
      ensureElectronHeaders({ appRoot, electronVersion: '../other', arch: 'arm64', request }),
    ).rejects.toThrow('exact Electron version');
    expect(request).not.toHaveBeenCalled();
    expect(await readdir(appRoot)).toEqual([]);
  });
});

describe('bounded header downloads', () => {
  it('requires an unambiguous archive checksum', () => {
    expect(expectedArchiveHash(`${'a'.repeat(64)}  ${archiveName}`, archiveName)).toBe(
      'a'.repeat(64),
    );
    expect(() => expectedArchiveHash('not a checksum', archiveName)).toThrow('exactly one');
    expect(() =>
      expectedArchiveHash(
        `${'a'.repeat(64)}  ${archiveName}\n${'a'.repeat(64)}  ${archiveName}`,
        archiveName,
      ),
    ).toThrow('exactly one');
  });

  it('bounds streamed downloads and keeps the partial artifact without overwriting another file', async () => {
    const { root } = await fixture();
    const destination = path.join(root, 'partial');
    const request = vi.fn<typeof fetch>(async () => new Response('too large'));
    await expect(
      downloadRetainedArtifact('https://example.invalid/headers', destination, 3, request),
    ).rejects.toThrow('exceeds');
    expect(await readFile(destination, 'utf8')).toBe('');
    await writeFile(destination, 'kept');
    await expect(
      downloadRetainedArtifact('https://example.invalid/headers', destination, 100, request),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(destination, 'utf8')).toBe('kept');
  });
});
