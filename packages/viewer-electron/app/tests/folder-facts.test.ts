import { mkdir, writeFile, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { appendFileSync, constants, openSync, opendirSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { build } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FolderFactsRequest,
  FolderFactsReply,
  FolderFactsMessage,
} from '../src/domain/workspaces/folder-facts';
import type { OwnedWorker } from '../src/desktop/workers/utility-client';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { readFolderFile, probeFolder } from '../src/desktop/workspaces/folder-facts-io';
import { FolderFacts } from '../src/desktop/workspaces/folder-facts';

vi.mock('../src/desktop/workers/utility-client', () => ({ launchWorker: vi.fn() }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof NodeFs>();
  return { ...fs, opendirSync: vi.fn(fs.opendirSync), openSync: vi.fn(fs.openSync) };
});
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-folder-facts-');
});
afterEach(async () => {
  vi.useRealTimers();
  await trashTemporary(root);
});

class FakeWorker implements OwnedWorker<FolderFactsReply> {
  receive?: (reply: FolderFactsReply) => void;
  requests: FolderFactsRequest[] = [];
  approvals: { id: number; kind: 'allow'; allowed: boolean }[] = [];
  terminate = vi.fn(async () => 0);
  thread = { terminate: this.terminate, on: vi.fn() } as unknown as Worker;
  postMessage(value: unknown) {
    const message = value as FolderFactsMessage;
    if (message.kind === 'allow') this.approvals.push(message);
    else this.requests.push(message);
  }
  message(listener: (reply: FolderFactsReply) => void) {
    this.receive = listener;
  }
  exit() {}
  answer() {
    const request = this.requests.at(-1)!;
    this.receive?.({
      id: request.id,
      value: { ok: true, path: request.path, bytes: new Uint8Array() },
    });
  }
}

