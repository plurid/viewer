import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sftpPacketTypes } from '../src/desktop/remote/sftp/codec';
import * as codec from '../src/desktop/remote/sftp/codec';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';
import { sftpFixture, sftpTurn } from './support/sftp-fixture';
import { sftpPolicyProblems } from './support/sftp-policy';

assertSafeSFTPAfterEach();

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
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const files = [
      ...(await sources(path.join(root, 'desktop'))),
      ...(await sources(path.join(root, 'domain'))),
    ];
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(sftpPolicyProblems(source), path.relative(root, file)).toEqual([]);
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
    'writer.byte(0xd)',
    'writer.byte(0xf)',
    'const remove = 13; writer.byte(remove);',
    'transport.write(Buffer.from([0, 0, 0, 9, 13, 0, 0, 0, 99, 0, 0, 0, 0]));',
  ])('recognizes a policy violation: %s', (text) => {
    expect(sftpPolicyProblems(text).length).toBeGreaterThan(0);
  });

  it('exposes only the reviewed encoders, including unused exports', () => {
    expect(
      Object.keys(codec)
        .filter((name) => name.startsWith('encode'))
        .sort(),
    ).toEqual(['encodeInit', 'encodeReply', 'encodeRequest']);
  });

  it('exports only the reviewed codec surface, whatever a new builder is called', () => {
    expect(Object.keys(codec).sort()).toEqual(
      [
        'SFTPFramer',
        'SFTPReader',
        'SFTPWriter',
        'decodeClientPacket',
        'decodeLimits',
        'decodeListingName',
        'decodeReply',
        'decodeStatVFS',
        'decodeUsersGroups',
        'encodeInit',
        'encodeReply',
        'encodeRequest',
        'framed',
        'protocolAssert',
        'readAttributes',
        'sftpBounds',
        'sftpExtensions',
        'sftpPacketTypes',
      ].sort(),
    );
  });

  it('fails a test whose fake server received a forbidden packet', async () => {
    const { server, wire } = sftpFixture();
    // A raw REMOVE frame; the codec refuses to build one.
    wire.write(Buffer.from([0, 0, 0, 9, 13, 0, 0, 0, 1, 0, 0, 0, 0]));
    await sftpTurn();
    expect(server.packets.map((packet) => packet.type)).toEqual([13]);
    expect(() => server.stop()).toThrow();
    // Forget the packet so this test's automatic guard passes.
    server.packets.length = 0;
  });

  it('installs fake-server assertions without a test opting in', async () => {
    const source = await readFile(
      new URL('./support/fake-sftp-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/^assertSafeSFTPAfterEach\(\);$/m);
  });
});
