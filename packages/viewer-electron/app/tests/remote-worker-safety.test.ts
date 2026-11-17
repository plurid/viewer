import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { RemoteSessions } from '../src/desktop/remote/session';
import { remoteConnection } from '../src/domain/remote/connections';
import { buildFakeSSH } from './support/remote-transport';
import { temporaryRoot } from '../tools/temporary';

vi.mock('electron', () => ({ utilityProcess: {} }));

let fixture: Awaited<ReturnType<typeof buildFakeSSH>>;
const sessions: RemoteSessions[] = [];

beforeAll(async () => {
  fixture = await buildFakeSSH();
}, 30000);

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((item) => item.close()));
  vi.unstubAllEnvs();
});

async function connected() {
  const root = await temporaryRoot('viewer-worker-safety-');
  const log = path.join(root, 'ssh.jsonl');
  vi.stubEnv('VIEWER_REMOTE', '1');
  vi.stubEnv('VIEWER_FAKE_SSH_LOG', log);
  const lost = vi.fn();
  const client = new RemoteSessions(fixture.worker, { backend: 'thread', lost });
  sessions.push(client);
  await client.configure({
    connection: remoteConnection.parse({ id: 'server01', name: 'Build', host: 'build-box' }),
    // The fake ssh never binds it; a real master's socket lives in a private folder.
    controlPath: '/private/tmp/c1',
    sshExecutable: fixture.sshExecutable,
  });
  const channels = async () =>
    (await readFile(log, 'utf8')).split('\n').filter((line) => line.includes('"sftp"')).length;
  return { root, client, lost, channels };
}

it('refuses unsafe paths and oversized reads or writes before a file open', async () => {
  const { client } = await connected();
  for (const [request, code] of [
    [
      { type: 'read' as const, path: '/hello.txt', offset: 0n, length: 8 * 1024 * 1024 + 1 },
      'VIEWER_REMOTE_LIMIT',
    ],
    [
      { type: 'write' as const, path: '/hello.txt', bytes: new Uint8Array(8 * 1024 * 1024 + 1) },
      'VIEWER_REMOTE_LIMIT',
    ],
    [{ type: 'stat' as const, path: '/a/../b' }, 'VIEWER_REMOTE_INVALID_LOCATION'],
  ] as const) {
    await expect(client.request('server01', 'browse', request)).rejects.toMatchObject({ code });
  }
  await expect(
    client.request('server01', 'browse', { type: 'read', path: '/home', offset: 0n, length: 1 }),
  ).rejects.toMatchObject({ code: 'VIEWER_REMOTE_NOT_FILE' });
  const text = await client.request('server01', 'browse', {
    type: 'read',
    path: '/hello.txt',
    offset: 0n,
    length: 5,
  });
  expect(text.type === 'read' && Buffer.from(text.bytes).toString()).toBe('hello');
});

it('passes SFTP error codes through, and refuses to replace an existing file', async () => {
  const { client } = await connected();
  await expect(
    client.request('server01', 'browse', { type: 'stat', path: '/missing' }),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(
    client.request('server01', 'transfer', {
      type: 'write',
      path: '/hello.txt',
      bytes: Buffer.from('replaced'),
    }),
  ).rejects.toMatchObject({ code: expect.stringMatching(/^VIEWER_REMOTE_|^E/) });
  const text = await client.request('server01', 'browse', {
    type: 'read',
    path: '/hello.txt',
    offset: 0n,
    length: 5,
  });
  expect(text.type === 'read' && Buffer.from(text.bytes).toString()).toBe('hello');
});

it('disconnects a channel during stalled SFTP negotiation without waiting for its metadata timeout', async () => {
  const { client, root } = await connected();
  await writeFile(path.join(root, 'ssh.jsonl.mode'), JSON.stringify({ hang: true }));
  const work = client.request('server01', 'browse', { type: 'list', path: '/' }).catch(() => {});
  await vi.waitFor(async () =>
    expect(await readFile(path.join(root, 'ssh.jsonl'), 'utf8')).toContain('sftp'),
  );
  const start = performance.now();
  await client.disconnect('server01');
  expect(performance.now() - start).toBeLessThan(1000);
  await work;
});

it('reports a dropped channel only for its configured connection', async () => {
  const { client, root, lost } = await connected();
  await writeFile(path.join(root, 'ssh.jsonl.mode'), JSON.stringify({ drop: true }));
  await client.request('server01', 'browse', { type: 'home' }).catch(() => {});
  await vi.waitFor(() => expect(lost).toHaveBeenCalledWith('server01'));
});

it('closes idle channels without reporting a lost connection, and reopens them on demand', async () => {
  const { client, lost, channels } = await connected();
  expect(await client.request('server01', 'browse', { type: 'home' })).toEqual({
    type: 'path',
    path: '/home',
  });
  expect(await channels()).toBe(1);
  await client.release('server01');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(lost).not.toHaveBeenCalled();
  expect(await client.request('server01', 'browse', { type: 'home' })).toEqual({
    type: 'path',
    path: '/home',
  });
  expect(await channels()).toBe(2);
});
