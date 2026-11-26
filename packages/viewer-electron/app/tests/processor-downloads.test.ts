import { afterEach, expect, it, vi } from 'vitest';
import { fetchBytes, ffmpeg, prepareProcessors, processorPackages } from '../tools/processors';
import type * as fs from 'node:fs/promises';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryRoot } from '../tools/temporary';

const readFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  readFile,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  readFile.mockReset();
});

it('refuses stale processor build inputs without touching its resources', async () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
  const manifest = {
    version: ffmpeg.version,
    minimum: '14.0',
    arch: 'arm64',
    ffmpeg,
    packages: processorPackages
      .filter(([name]) => !name.endsWith('-x64'))
      .map(([name, version, integrity]) => ({ name, version, integrity: 'sha512-' + integrity })),
    files: {},
  };
  const root = await temporaryRoot('viewer-processor-pins-');
  const output = path.join(root, 'assets/viewer-processors-darwin-arm64');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'manifest.json'), '{}');
  for (const stale of [
    { arch: 'x64' },
    { ffmpeg: { ...ffmpeg, sha256: 'previous-archive' } },
    { packages: manifest.packages.map((pin) => ({ ...pin, version: '0.0.1' })) },
  ]) {
    readFile.mockClear();
    readFile.mockResolvedValueOnce(JSON.stringify({ ...manifest, ...stale }));
    await expect(prepareProcessors('14.0', 'arm64', root)).rejects.toThrow('Preserve and relocate');
    expect(readFile).toHaveBeenCalledOnce();
    expect(readFile.mock.calls[0]?.[0]).toMatch(/viewer-processors-darwin-arm64\/manifest\.json$/);
  }
});

it('requires the selected package assets, both executables and a complete retained inventory', async () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
  readFile.mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).readFile);
  const packages = processorPackages
    .filter(([name]) => !name.endsWith('-x64'))
    .map(([name, version, integrity]) => ({ name, version, integrity: 'sha512-' + integrity }));
  const required = [
    'ffmpeg',
    'ffprobe',
    'ffmpeg-build.txt',
    'COPYING.LGPLv2.1',
    'sources/ffmpeg-n9.0.2.tar.gz',
    ...packages.map(({ name }) => 'node_modules/' + name + '/package.json'),
    ...[
      'sharp/dist/index.cjs',
      '@img/colour/index.cjs',
      'detect-libc/lib/detect-libc.js',
      'semver/index.js',
      '@img/sharp-darwin-arm64/index.cjs',
      '@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node',
      '@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib',
    ].map((name) => 'node_modules/' + name),
  ];
  for (const missing of [
    undefined,
    'ffprobe',
    'node_modules/sharp/dist/index.cjs',
    'unlisted',
    '__proto__',
  ]) {
    const root = await temporaryRoot('viewer-processor-inventory-');
    const output = path.join(root, 'assets/viewer-processors-darwin-arm64');
    const files: Record<string, string> = {};
    for (const name of required.filter((name) => name !== missing)) {
      const file = path.join(output, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, name);
      if (['ffmpeg', 'ffprobe'].includes(name)) await chmod(file, 0o755);
      files[name] = createHash('sha256').update(name).digest('hex');
    }
    if (missing === 'unlisted' || missing === '__proto__')
      await writeFile(path.join(output, missing), 'extra');
    await writeFile(
      path.join(output, 'manifest.json'),
      JSON.stringify({
        version: ffmpeg.version,
        minimum: '14.0',
        arch: 'arm64',
        ffmpeg,
        packages,
        files,
      }),
    );
    const check = prepareProcessors('14.0', 'arm64', root);
    if (missing) await expect(check).rejects.toThrow(/processor/i);
    else await expect(check).resolves.toBeUndefined();
  }
});

/** Answers each request with the next outcome: a status, or an error thrown as a dropped link. */
function server(...outcomes: (number | Error)[]) {
  const fetch = vi.fn(async () => {
    const outcome = outcomes.shift()!;
    if (outcome instanceof Error) throw outcome;
    return new Response(outcome === 200 ? 'source' : null, { status: outcome });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function settled<T>(work: Promise<T>) {
  const outcome = work.then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

it('tries a dropped connection and a server error again, and keeps the third answer', async () => {
  vi.useFakeTimers();
  const fetch = server(new TypeError('fetch failed'), 503, 200);
  const result = await settled(fetchBytes('https://example.org/source.tar.gz'));
  expect(result).toEqual({ value: Buffer.from('source') });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('stops at once on a missing file, and after three failures', async () => {
  vi.useFakeTimers();
  const missing = server(404);
  expect(await settled(fetchBytes('https://example.org/missing'))).toEqual({
    error: new Error('Processor download failed (404): https://example.org/missing'),
  });
  expect(missing).toHaveBeenCalledTimes(1);
  const down = server(new TypeError('fetch failed'), 502, new TypeError('fetch failed'), 200);
  expect(await settled(fetchBytes('https://example.org/down'))).toEqual({
    error: new TypeError('fetch failed'),
  });
  expect(down).toHaveBeenCalledTimes(3);
});
