import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sftpPacketTypes } from '../src/desktop/remote/sftp/codec';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';

assertSafeSFTPAfterEach();

const forbidden = [
  /\b(?:SSH_FXP_)?(?:REMOVE|RMDIR)\b/,
  /posix-rename|hardlink|lsetstat/i,
  /\b(?:SSH_FXF_)?(?:TRUNC|APPEND)\b/,
  /\.byte\(\s*(?:13|15|0x0d|0x0f)\s*\)/i,
];

async function sources(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(file)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(file);
  }
  return files;
}

describe('remote SFTP mutation policy', () => {
  it('scans all remote desktop source for forbidden packet and extension encoders', async () => {
    const root = fileURLToPath(new URL('../src/desktop/remote', import.meta.url));
    const files = await sources(root);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const pattern of forbidden)
        expect(source, path.relative(root, file)).not.toMatch(pattern);
    }
    expect(Object.values(sftpPacketTypes)).not.toContain(13);
    expect(Object.values(sftpPacketTypes)).not.toContain(15);
    expect(Object.keys(sftpPacketTypes).sort()).toEqual(
      [
        'attrs',
        'close',
        'data',
        'extended',
        'extendedReply',
        'fsetstat',
        'fstat',
        'handle',
        'init',
        'lstat',
        'mkdir',
        'name',
        'open',
        'opendir',
        'read',
        'readdir',
        'readlink',
        'realpath',
        'rename',
        'setstat',
        'stat',
        'status',
        'symlink',
        'version',
        'write',
      ].sort(),
    );
  });

  it.each([
    'SSH_FXP_REMOVE',
    'RMDIR',
    'posix-rename@openssh.com',
    'hardlink@openssh.com',
    'lsetstat@openssh.com',
    'SSH_FXF_TRUNC',
    'APPEND',
    'writer.byte(13)',
    'writer.byte(0x0f)',
  ])('recognizes a policy violation: %s', (text) => {
    expect(forbidden.some((pattern) => pattern.test(text))).toBe(true);
  });
});
