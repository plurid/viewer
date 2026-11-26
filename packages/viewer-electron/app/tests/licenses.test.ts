import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { noticeFile, noticesSource } from '../tools/licenses';

it('links generated notices to the manifest release without needing a build', () => {
  expect(noticesSource('0.1.0-0')).toBe(
    'https://github.com/plurid/viewer/blob/v0.1.0-0/packages/viewer-electron/app/forge.config.ts',
  );
  expect(noticesSource('0.1.0-1')).toBe(
    'https://github.com/plurid/viewer/blob/v0.1.0-1/packages/viewer-electron/app/forge.config.ts',
  );
  expect(() => noticesSource('1.0.0-0')).toThrow();
});

it('collects licenses, notices and the notices of what a build links in', () => {
  for (const name of [
    'LICENSE',
    'LICENSE.md',
    'license-MIT',
    'LICENCE.txt',
    'COPYING',
    'NOTICE',
    'NOTICES.md',
    'THIRD_PARTY_NOTICES',
    'third-party-notices.txt',
    'THIRD_PARTY_LICENSES',
  ])
    expect(noticeFile(name), name).toBe(true);
  for (const name of ['README.md', 'package.json', 'licensed.js', 'party.txt'])
    expect(noticeFile(name), name).toBe(false);
});

it('reports the pinned native processor versions in the generated notices', () => {
  const toolSource = (name: string) =>
    readFileSync(new URL('../tools/' + name + '.ts', import.meta.url), 'utf8');
  const processors = toolSource('processors');
  const optimizers = toolSource('pdf-processors');
  const raw = toolSource('libraw');
  const notices = toolSource('licenses');
  for (const [name, version] of [
    ['FFmpeg', /const ffmpeg = \{\s*version: '([^']+)'/.exec(processors)?.[1]],
    ['Sharp', /'sharp',\s*'([^']+)'/.exec(processors)?.[1]],
    ['LibRaw', /const source = \{\s*version: '([^']+)'/.exec(raw)?.[1]],
    ['qpdf', /name: 'qpdf',\s*version: '([^']+)'/.exec(optimizers)?.[1]],
    ['libjpeg-turbo', /name: 'libjpeg-turbo',\s*version: '([^']+)'/.exec(optimizers)?.[1]],
  ]) {
    expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    expect(notices).toContain(name + ' ' + version);
  }
});
