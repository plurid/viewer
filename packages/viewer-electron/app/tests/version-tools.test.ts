import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { restoreAlphaVersion } from '../tools/bundle-version';
import { nextManifestVersion } from '../tools/next-version';
import { temporaryRoot } from '../tools/temporary';

it('prepares the next release by changing only the manifest version', async () => {
  const root = await temporaryRoot('viewer-next-version-');
  const file = path.join(root, 'package.json');
  const manifest = { name: 'viewer-electron', version: '0.1.0-0', scripts: { check: 'tsc' } };
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  expect(await nextManifestVersion(file)).toBe('0.1.0-1');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ...manifest, version: '0.1.0-1' });
});

it('leaves an invalid manifest unchanged instead of producing a version with another ender', async () => {
  const root = await temporaryRoot('viewer-invalid-version-');
  const file = path.join(root, 'package.json');
  const text = JSON.stringify({ version: '1.0.0-0' });
  await writeFile(file, text);
  await expect(nextManifestVersion(file)).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe(text);
});

it('restores the alpha version inside the Store copy without changing its source manifest', async () => {
  const root = await temporaryRoot('viewer-store-version-');
  const source = path.join(root, 'package.json');
  const staged = path.join(root, 'staged');
  const manifest = { name: 'viewer-electron', version: '0.1.0-0', main: 'main.cjs' };
  const original = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(source, original);
  await mkdir(staged);
  await writeFile(
    path.join(staged, 'package.json'),
    JSON.stringify({ ...manifest, version: '1.0.0' }),
  );
  await restoreAlphaVersion(staged, manifest.version);
  expect(JSON.parse(await readFile(path.join(staged, 'package.json'), 'utf8'))).toEqual(manifest);
  expect(await readFile(source, 'utf8')).toBe(original);
});