describe('folder facts review regressions', () => {
  it('quarantines only the stalled internal folder and descendants, keeping siblings available', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const service = new FolderFacts('worker.cjs', {
      worker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const slow = service.probe('/Users/sample/Library/CloudStorage/Drive');
    await vi.advanceTimersByTimeAsync(151);
    expect(await slow).toEqual({ ok: false, reason: 'timeout' });
    expect(
      await service.read('/Users/sample/Library/CloudStorage/Drive/nested/package.json', 100),
    ).toEqual({ ok: false, reason: 'quarantined' });
    const project = service.read('/Users/sample/code/site/package.json', 100);
    expect(workers).toHaveLength(2);
    workers.at(-1)!.answer();
    expect(await project).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(29_000);
    const system = service.probe('/Applications');
    workers.at(-1)!.answer();
    expect(await system).toMatchObject({ ok: true });
    service.close();
    const closed = service.probe('/after-close');
    await vi.advanceTimersByTimeAsync(151);
    expect(await closed).toEqual({ ok: false, reason: 'closed' });
  });

  it('quarantines a stalled read of a volume root without quarantining other mounted disks', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const service = new FolderFacts('worker.cjs', {
      worker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const slow = service.read('/Volumes/Sleeping', 100);
    await vi.advanceTimersByTimeAsync(151);
    expect(await slow).toEqual({ ok: false, reason: 'timeout' });
    expect(await service.probe('/Volumes/Sleeping/project')).toEqual({
      ok: false,
      reason: 'quarantined',
    });
    const other = service.probe('/Volumes/Other');
    expect(workers).toHaveLength(2);
    workers.at(-1)!.answer();
    expect(await other).toMatchObject({ ok: true });
    service.close();
  });

  it('bounds threads whose termination never returns, reports it, and resumes only after one stops', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const releases: (() => void)[] = [];
    const report = vi.fn();
    const service = new FolderFacts('worker.cjs', {
      report,
      worker: () => {
        const worker = new FakeWorker();
        worker.terminate.mockImplementation(
          () =>
            new Promise<number>((resolve) => {
              releases.push(() => resolve(0));
            }),
        );
        workers.push(worker);
        return worker;
      },
    });
    for (const folder of ['/slow/one', '/slow/two']) {
      const pending = service.probe(folder);
      await vi.advanceTimersByTimeAsync(151);
      expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    }
    const refused = service.probe('/safe');
    await vi.advanceTimersByTimeAsync(151);
    expect(await refused).toEqual({ ok: false, reason: 'busy' });
    expect(workers).toHaveLength(2);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('not stopped'));
    releases[0]!();
    await Promise.resolve();
    const recovered = service.probe('/safe');
    workers.at(-1)!.answer();
    expect(await recovered).toMatchObject({ ok: true });
    service.close();
    for (const release of releases) release();
  });

  it('checks fixed markers beyond the enumerated prefix, approved paths and excluded metadata bodies', async () => {
    await writeFile(path.join(root, 'Makefile'), 'dev:');
    await writeFile(path.join(root, 'package.json'), '{"name":"private"}');
    let entries = 0;
    const readSync = vi.fn(() =>
      entries++ < 2001 ? { name: 'ordinary', isDirectory: () => false } : null,
    );
    const closeSync = vi.fn();
    vi.mocked(opendirSync).mockReturnValueOnce({ readSync, closeSync } as never);
    expect(probeFolder(root)).toMatchObject({
      ok: true,
      capped: true,
      markers: expect.arrayContaining(['Makefile']),
    });
    expect(readSync).toHaveBeenCalledTimes(2000);
    expect(probeFolder(root, root, new Set())).toMatchObject({ ok: true, package: undefined });
    expect(
      readFolderFile(path.join(root, 'package.json'), 100, path.join(root, 'other.json')),
    ).toEqual({ ok: false, reason: 'changed' });
  });

  it('ignores a stale response after the next request starts', async () => {
    const worker = new FakeWorker();
    const service = new FolderFacts('worker.cjs', { worker: () => worker });
    const first = service.probe('/one');
    const id = worker.requests[0]!.id;
    worker.answer();
    await first;
    const second = service.probe('/two');
    let done = false;
    void second.then(() => {
      done = true;
    });
    worker.receive?.({ id, value: { ok: true, path: '/one', bytes: new Uint8Array() } });
    await Promise.resolve();
    expect(done).toBe(false);
    worker.answer();
    expect(await second).toMatchObject({ path: '/two' });
    service.close();
  });

  it.each(['escaped', 'revoked'] as const)(
    'refuses a %s canonical result after the preflight',
    async (kind) => {
      const worker = new FakeWorker();
      let allowed = true;
      const service = new FolderFacts('worker.cjs', {
        worker: () => worker,
        access: () =>
          allowed ? { allows: (actual) => actual.startsWith('/approved/') } : undefined,
      });
      const pending = service.read('/approved/file', 100);
      const id = worker.requests[0]!.id;
      worker.receive?.({ id, check: '/approved/file' });
      if (kind === 'revoked') allowed = false;
      worker.receive?.({
        id,
        value: {
          ok: true,
          path: kind === 'escaped' ? '/outside/file' : '/approved/file',
          bytes: new Uint8Array(),
        },
      });
      expect(await pending).toEqual({ ok: false, reason: 'scope' });
      service.close();
    },
  );
});

