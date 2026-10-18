import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inspectInstall, updatedManifest, verifyDistribution } from '../tools/lib/plurid-registry';

const plan = {
  direct: ['@plurid/a'],
  versions: { '@plurid/a': '0.0.0-2', '@plurid/b': '0.0.0-3' },
};
function fixture() {
  // Retained by design under the workspace's artifact preservation policy.
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'viewer-plurid-registry-'));
  const app = path.join(workspace, 'app');
  mkdirSync(app);
  writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ dependencies: { '@plurid/a': '0.0.0-2' } }),
  );
  function install(name: string, version: string, dependencies = {}) {
    const directory = path.join(workspace, 'node_modules', name);
    mkdirSync(path.join(directory, 'distribution'), { recursive: true });
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name, version, main: 'distribution/index.js', dependencies }),
    );
    writeFileSync(path.join(directory, 'distribution/index.js'), 'module.exports = 1;');
    return directory;
  }
  const a = install('@plurid/a', '0.0.0-2', { '@plurid/b': '^0.0.0-3' });
  const b = install('@plurid/b', '0.0.0-3');
  return { app, workspace, a, b };
}
function archive(content: string) {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write('package/distribution/index.js');
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header[156] = 48;
  const bytes = gzipSync(
    Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]),
  );
  return { bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
}

describe('Plurid registry qualification', () => {
  it('updates only the direct pins without mutating the current manifest', () => {
    const current = { dependencies: { '@plurid/a': '0.0.0-1', react: '19.3.0' }, version: '0.1.0' };
    expect(updatedManifest(current, plan)).toEqual({
      ...current,
      dependencies: { '@plurid/a': '0.0.0-2', react: '19.3.0' },
    });
    expect(current.dependencies['@plurid/a']).toBe('0.0.0-1');
  });
  it('resolves the entire installed graph and refuses stale transitive versions', () => {
    const f = fixture();
    expect(inspectInstall(f.app, f.workspace, plan).map((p) => p.manifest.name)).toEqual([
      '@plurid/a',
      '@plurid/b',
    ]);
    writeFileSync(
      path.join(f.b, 'package.json'),
      JSON.stringify({ name: '@plurid/b', version: '0.0.0-2', main: 'distribution/index.js' }),
    );
    expect(() => inspectInstall(f.app, f.workspace, plan)).toThrow(/Unexpected Plurid package/);
  });
  it('rejects source-sync stamps and local links outside the installation', () => {
    const f = fixture();
    writeFileSync(path.join(f.a, 'distribution/.synced-from.json'), '{}');
    expect(() => inspectInstall(f.app, f.workspace, plan)).toThrow(/Source-synced/);
    const other = fixture();
    const link = path.join(other.workspace, 'node_modules/@plurid/c');
    symlinkSync(f.a, link, 'dir');
    writeFileSync(
      path.join(other.app, 'package.json'),
      JSON.stringify({ dependencies: { '@plurid/c': '0.0.0-2' } }),
    );
    expect(() =>
      inspectInstall(other.app, other.workspace, {
        direct: ['@plurid/c'],
        versions: { '@plurid/c': '0.0.0-2' },
      }),
    ).toThrow(/local link outside/);
  });
  it('rejects a linked installation root', () => {
    const f = fixture();
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'viewer-plurid-linked-root-'));
    const app = path.join(workspace, 'app');
    mkdirSync(app);
    writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({ dependencies: { '@plurid/a': '0.0.0-2' } }),
    );
    symlinkSync(
      path.join(f.workspace, 'node_modules'),
      path.join(workspace, 'node_modules'),
      'dir',
    );
    expect(() => inspectInstall(app, workspace, plan)).toThrow(/local link replaces node_modules/);
  });
  it('checks actual registry output bytes and rejects retained chunks and corrupt tarballs', () => {
    const f = fixture();
    const installed = { directory: f.a, manifest: { name: '@plurid/a', version: '0.0.0-2' } };
    const { bytes, integrity } = archive('module.exports = 1;');
    expect(() => verifyDistribution(installed, bytes, integrity)).not.toThrow();
    writeFileSync(path.join(f.a, 'distribution/old-chunk.js'), 'stale');
    expect(() => verifyDistribution(installed, bytes, integrity)).toThrow(/differs from registry/);
    expect(() => verifyDistribution(installed, bytes, 'sha512-bad')).toThrow(/integrity mismatch/);
  });
  it('rejects unstamped source overlays even when the manifest version matches', () => {
    const f = fixture();
    const installed = { directory: f.a, manifest: { name: '@plurid/a', version: '0.0.0-2' } };
    const { bytes, integrity } = archive('module.exports = 2;');
    expect(() => verifyDistribution(installed, bytes, integrity)).toThrow(/differs from registry/);
    expect(readFileSync(path.join(f.a, 'distribution/index.js'), 'utf8')).toBe(
      'module.exports = 1;',
    );
  });
});
