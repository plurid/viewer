import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { SFTPRequest } from '../../src/desktop/remote/sftp/codec';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, readlink, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Duplex, Readable, Transform, Writable } from 'node:stream';
import { expect } from 'vitest';
import { SFTPClient } from '../../src/desktop/remote/sftp/client';
import { decodeClientPacket, decodeReply, SFTPFramer } from '../../src/desktop/remote/sftp/codec';
import { temporaryRoot } from '../../tools/temporary';

export interface SFTPInterop {
  root: string;
  client: SFTPClient;
  child: ChildProcessWithoutNullStreams;
  requests: SFTPRequest[];
  /** Runs after a request passes the guard and before the server receives it. */
  beforeRequest: ((request: SFTPRequest) => Promise<void> | void) | undefined;
  file: (relative: string) => Buffer;
  stop: () => Promise<void>;
}

/** The stdio server is not a jail, so every request and every fixture link stays inside this root. */
export async function sftpInterop(): Promise<SFTPInterop> {
  expect(process.env.VIEWER_TEST_SFTP_SERVER).toBe('1');
  const root = await realpath(await temporaryRoot('viewer-sftp-interop-'));
  const requests: SFTPRequest[] = [];
  const opening = new Set<number>();
  const issued = new Set<string>();
  const contains = (file: string): void => {
    expect(
      file === root || file.startsWith(root + path.sep),
      'SFTP request escaped its fixture',
    ).toBe(true);
  };
  const validatePath = async (bytes: Buffer): Promise<void> => {
    const file = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    expect(path.isAbsolute(file)).toBe(true);
    expect(file.includes('\0')).toBe(false);
    contains(path.resolve(file));
    let current = root;
    for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink())
          contains(path.resolve(path.dirname(current), await readlink(current)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  };
  const outgoing = new SFTPFramer();
  const incoming = new SFTPFramer();
  const log: Buffer[] = [];
  const child = spawn(
    '/usr/libexec/sftp-server',
    [
      '-e',
      '-l',
      'VERBOSE',
      '-u',
      '022',
      '-P',
      'remove,rmdir,posix-rename,hardlink,lsetstat',
      '-d',
      root,
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', (chunk: Buffer) => log.push(Buffer.from(chunk)));
  const readable = child.stdout.pipe(
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          incoming.push(chunk, (packet) => {
            const reply = decodeReply(packet);
            if (reply.kind === 'handle') {
              expect(opening.has(reply.id)).toBe(true);
              issued.add(reply.handle.toString('hex'));
            }
            if (reply.kind !== 'version') opening.delete(reply.id);
          });
          callback(null, chunk);
        } catch (error) {
          callback(error as Error);
        }
      },
    }),
  );
  const writable = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const decoded: SFTPRequest[] = [];
      try {
        outgoing.push(chunk, (packet) => {
          const value = decodeClientPacket(packet);
          if (value.kind === 'init') return;
          if (value.request.kind === 'open' || value.request.kind === 'opendir')
            opening.add(value.id);
          decoded.push(value.request);
        });
      } catch (error) {
        callback(error as Error);
        return;
      }
      void (async () => {
        for (const request of decoded) {
          if ('path' in request) await validatePath(request.path);
          if (request.kind === 'rename') {
            await validatePath(request.from);
            await validatePath(request.to);
          }
          if (request.kind === 'symlink') {
            const target = path.resolve(
              path.dirname(request.path.toString()),
              request.target.toString(),
            );
            contains(target);
          }
          for (const handle of 'handle' in request
            ? [request.handle]
            : request.kind === 'copyData'
              ? [request.source, request.destination]
              : []) {
            expect(
              issued.has(handle.toString('hex')),
              'SFTP used a handle outside its fixture',
            ).toBe(true);
          }
          await session.beforeRequest?.(request);
          requests.push(request);
        }
        child.stdin.write(chunk, callback);
      })().catch((error: unknown) => callback(error as Error));
    },
    final(callback) {
      child.stdin.end(callback);
    },
  });
  const transport = Duplex.fromWeb({
    readable: Readable.toWeb(readable),
    writable: Writable.toWeb(writable),
  });
  child.on('error', (error) => transport.destroy(error));
  child.on('exit', () => transport.destroy());
  const client = new SFTPClient(transport);
  const session: SFTPInterop = {
    root,
    client,
    child,
    requests,
    beforeRequest: undefined,
    file: (relative) => {
      const file = path.resolve(root, relative);
      contains(file);
      return Buffer.from(file);
    },
    stop: async () => {
      client.disconnect();
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        const exit = once(child, 'exit');
        child.kill();
        await exit;
      }
      await writeFile(path.join(root, 'sftp-server.log'), Buffer.concat(log), { flag: 'wx' });
    },
  };
  return session;
}