describe('folder facts filesystem operations', () => {
  it('refuses non-regular or oversized paths before opening and uses nonblocking no-follow opens', async () => {
    const file = path.join(root, 'sample');
    await writeFile(file, 'sample');
    expect(readFolderFile(root, 100)).toEqual({ ok: false, reason: 'not-regular' });
    expect(openSync).not.toHaveBeenCalled();
    expect(readFolderFile(file, 5)).toEqual({ ok: false, reason: 'too-large' });
    expect(openSync).not.toHaveBeenCalled();
    expect(readFolderFile(file, 6)).toMatchObject({ ok: true });
    const flags = vi.mocked(openSync).mock.calls[0]![1];
    expect(typeof flags).toBe('number');
    expect(Number(flags) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(Number(flags) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  });

  it('refuses a directory opened during a path change and growth after the initial size check', async () => {
    const fs = await vi.importActual<typeof NodeFs>('node:fs');
    const file = path.join(root, 'sample');
    await writeFile(file, 'sample');
    vi.mocked(openSync).mockImplementationOnce((_file, flags, mode) =>
      fs.openSync(root, flags, mode),
    );
    expect(readFolderFile(file, 6)).toEqual({ ok: false, reason: 'not-regular' });
    vi.mocked(openSync).mockImplementationOnce((file, flags, mode) => {
      appendFileSync(file, 'x');
      return fs.openSync(file, flags, mode);
    });
    expect(readFolderFile(file, 6)).toEqual({ ok: false, reason: 'too-large' });
  });
  it.skipIf(process.platform === 'win32')(
    'refuses a FIFO without opening or blocking on it',
    () => {
      const file = path.join(root, 'pipe');
      execFileSync('mkfifo', [file]);
      expect(readFolderFile(file, 100)).toEqual({ ok: false, reason: 'not-regular' });
    },
  );
  it('reads bounded regular files and refuses directories and escaping links', async () => {
    await mkdir(path.join(root, 'inside'));
    await writeFile(path.join(root, 'outside'), 'outside');
    const file = path.join(root, 'inside', 'package.json');
    await writeFile(file, 'sample');
    expect(readFolderFile(file, 6)).toMatchObject({ ok: true, bytes: Buffer.from('sample') });
    expect(readFolderFile(file, 5)).toEqual({ ok: false, reason: 'too-large' });
    expect(readFolderFile(file, 262145)).toEqual({ ok: false, reason: 'too-large' });
    expect(readFolderFile(path.join(root, 'inside'), 100)).toEqual({
      ok: false,
      reason: 'not-regular',
    });
    await symlink('../outside', path.join(root, 'inside', 'escape'));
    expect(readFolderFile(path.join(root, 'inside', 'escape'), 100)).toEqual({
      ok: false,
      reason: 'outside-folder',
    });
    await symlink('package.json', path.join(root, 'inside', 'local'));
    expect(readFolderFile(path.join(root, 'inside', 'local'), 100)).toMatchObject({ ok: true });
    expect(readFolderFile(path.join(root, 'missing'), 100)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('reports exact identity, marker names, manifest facts and git file kinds', async () => {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'sample', workspaces: ['packages/*'], packageManager: 'pnpm@10' }),
    );
    await writeFile(path.join(root, '.git'), 'gitdir: /repos/sample/.git/worktrees/side');
    await mkdir(path.join(root, 'Sample.xcodeproj'));
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages: []');
    const facts = probeFolder(root);
    expect(facts).toMatchObject({
      ok: true,
      git: 'worktree',
      package: { name: 'sample', workspaces: true, packageManager: 'pnpm@10' },
    });
    if (!facts.ok) throw new Error('Expected folder facts.');
    expect(typeof facts.identity.dev).toBe('bigint');
    expect(typeof facts.identity.ino).toBe('bigint');
    expect(facts.markers).toEqual(
      expect.arrayContaining(['.git', 'package.json', 'Sample.xcodeproj', 'pnpm-workspace.yaml']),
    );
    await writeFile(path.join(root, '.git'), 'gitdir: /repos/sample/.git/modules/child');
    expect(probeFolder(root)).toMatchObject({ git: 'submodule' });
    await writeFile(path.join(root, '.git'), 'x'.repeat(4097));
    expect(probeFolder(root)).toMatchObject({ git: undefined });
  });

  it('caps enumeration and still checks every fixed marker', async () => {
    await Promise.all(
      Array.from({ length: 2010 }, (_, index) => writeFile(path.join(root, 'entry-' + index), '')),
    );
    await writeFile(path.join(root, 'Makefile'), 'dev:');
    const facts = probeFolder(root);
    expect(facts).toMatchObject({
      ok: true,
      capped: true,
      markers: expect.arrayContaining(['Makefile']),
    });
    expect((await readdir(root)).length).toBe(2011);
  });
});

describe('folder facts scheduling', () => {
  it('runs both operations through the real Node thread without launching Electron', async () => {
    const output = path.join(root, 'worker');
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir: output,
        emptyOutDir: false,
        lib: {
          entry: path.resolve('src/desktop/workspaces/folder-facts-worker.ts'),
          formats: ['cjs'],
          fileName: () => 'facts.cjs',
        },
        rollupOptions: { external: [/^node:/] },
      },
    });
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'sample', scripts: { dev: 'serve' } }),
    );
    const thread = new Worker(path.join(output, 'facts.cjs'));
    await once(thread, 'online');
    vi.useFakeTimers();
    const worker: OwnedWorker<FolderFactsReply> = {
      thread,
      postMessage: (value) => thread.postMessage(value),
      message: (listener) => {
        thread.on('message', listener);
      },
      exit: (listener) => {
        thread.on('exit', listener);
      },
    };
    const service = new FolderFacts('unused.cjs', { worker: () => worker });
    try {
      expect(await service.read(path.join(root, 'package.json'), 1000)).toMatchObject({ ok: true });
      expect(await service.probe(root)).toMatchObject({ ok: true, package: { name: 'sample' } });
    } finally {
      service.close();
      await thread.terminate();
    }
  });

  it('approves canonical paths before content reads and excludes scoped-out manifest bodies', async () => {
    const worker = new FakeWorker();
    const service = new FolderFacts('worker.cjs', {
      worker: () => worker,
      access: (file) =>
        file.endsWith('package.json')
          ? undefined
          : { allows: (actual) => !actual.startsWith('/outside') },
    });
    const pending = service.probe('/project');
    const id = worker.requests[0]!.id;
    worker.receive?.({ id, check: '/project', files: ['/project/.git', '/project/package.json'] });
    expect(worker.approvals).toEqual([
      { id, kind: 'allow', allowed: true, files: ['/project/.git'] },
    ]);
    worker.answer();
    await pending;
    const escape = service.probe('/project/link');
    const next = worker.requests.at(-1)!.id;
    worker.receive?.({ id: next, check: '/outside' });
    expect(worker.approvals.at(-1)!.allowed).toBe(false);
    worker.receive?.({ id: next, value: { ok: false, reason: 'scope' } });
    expect(await escape).toEqual({ ok: false, reason: 'scope' });
    service.close();
  });
  it('serializes requests and puts interactive reads ahead of queued probes', async () => {
    const worker = new FakeWorker();
    const service = new FolderFacts('worker.cjs', { worker: () => worker });
    const first = service.probe('/projects/one');
    const probe = service.probe('/projects/two');
    const read = service.read('/projects/one/package.json', 100);
    expect(worker.requests).toHaveLength(1);
    worker.answer();
    await first;
    expect(worker.requests.at(-1)!.kind).toBe('read');
    worker.answer();
    await read;
    expect(worker.requests.at(-1)!.path).toBe('/projects/two');
    worker.answer();
    await probe;
    service.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a timed-out thread, quarantines its volume and caps pass relaunches', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const service = new FolderFacts('worker.cjs', {
      worker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const pass = service.pass();
    for (let index = 0; index < 4; index++) {
      const request = service.probe('/Volumes/Disk-' + index + '/sample', pass);
      await vi.advanceTimersByTimeAsync(151);
      expect(await request).toEqual({ ok: false, reason: 'timeout' });
      expect(workers[index]!.terminate).toHaveBeenCalledOnce();
    }
    expect(workers).toHaveLength(4);
    expect(await service.probe('/Volumes/Fifth/sample', pass)).toEqual({
      ok: false,
      reason: 'budget',
    });
    expect(await service.probe('/Volumes/Disk-0/other')).toEqual({
      ok: false,
      reason: 'quarantined',
    });
    await vi.advanceTimersByTimeAsync(30_001);
    const fresh = service.read('/Volumes/Disk-0/package.json', 100);
    workers.at(-1)!.answer();
    expect(await fresh).toMatchObject({ ok: true });
    service.close();
  });

  it('checks each request scope and rechecks revocation and canonical containment after replies', async () => {
    const worker = new FakeWorker();
    let allowed = true;
    const access = vi.fn((file: string) =>
      allowed && !file.includes('denied')
        ? { allows: (actual: string) => allowed && actual === file }
        : undefined,
    );
    const service = new FolderFacts('worker.cjs', { worker: () => worker, access });
    expect(await service.probe('/denied')).toEqual({ ok: false, reason: 'scope' });
    const first = service.read('/one/package.json', 100);
    worker.answer();
    expect(await first).toMatchObject({ ok: true });
    const second = service.read('/two/package.json', 100);
    worker.answer();
    expect(await second).toMatchObject({ ok: true });
    const revoked = service.probe('/three');
    allowed = false;
    worker.answer();
    expect(await revoked).toEqual({ ok: false, reason: 'scope' });
    service.close();
  });
});
