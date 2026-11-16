import { expect, it } from 'vitest';
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
