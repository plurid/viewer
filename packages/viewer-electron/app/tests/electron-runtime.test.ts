import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import {
  bundledElectronVersion,
  electronRuntimeDistribution,
  ensureElectronRuntime,
} from '../tools/native-build/runtime';

const version = '44.7.0';
const name = `electron-v${version}-darwin-arm64.zip`;
const executable = 'Electron.app/Contents/MacOS/Electron';

function zipFile(content: string, mode = 0o100644): [Uint8Array, { os: number; attrs: number }] {
  return [strToU8(content), { os: 3, attrs: mode << 16 }];
}

function archive(extra: Zippable = {}): Uint8Array {
  return zipSync({
    version: zipFile(version),
    LICENSE: zipFile('Generated Electron MIT license.\n'),
    'LICENSES.chromium.html': zipFile('<p>Generated Chromium notices.</p>\n'),
    [executable]: zipFile('# Generated executable fixture.\n', 0o100755),
    'Electron.app/Contents/Info.plist': zipFile(
      '<?xml version="1.0"?><plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>13.0</string></dict></plist>',
    ),
    'electron.d.ts': zipFile('// Generated archived declaration.\n'),
    'Electron.app/Contents/Frameworks/Generated.framework/Versions/A/Generated': zipFile(
      'Generated framework fixture.\n',
    ),
    'Electron.app/Contents/Frameworks/Generated.framework/Versions/Current': zipFile('A', 0o120777),
    'Electron.app/Contents/Frameworks/Generated.framework/Generated': zipFile(
      'Versions/Current/Generated',
      0o120777,
    ),
    ...extra,
  });
}

async function fixture(bytes = archive()) {
  const root = await realpath(await temporaryRoot('viewer-electron-runtime-'));
  const appRoot = path.join(root, 'app');
  const packageRoot = path.join(appRoot, 'node_modules/electron');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(appRoot, 'package.json'), '{"name":"generated-runtime-fixture"}\n');
  const manifest = JSON.stringify({ name: 'electron', version, main: 'index.js' }) + '\n';
  await writeFile(path.join(packageRoot, 'package.json'), manifest);
  // A script-free Electron package must never be loaded through its lazy-installing index.
  await writeFile(
    path.join(packageRoot, 'index.js'),
    "throw new Error('Unexpected lazy installer');\n",
  );
  await writeFile(
    path.join(packageRoot, 'electron.d.ts'),
    '// Original pinned package declaration.\n',
  );
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(packageRoot, 'checksums.json'), JSON.stringify({ [name]: checksum }));
  const request = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(bytes)));
  const options = { appRoot, platform: 'darwin', arch: 'arm64', request };
  return { root, appRoot, packageRoot, manifest, checksum, bytes, request, options };
}

