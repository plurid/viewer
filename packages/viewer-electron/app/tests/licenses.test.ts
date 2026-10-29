import { expect, it } from 'vitest';
import { noticeFile } from '../tools/licenses';

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
