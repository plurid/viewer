import { expect, it, vi } from 'vitest';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendOfficeData, officeFontMetadata } from '../tools/office-font-package';
import { temporaryRoot } from '../tools/temporary';
import { prepareOfficeRuntime } from '../tools/office-runtime';
import { officeEngineName } from '../src/desktop/previews/office-runtime-manifest';
import { officeFontConfiguration } from '../src/desktop/previews/office-font-manifest';

const base = { files: [{ filename: '/engine', start: 0, end: 4 }], remote_package_size: 4 };
const font = { virtualPath: '/instdir/share/fonts/truetype/Example.ttc', bytes: 3 };

it('refuses a redirected source cache before downloading or writing assets', async () => {
  const root = await temporaryRoot('viewer-office-font-link-');
  await mkdir(path.join(root, 'assets'));
  const other = path.join(root, 'other');
  await mkdir(other);
  await symlink(other, path.join(root, 'assets', officeEngineName));
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected download'));
  try {
    await expect(prepareOfficeRuntime(root)).rejects.toThrow('Invalid Office asset folder');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

it('extends the package without shifting engine ranges or modifying input metadata', () => {
  const before = structuredClone(base);
  expect(JSON.parse(officeFontMetadata(base, [font]).toString())).toEqual({
    files: [...base.files, { filename: font.virtualPath, start: 4, end: 7 }],
    remote_package_size: 7,
  });
  expect(base).toEqual(before);
});

it('refuses damaged ranges and duplicate or escaping virtual paths', () => {
  for (const raw of [
    { ...base, remote_package_size: 8 },
    { ...base, files: [{ filename: '/engine', start: 1, end: 4 }] },
    { ...base, files: [{ filename: '/engine', start: 0, end: -1 }] },
    { ...base, files: [{ filename: '/a/../engine', start: 0, end: 4 }] },
  ])
    expect(() => officeFontMetadata(raw, [font])).toThrow();
  for (const virtualPath of [
    '/tmp/Font.ttc',
    font.virtualPath + '\0',
    '/instdir/share/fonts/truetype/../Font.ttc',
    '/instdir/share/fontconfig/conf.d/unreviewed.conf',
    '/instdir/share/fontconfig/conf.d/../99-viewer-cjk.conf',
  ])
    expect(() => officeFontMetadata(base, [{ ...font, virtualPath }])).toThrow();
  expect(() => officeFontMetadata(base, [font, font])).toThrow();
  expect(() => officeFontMetadata(base, [{ ...font, bytes: 0 }])).toThrow();
});

it('appends only the owned fallback configuration after the fonts', () => {
  const configuration = { virtualPath: officeFontConfiguration.virtualPath, bytes: 5 };
  expect(JSON.parse(officeFontMetadata(base, [font, configuration]).toString())).toEqual({
    files: [
      ...base.files,
      { filename: font.virtualPath, start: 4, end: 7 },
      { filename: configuration.virtualPath, start: 7, end: 12 },
    ],
    remote_package_size: 12,
  });
  expect(() => officeFontMetadata(base, [configuration, configuration])).toThrow();
});

it('streams source bytes in order and refuses to replace an existing output', async () => {
  const root = await temporaryRoot('viewer-office-font-package-');
  const first = path.join(root, 'engine'),
    second = path.join(root, 'font'),
    output = path.join(root, 'package');
  await writeFile(first, 'ABCD', { flag: 'wx' });
  await writeFile(second, 'XYZ', { flag: 'wx' });
  await appendOfficeData(output, [first, second]);
  expect(await readFile(output, 'utf8')).toBe('ABCDXYZ');
  await expect(appendOfficeData(output, [second])).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(first, 'utf8')).toBe('ABCD');
  expect(await readFile(output, 'utf8')).toBe('ABCDXYZ');
});