describe('retained Electron runtime bootstrap', () => {
  it('bootstraps a script-free package before license reads with the official extractor and preserves framework links', async () => {
    const files = await fixture();
    const options = {
      ...files.options,
      environment: {
        ELECTRON_MIRROR: 'http://must-not-use.invalid',
        ELECTRON_OVERRIDE_DIST_PATH: '/must-not-use',
      },
    };
    const runtime = await ensureElectronRuntime(options);
    expect(runtime.version).toBe(version);
    expect(runtime.executable).toBe(path.join(files.packageRoot, 'dist', executable));
    expect(await readFile(path.join(runtime.distRoot, 'LICENSE'), 'utf8')).toContain(
      'Generated Electron',
    );
    expect(await readFile(path.join(runtime.distRoot, 'LICENSES.chromium.html'), 'utf8')).toContain(
      'Chromium',
    );
    expect((await lstat(runtime.executable)).mode & 0o100).toBe(0o100);
    expect(await readFile(path.join(files.packageRoot, 'path.txt'), 'utf8')).toBe(executable);
    const framework = path.join(
      runtime.distRoot,
      'Electron.app/Contents/Frameworks/Generated.framework',
    );
    expect(await readlink(path.join(framework, 'Versions/Current'))).toBe('A');
    expect(await readFile(path.join(framework, 'Generated'), 'utf8')).toContain(
      'Generated framework',
    );
    expect(await readFile(path.join(files.packageRoot, 'package.json'), 'utf8')).toBe(
      files.manifest,
    );
    expect(await readFile(path.join(files.packageRoot, 'electron.d.ts'), 'utf8')).toContain(
      'Original pinned',
    );
    expect(await readFile(path.join(runtime.distRoot, 'electron.d.ts'), 'utf8')).toContain(
      'archived',
    );
    expect(files.request.mock.calls.map(([url]) => String(url))).toEqual([
      `${electronRuntimeDistribution}/v${version}/${name}`,
    ]);
    await expect(ensureElectronRuntime(options)).resolves.toEqual(runtime);
    expect(files.request).toHaveBeenCalledTimes(1);
  });

  it('reuses a retained checksum-verified ZIP for another fresh dependency tree', async () => {
    const bytes = archive();
    const first = await fixture(bytes);
    const cacheRoot = path.join(first.root, 'shared-cache');
    await ensureElectronRuntime({ ...first.options, cacheRoot });
    const second = await fixture(bytes);
    const runtime = await ensureElectronRuntime({ ...second.options, cacheRoot });
    expect(second.request).not.toHaveBeenCalled();
    expect(await readFile(path.join(runtime.distRoot, 'LICENSE'), 'utf8')).toContain('Generated');
    const cached = path.join(cacheRoot, version, 'darwin-arm64', name);
    expect(await readFile(cached)).toEqual(Buffer.from(bytes));
    const attempts = (await readdir(path.dirname(cached))).filter((file) =>
      file.startsWith('attempt-'),
    );
    expect(attempts).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(cached), attempts[0]!, name))).toEqual(
      Buffer.from(bytes),
    );
  });

  it('coalesces concurrent bootstrap calls for one package', async () => {
    const files = await fixture();
    const [first, second] = await Promise.all([
      ensureElectronRuntime(files.options),
      ensureElectronRuntime(files.options),
    ]);
    expect(first).toEqual(second);
    expect(files.request).toHaveBeenCalledTimes(1);
  });

  it('rejects checksum failures before loading the extractor and retains the failed download', async () => {
    const files = await fixture();
    await writeFile(
      path.join(files.packageRoot, 'checksums.json'),
      JSON.stringify({ [name]: '0'.repeat(64) }),
    );
    const extract = vi.fn(async () => {});
    await expect(ensureElectronRuntime({ ...files.options, extract })).rejects.toThrow(
      'checksum mismatch',
    );
    expect(extract).not.toHaveBeenCalled();
    await expect(lstat(path.join(files.packageRoot, 'dist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(lstat(path.join(files.packageRoot, 'path.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const cache = path.join(files.appRoot, 'out/native-cache/runtime', version, 'darwin-arm64');
    const [attempt] = await readdir(cache);
    expect(await readFile(path.join(cache, attempt!, name))).toEqual(Buffer.from(files.bytes));
  });

  it('refuses missing pinned checksums without downloading or creating a runtime', async () => {
    const files = await fixture();
    await writeFile(path.join(files.packageRoot, 'checksums.json'), '{}');
    await expect(ensureElectronRuntime(files.options)).rejects.toThrow('no valid checksum');
    expect(files.request).not.toHaveBeenCalled();
    await expect(lstat(path.join(files.packageRoot, 'dist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves existing partial runtimes and foreign executable paths', async () => {
    const files = await fixture();
    const dist = path.join(files.packageRoot, 'dist');
    await mkdir(dist);
    await writeFile(path.join(dist, 'sentinel.txt'), 'Kept partial runtime.\n');
    await expect(ensureElectronRuntime(files.options)).rejects.toThrow(
      'existing Electron runtime was preserved',
    );
    expect(await readFile(path.join(dist, 'sentinel.txt'), 'utf8')).toBe('Kept partial runtime.\n');
    expect(files.request).not.toHaveBeenCalled();

    const foreign = await fixture();
    await writeFile(path.join(foreign.packageRoot, 'path.txt'), 'Other.app/Executable');
    await expect(ensureElectronRuntime(foreign.options)).rejects.toThrow(
      'existing Electron executable path was preserved',
    );
    expect(await readFile(path.join(foreign.packageRoot, 'path.txt'), 'utf8')).toBe(
      'Other.app/Executable',
    );
    expect(foreign.request).not.toHaveBeenCalled();
  });

  it('refuses linked distribution roots and never writes into their targets', async () => {
    const files = await fixture();
    const target = path.join(files.root, 'retained');
    await mkdir(target);
    await symlink(target, path.join(files.packageRoot, 'dist'), 'dir');
    await expect(ensureElectronRuntime(files.options)).rejects.toThrow('preserved');
    expect(await readdir(target)).toEqual([]);
    expect(files.request).not.toHaveBeenCalled();
  });

  it('uses the official extractor path checks and keeps extraction failures without publishing path.txt', async () => {
    const files = await fixture(archive({ '../escaped.txt': zipFile('Must never escape.\n') }));
    await expect(ensureElectronRuntime(files.options)).rejects.toThrow(/escapes|refusing/i);
    await expect(lstat(path.join(files.packageRoot, 'escaped.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(lstat(path.join(files.packageRoot, 'path.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(path.join(files.packageRoot, 'dist'))).isDirectory()).toBe(true);
    expect(files.request).toHaveBeenCalledTimes(1);
  });
});

it.runIf(process.platform === 'darwin')('reads the Electron a packaged app runs', async () => {
  const app = path.join(await temporaryRoot('viewer-bundled-electron-'), 'Viewer.app');
  const resources = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Resources');
  await mkdir(resources, { recursive: true });
  await writeFile(
    path.join(resources, 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>' +
      '<key>CFBundleVersion</key><string>45.1.0</string></dict></plist>\n',
  );
  expect(await bundledElectronVersion(app)).toBe('45.1.0');
});
