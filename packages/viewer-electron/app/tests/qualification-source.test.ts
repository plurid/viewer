import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceHash } from '../tools/qualification/source';
import { temporaryRoot } from '../tools/temporary';

async function fixture() {
  const workspace = await realpath(await temporaryRoot('viewer-source-fingerprint-'));
  const appRoot = path.join(workspace, 'packages/viewer-electron/app');
  const files = [
    'src/main.ts',
    'tests/example.test.ts',
    'tools/build.ts',
    'package.json',
    'assets/icon.png',
    'assets/icon.icns',
    'assets/512x512.png',
    'assets/entitlements.mac.plist',
    'assets/licenses/README.txt',
    'assets/licenses/opencascade.txt',
    'assets/licenses/occt-import-js.txt',
    'assets/licenses/ssf-0.11.2.txt',
    'assets/vendor/ssf-0.11.2.mjs',
    'assets/vendor/ssf-0.11.2.d.mts',
    'assets/vendor/ssf-0.11.2.json',
  ];
  for (const file of files) {
    const destination = path.join(appRoot, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `Generated fixture ${file}\n`);
  }
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    await writeFile(path.join(workspace, file), `Generated fixture ${file}\n`);
  return { workspace, appRoot };
}

describe('qualification source fingerprint', () => {
  it('includes workspace install policy and both optional npmrc files', async () => {
    const { workspace, appRoot } = await fixture();
    const baseline = await sourceHash(appRoot);
    expect(await sourceHash(appRoot)).toBe(baseline);
    const policy = path.join(workspace, 'pnpm-workspace.yaml');
    const original = await readFile(policy);
    await writeFile(policy, 'nodeLinker: isolated\n');
    expect(await sourceHash(appRoot)).not.toBe(baseline);
    await writeFile(policy, original);
    expect(await sourceHash(appRoot)).toBe(baseline);

    await writeFile(path.join(workspace, '.npmrc'), 'registry=https://registry.npmjs.org/\n');
    const workspaceConfig = await sourceHash(appRoot);
    expect(workspaceConfig).not.toBe(baseline);
    await writeFile(path.join(workspace, '.npmrc'), 'ignore-scripts=true\n');
    const editedConfig = await sourceHash(appRoot);
    expect(editedConfig).not.toBe(workspaceConfig);
    await writeFile(path.join(appRoot, '.npmrc'), 'verify-deps-before-run=error\n');
    expect(await sourceHash(appRoot)).not.toBe(editedConfig);
  });

  it('refuses linked install configuration without reading the target', async () => {
    const { workspace, appRoot } = await fixture();
    const retained = path.join(workspace, 'retained-config');
    await writeFile(retained, 'Generated private fixture\n');
    await symlink(retained, path.join(workspace, '.npmrc'));
    await expect(sourceHash(appRoot)).rejects.toThrow('regular file');
    expect(await readFile(retained, 'utf8')).toBe('Generated private fixture\n');
  });
});
