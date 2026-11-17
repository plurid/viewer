import { describe, expect, it } from 'vitest';
import { decodeListingName } from '../src/desktop/remote/sftp/codec';
import { assertSafeSFTPAfterEach } from './support/fake-sftp-server';
import { sftpFixture } from './support/sftp-fixture';

assertSafeSFTPAfterEach();

const b = (text: string): Buffer => Buffer.from(text);

describe('in-memory SFTP server contract', () => {
  it('exposes filesystem identity and read-only flags independently per subtree', async () => {
    const { client, server } = sftpFixture({
      subtrees: [
        { path: '/other', filesystemID: 2n },
        { path: '/readonly', filesystemID: 3n, readOnly: true },
      ],
    });
    server.directory('/other');
    server.directory('/readonly');
    server.file('/home/file', b('original'));
    server.file('/readonly/file', b('readonly'));
    await client.connect();
    expect(await client.statvfs(b('/home'))).toMatchObject({ filesystemID: 1n, flags: 0n });
    expect(await client.statvfs(b('/other'))).toMatchObject({ filesystemID: 2n, flags: 0n });
    expect(await client.statvfs(b('/readonly'))).toMatchObject({ filesystemID: 3n, flags: 1n });
    await expect(client.rename(b('/home/file'), b('/other/file'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await expect(client.open(b('/readonly/new'), 'create')).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await expect(client.mkdir(b('/readonly/new'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await expect(client.setstat(b('/readonly/file'), { permissions: 0o600 })).rejects.toMatchObject(
      { code: 'VIEWER_REMOTE_FAILURE' },
    );
    await expect(client.rename(b('/readonly/file'), b('/readonly/new'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect(server.bytes('/home/file')).toEqual(b('original'));
  });

  it('preserves partial output on a quota failure', async () => {
    const { client, server } = sftpFixture({ quotaBytes: 5 });
    await client.connect();
    const handle = await client.open(b('/home/file'), 'create');
    await client.write(handle, 0n, b('12345'));
    await expect(client.write(handle, 5n, b('6'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect(server.bytes('/home/file')).toEqual(b('12345'));
    await client.close(handle);
  });

  it('pages 100,000 entries in batches of about 100 without one oversized reply', async () => {
    const { client, server } = sftpFixture({ directoryEntries: 100000 });
    await client.connect();
    const handle = await client.opendir(b('/home'));
    let total = 0;
    let pages = 0;
    while (true) {
      const page = await client.readdir(handle);
      if (page === undefined) break;
      expect(page.length).toBeGreaterThan(0);
      expect(page.length).toBeLessThanOrEqual(100);
      const entries = page.map(decodeListingName).filter((entry) => entry.kind === 'entry');
      if (entries.length) expect(entries[0]?.name).toBe('entry-' + total);
      total += entries.length;
      pages++;
    }
    expect(total).toBe(100000);
    expect(pages).toBe(1001);
    expect(server.errors).toEqual([]);
    await client.close(handle);
  });

  it('passes hostile names through as bytes and lets the boundary produce error entries', async () => {
    const names = [b('/'), b('../'), b(''), b('\0'), Buffer.from([255]), b('a'.repeat(1025))];
    const { client } = sftpFixture({ hostileNames: names, fragmentBytes: 1 });
    await client.connect();
    const handle = await client.opendir(b('/home'));
    const entries = (await client.readdir(handle))!;
    expect(entries.map((entry) => entry.filename)).toEqual([b('.'), b('..'), ...names]);
    expect(
      entries
        .slice(2)
        .map(decodeListingName)
        .every((entry) => entry.kind === 'error'),
    ).toBe(true);
    await client.close(handle);
  });

  it('limits symlink traversal, while lstat and readlink can still inspect loops', async () => {
    const { client, server } = sftpFixture();
    server.link('/home/a', 'b');
    server.link('/home/b', 'a');
    await client.connect();
    expect(await client.lstat(b('/home/a'))).toMatchObject({ permissions: 0o120777 });
    expect(await client.readlink(b('/home/a'))).toEqual(b('b'));
    await expect(client.stat(b('/home/a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(client.realpath(b('/home/a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(client.connected).toBe(true);
  });

  it('models the OpenSSH folder stat-then-rename race without claiming atomic no-replace', async () => {
    const { client, server } = sftpFixture({
      folderRenameRace: (fake, destination) => {
        fake.directory(destination);
      },
    });
    const original = server.directory('/home/source');
    server.file('/home/source/child', b('child'));
    await client.connect();
    await client.rename(b('/home/source'), b('/home/destination'));
    expect(server.renameEvents).toEqual(['stat-destination', 'rename']);
    expect(server.nodes.get('/home/destination')).toBe(original);
    expect(server.bytes('/home/destination/child')).toEqual(b('child'));
    expect(server.nodes.has('/home/source')).toBe(false);
  });

  it('refuses folder publication when the race introduces a populated destination', async () => {
    const { client, server } = sftpFixture({
      folderRenameRace: (fake, destination) => {
        fake.directory(destination);
        fake.file(destination + '/other', b('other'));
      },
    });
    server.directory('/home/source');
    await client.connect();
    await expect(client.rename(b('/home/source'), b('/home/destination'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect(server.nodes.has('/home/source')).toBe(true);
    expect(server.bytes('/home/destination/other')).toEqual(b('other'));
  });

  it('reports ordinary missing, wrong-type, exclusive-create and invalid-handle errors', async () => {
    const { client, server } = sftpFixture();
    server.file('/home/file', b('abc'));
    await client.connect();
    await expect(client.stat(b('/missing'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(client.open(b('/home/file'), 'create')).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    const directory = await client.open(b('/home'), 'read');
    await expect(client.read(directory, 0n, 1)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await client.close(directory);
    await expect(client.opendir(b('/home/file'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await expect(client.readlink(b('/home/file'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await expect(client.close(b('bad'))).rejects.toMatchObject({ code: 'ENOENT' });
    const read = await client.open(b('/home/file'), 'read');
    await expect(client.write(read, 0n, b('bad'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await client.close(read);
    expect(server.bytes('/home/file')).toEqual(b('abc'));
  });
});
