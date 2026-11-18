import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { SFTPInterop } from './support/sftp-interop';
import { decodeListingName } from '../src/desktop/remote/sftp/codec';
import { pread, pwrite } from '../src/desktop/remote/sftp/streams';
import { remoteLimits } from '../src/domain/remote/limits';
import { sftpInterop } from './support/sftp-interop';

const enabled =
  process.env.VIEWER_TEST_SFTP_SERVER === '1' && existsSync('/usr/libexec/sftp-server');
const sessions: SFTPInterop[] = [];
const execute = promisify(execFile);
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const b = (text: string): Buffer => Buffer.from(text);
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.stop();
});
const fixture = async (): Promise<SFTPInterop> => {
  const session = await sftpInterop();
  sessions.push(session);
  await session.client.connect();
  return session;
};

describe.runIf(enabled)('OpenSSH sftp-server over confined stdio', () => {
  it('negotiates extensions/limits and resolves existing and missing final paths', async () => {
    const { client, file, root } = await fixture();
    expect(await client.realpath(file('.'))).toEqual(b(root));
    expect(await client.realpath(file('not-created'))).toEqual(file('not-created'));
    expect((await client.stat(file('.'))).permissions! & 0o170000).toBe(0o040000);
    expect((await client.lstat(file('.'))).permissions! & 0o170000).toBe(0o040000);
    expect(client.serverLimits).toMatchObject({
      packetLength: 262144n,
      readLength: 261120n,
      writeLength: 261120n,
    });
    for (const kind of ['statvfs', 'fsync', 'limits', 'copyData', 'usersGroups'] as const)
      expect(client.supports(kind)).toBe(true);
    expect((await client.statvfs(file('.'))).blockSize).toBeGreaterThan(0n);
    expect(
      (await client.usersGroupsByID([process.getuid!()], [process.getgid!()])).users,
    ).toHaveLength(1);
  });

  it('creates exclusively, makes folders and round trips 50 MB with hashes and bounded server-side copying', async () => {
    const { client, file, requests } = await fixture();
    const content = randomBytes(50_000_000);
    await client.mkdir(file('folder'), { permissions: 0o700 });
    const output = await client.open(file('folder/source'), 'create', { permissions: 0o666 });
    await pwrite(client, output, [content]);
    await client.fsetstat(output, { times: { atime: 1_000_000_000, mtime: 1_100_000_000 } });
    await client.fsync(output);
    await client.close(output);
    await expect(client.open(file('folder/source'), 'create')).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect((await stat(file('folder/source'))).mode & 0o777).toBe(0o644);
    expect(Math.floor((await stat(file('folder/source'))).mtimeMs / 1000)).toBe(1_100_000_000);
    expect(digest(await readFile(file('folder/source')))).toBe(digest(content));
    const input = await client.open(file('folder/source'), 'read');
    await expect(client.write(input, 0n, b('x'))).rejects.toMatchObject({
      code: 'ENOENT',
      status: 2,
    });
    const received = createHash('sha256');
    for await (const bytes of pread(client, input)) received.update(bytes);
    expect(received.digest('hex')).toBe(digest(content));
    const copied = await client.open(file('folder/copy'), 'create');
    const progress: bigint[] = [];
    await client.copyData(input, 0n, BigInt(content.length), copied, 0n, {
      onProgress: (bytes) => progress.push(bytes),
    });
    await client.close(copied);
    await client.close(input);
    expect(progress.at(-1)).toBe(BigInt(content.length));
    expect(
      requests
        .filter((request) => request.kind === 'copyData')
        .every(
          (request) =>
            request.kind === 'copyData' &&
            request.length > 0n &&
            request.length <= BigInt(remoteLimits.readBytesPerStream),
        ),
    ).toBe(true);
    expect(digest(await readFile(file('folder/copy')))).toBe(digest(content));
  }, 30000);

  it('uses OpenSSH link order, reads relative link targets and distinguishes stat from lstat', async () => {
    const { client, file } = await fixture();
    await writeFile(file('target'), b('bytes'), { flag: 'wx' });
    await client.symlink(b('target'), file('link'));
    expect(await readlink(file('link'))).toBe('target');
    expect(await client.readlink(file('link'))).toEqual(b('target'));
    expect((await client.lstat(file('link'))).permissions! & 0o170000).toBe(0o120000);
    expect((await client.stat(file('link'))).permissions! & 0o170000).toBe(0o100000);
    expect(await client.realpath(file('link'))).toEqual(file('target'));
    await symlink('loop', file('loop'));
    await expect(client.stat(file('loop'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(client.realpath(file('loop'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(client.open(file('loop'), 'create')).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
  });

  it('reuses four-byte handle slots, including pipelined CLOSE/OPEN, and keeps working after a failed CLOSE', async () => {
    const { client, file } = await fixture();
    const first = await client.opendir(file('.'));
    expect(first.length).toBe(4);
    const closing = client.close(first);
    const next = client.opendir(file('.'));
    await closing;
    const reused = await next;
    expect(reused).toEqual(first);
    await client.close(reused);
    await expect(client.close(reused)).rejects.toMatchObject({ code: 'ENOENT' });
    const folder = await client.open(file('.'), 'read');
    await expect(client.read(folder, 0n, 1)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    await client.close(folder);
    expect(client.stats.handles).toBe(0);
    expect(client.connected).toBe(true);
  });

  it('keeps unrelated requests alive after aborting opens and a mid-stream pread', async () => {
    const { client, file } = await fixture();
    const opening = new AbortController();
    const opened = client.opendir(file('.'), { signal: opening.signal });
    const rejected = expect(opened).rejects.toMatchObject({ code: 'ABORT_ERR' });
    const unrelated = client.lstat(file('.'));
    opening.abort();
    await rejected;
    expect((await unrelated).permissions! & 0o170000).toBe(0o040000);
    await writeFile(file('source'), Buffer.alloc(2 * remoteLimits.readBytesPerStream), {
      flag: 'wx',
    });
    const handle = await client.open(file('source'), 'read');
    const controller = new AbortController();
    const consuming = (async () => {
      for await (const bytes of pread(client, handle, { signal: controller.signal })) {
        expect(bytes.length).toBeGreaterThan(0);
        controller.abort();
      }
    })();
    await expect(consuming).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect((await client.lstat(file('source'))).size).toBe(
      BigInt(2 * remoteLimits.readBytesPerStream),
    );
    await client.close(handle);
    expect(client.connected).toBe(true);
  });

  it('does not time out during slow local consumption or production', async () => {
    const { client, file } = await fixture();
    await writeFile(file('source'), b('abcd'), { flag: 'wx' });
    const handle = await client.open(file('source'), 'read');
    for await (const bytes of pread(client, handle, {
      chunkBytes: 2,
      concurrency: 2,
      stallTimeoutMs: 20,
    })) {
      expect(bytes.length).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await client.close(handle);
    const output = await client.open(file('output'), 'create');
    async function* source(): AsyncGenerator<Buffer> {
      yield b('ab');
      await new Promise((resolve) => setTimeout(resolve, 40));
      yield b('cd');
    }
    await pwrite(client, output, source(), { stallTimeoutMs: 20 });
    await client.close(output);
    expect(await readFile(file('output'))).toEqual(b('abcd'));
    expect(client.connected).toBe(true);
  });

  it.each(
    ['file', 'directory', 'symlink', 'fifo', 'socket'].flatMap((source) =>
      ['file', 'directory', 'dangling', 'loop'].map((destination) => ({ source, destination })),
    ),
  )(
    'refuses $source publication over an existing $destination destination',
    async ({ source, destination }) => {
      const { client, file, requests } = await fixture();
      await writeFile(file('target'), b('target'), { flag: 'wx' });
      if (source === 'file') await writeFile(file('source'), b('source'), { flag: 'wx' });
      else if (source === 'directory') await mkdir(file('source'));
      else if (source === 'symlink') await symlink('target', file('source'));
      else
        await execute(
          '/usr/bin/python3',
          [
            '-I',
            '-B',
            '-c',
            'import os,socket,sys\nif sys.argv[1] == "fifo": os.mkfifo(sys.argv[2])\nelse:\n s=socket.socket(socket.AF_UNIX)\n s.bind(sys.argv[2])\n s.close()',
            source,
            'source',
          ],
          { cwd: file('.').toString() },
        );
      if (destination === 'file') await writeFile(file('destination'), b('keep'), { flag: 'wx' });
      else if (destination === 'directory') await mkdir(file('destination'));
      else await symlink(destination === 'loop' ? 'destination' : 'missing', file('destination'));
      const before = await lstat(file('destination'));
      await expect(client.rename(file('source'), file('destination'))).rejects.toMatchObject({
        code: 'VIEWER_REMOTE_FAILURE',
      });
      expect((await lstat(file('destination'))).ino).toBe(before.ino);
      expect(requests.some((request) => request.kind === 'rename')).toBe(false);
      expect(await lstat(file('source'))).toBeDefined();
    },
  );

  it.each(['file', 'directory', 'symlink'])('renames a $0 to a free destination', async (kind) => {
    const { client, file } = await fixture();
    if (kind === 'directory') await mkdir(file('source'));
    else if (kind === 'symlink') await symlink('missing', file('source'));
    else await writeFile(file('source'), b('source'), { flag: 'wx' });
    const before = await lstat(file('source'));
    await client.rename(file('source'), file('destination'));
    expect((await lstat(file('destination'))).ino).toBe(before.ino);
    await expect(lstat(file('source'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('shares one channel between six full streams and a listing', async () => {
    const { client, file, requests } = await fixture();
    const streams = 6;
    const content = randomBytes(3 * remoteLimits.readBytesPerStream + 1);
    await writeFile(file('source'), content, { flag: 'wx' });
    await mkdir(file('folder'));
    await writeFile(file('folder/entry'), b('entry'), { flag: 'wx' });
    const handles = await Promise.all(
      Array.from({ length: streams }, () => client.open(file('source'), 'read')),
    );
    const reading = handles.map(async (handle) => {
      const hash = createHash('sha256');
      for await (const bytes of pread(client, handle)) hash.update(bytes);
      return hash.digest('hex');
    });
    const started = requests.length;
    const listing = (async () => {
      const folder = await client.opendir(file('folder'));
      const names: string[] = [];
      let page = await client.readdir(folder);
      while (page) {
        names.push(...page.map((entry) => entry.filename.toString()));
        page = await client.readdir(folder);
      }
      await client.close(folder);
      return names;
    })();
    expect(await Promise.all(reading)).toEqual(Array(streams).fill(digest(content)));
    expect((await listing).sort()).toEqual(['.', '..', 'entry']);
    const kinds = requests.slice(started).map((request) => request.kind);
    expect(kinds.filter((kind) => kind !== 'read').slice(0, 4)).toEqual([
      'opendir',
      'readdir',
      'readdir',
      'close',
    ]);
    const gaps: number[] = [];
    let reads = 0;
    for (const kind of kinds) {
      if (kind === 'read') reads++;
      else if (gaps.length < 4) {
        gaps.push(reads);
        reads = 0;
      }
    }
    // Requests written before the listing started may be logged after it, so each gap allows a credit.
    for (const gap of gaps)
      expect(gap).toBeLessThanOrEqual(remoteLimits.requestsPerChannel + streams);
    for (const handle of handles) await client.close(handle);
    expect(client.connected).toBe(true);
  }, 30000);

  it('fails a server-side copy from a short or shrinking source', async () => {
    const session = await fixture();
    const { client, file, requests } = session;
    await writeFile(file('short'), b('0123456789'), { flag: 'wx' });
    const short = await client.open(file('short'), 'read');
    const output = await client.open(file('short-copy'), 'create');
    await expect(client.copyData(short, 0n, 100n, output, 0n)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_SHORT_SOURCE',
    });
    expect(requests.some((request) => request.kind === 'copyData')).toBe(false);
    expect((await stat(file('short-copy'))).size).toBe(0);
    await client.close(output);
    await client.close(short);
    const length = remoteLimits.readBytesPerStream + 3;
    await writeFile(file('shrinking'), randomBytes(length), { flag: 'wx' });
    const source = await client.open(file('shrinking'), 'read');
    const copy = await client.open(file('shrinking-copy'), 'create');
    let blocks = 0;
    session.beforeRequest = async (request) => {
      // OpenSSH copies the second block up to the new end of file and still answers OK.
      if (request.kind === 'copyData' && ++blocks === 2)
        await truncate(file('shrinking'), remoteLimits.readBytesPerStream + 1);
    };
    await expect(client.copyData(source, 0n, BigInt(length), copy, 0n)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_SHORT_SOURCE',
    });
    session.beforeRequest = undefined;
    expect(blocks).toBe(2);
    expect((await stat(file('shrinking-copy'))).size).toBe(remoteLimits.readBytesPerStream + 1);
    await client.close(copy);
    await client.close(source);
    expect(client.connected).toBe(true);
  });

  it('fails server-side copies that OpenSSH answers OK without copying everything', async () => {
    const { client, file, requests } = await fixture();
    await writeFile(file('source'), randomBytes(1000), { flag: 'wx' });
    await writeFile(file('target'), b(''), { flag: 'wx' });
    await mkdir(file('folder'));
    const source = await client.open(file('source'), 'read');
    // A handle opened for reading: OpenSSH's write fails in the last 64 KiB and answers OK.
    const readOnly = await client.open(file('target'), 'read');
    await expect(client.copyData(source, 0n, 1000n, readOnly, 0n)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect((await stat(file('target'))).size).toBe(0);
    await client.close(readOnly);
    // A folder opened as a file: its read fails in the last 64 KiB and answers OK.
    const folder = await client.open(file('folder'), 'read');
    const output = await client.open(file('from-folder'), 'create');
    await expect(client.copyData(folder, 0n, 10n, output, 0n)).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
    });
    expect((await stat(file('from-folder'))).size).toBe(0);
    // A destination that already holds bytes at the offset cannot be verified by its size.
    const before = requests.length;
    await expect(client.copyData(source, 0n, 10n, output, 0n)).resolves.toBeUndefined();
    await expect(client.copyData(source, 0n, 10n, output, 5n)).rejects.toMatchObject({
      code: 'ENOTSUP',
    });
    expect(requests.slice(before).filter((request) => request.kind === 'copyData')).toHaveLength(1);
    await client.close(output);
    await client.close(folder);
    await client.close(source);
    expect(client.connected).toBe(true);
  });

  it.each([
    ['before the last 64 KiB', remoteLimits.readBytesPerStream + 1000],
    ['inside the last 64 KiB', 2 * remoteLimits.readBytesPerStream - 1000],
  ])(
    'fails a copy whose source is cut %s of a block and restored before the next',
    async (_where, cut) => {
      const session = await fixture();
      const { client, file } = session;
      const length = 2 * remoteLimits.readBytesPerStream + 3;
      const content = randomBytes(length);
      await writeFile(file('source'), content, { flag: 'wx' });
      const source = await client.open(file('source'), 'read');
      const copy = await client.open(file('copy'), 'create');
      let blocks = 0;
      session.beforeRequest = async (request) => {
        if (request.kind !== 'copyData') return;
        blocks++;
        if (blocks === 2) await truncate(file('source'), cut);
        if (blocks === 3) await writeFile(file('source'), content);
      };
      const progress: bigint[] = [];
      await expect(
        client.copyData(source, 0n, BigInt(length), copy, 0n, {
          onProgress: (bytes) => progress.push(bytes),
        }),
      ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_SHORT_SOURCE' });
      session.beforeRequest = undefined;
      expect(blocks).toBe(2);
      expect(progress).toEqual([BigInt(remoteLimits.readBytesPerStream)]);
      expect((await stat(file('copy'))).size).toBe(cut);
      await client.close(copy);
      await client.close(source);
    },
  );

  it("answers with OpenSSH's fixed status text, as the fake server does", async () => {
    const { client, file } = await fixture();
    await writeFile(file('existing'), b('x'), { flag: 'wx' });
    await mkdir(file('folder'));
    await expect(client.open(file('existing'), 'create')).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      status: 4,
      message: 'Failure',
    });
    await expect(client.stat(file('missing'))).rejects.toMatchObject({
      code: 'ENOENT',
      status: 2,
      message: 'No such file',
    });
    await expect(client.rename(file('folder'), file('folder/inside'))).rejects.toMatchObject({
      code: 'VIEWER_REMOTE_FAILURE',
      status: 5,
      message: 'Bad message',
    });
    expect((await lstat(file('folder'))).isDirectory()).toBe(true);
  });

  it('applies the server umask to MKDIR and sets folder times only with SETSTAT', async () => {
    const { client, file, requests } = await fixture();
    await client.mkdir(file('open'), { permissions: 0o777 });
    await client.mkdir(file('default'));
    expect((await stat(file('open'))).mode & 0o7777).toBe(0o755);
    expect((await stat(file('default'))).mode & 0o7777).toBe(0o755);
    // OpenSSH ignores MKDIR times, so the client refuses to send them.
    const before = requests.length;
    await expect(
      client.mkdir(file('timed'), {
        permissions: 0o700,
        times: { atime: 1, mtime: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_PROTOCOL' });
    expect(requests.length).toBe(before);
    await expect(lstat(file('timed'))).rejects.toMatchObject({ code: 'ENOENT' });
    await client.mkdir(file('timed'), { permissions: 0o700 });
    await client.setstat(file('timed'), { times: { atime: 1_000_000_000, mtime: 1_100_000_000 } });
    expect((await stat(file('timed'))).mode & 0o7777).toBe(0o700);
    expect(Math.floor((await stat(file('timed'))).mtimeMs / 1000)).toBe(1_100_000_000);
    expect(client.connected).toBe(true);
  });

  it('lists an empty folder as two structural names followed by EOF', async () => {
    const { client, file } = await fixture();
    const directory = await client.opendir(file('.'));
    const names = (await client.readdir(directory))!;
    expect(names.map((name) => name.filename.toString()).sort()).toEqual(['.', '..']);
    expect(names.map(decodeListingName)).toEqual([{ kind: 'skip' }, { kind: 'skip' }]);
    for (const name of names) {
      expect(name.longname.length).toBeGreaterThan(0);
      expect(name.attrs.permissions! & 0o170000).toBe(0o040000);
    }
    expect(await client.readdir(directory)).toBeUndefined();
    await client.close(directory);
  });
});
