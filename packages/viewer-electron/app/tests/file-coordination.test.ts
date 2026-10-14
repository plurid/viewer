import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileCoordination } from '../src/desktop/file-coordination';
import type { FileAccessIntent } from '../src/desktop/macos-files';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function binding() {
  return {
    coordinateStart: vi.fn(
      async (_id: string, intents: FileAccessIntent[], _purpose: string, _nested?: boolean) =>
        intents.map((intent) => intent.path),
    ),
    coordinateCancel: vi.fn((_id: string) => {}),
    coordinateEnd: vi.fn(async (_id: string) => {}),
    coordinateSameItem: vi.fn((_original: string, _returned: string) => false),
  };
}
let root: string;
const services: FileCoordination[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-coordination-'));
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await rm(root, { recursive: true, force: true });
});
function service(native: ReturnType<typeof binding>, timeout?: number) {
  const result = new FileCoordination(() => native, timeout);
  services.push(result);
  return result;
}
describe('coordinated access boundary', () => {
  it.skipIf(process.platform === 'win32')(
    'denies FIFO content before starting a native provider wait',
    async () => {
      const file = path.join(root, 'Pipe.xlsx');
      await promisify(execFile)('/usr/bin/mkfifo', [file]);
      const native = binding(),
        coordination = service(native);
      await expect(coordination.acquire([{ path: file, mode: 'read' }])).rejects.toThrow(
        'regular file',
      );
      const alias = path.join(root, 'Linked pipe.xlsx');
      await symlink(file, alias);
      native.coordinateStart.mockRejectedValue(new Error('Reached native provider wait'));
      await expect(coordination.acquire([{ path: alias, mode: 'read' }])).rejects.toThrow(
        'regular file',
      );
      expect(native.coordinateStart).not.toHaveBeenCalled();
      expect(native.coordinateEnd).not.toHaveBeenCalled();
    },
  );
  it('uses a canonical ancestry alias and releases once after the reader closes', async () => {
    const folder = path.join(root, 'actual'),
      alias = path.join(root, 'alias');
    await mkdir(folder);
    await symlink(folder, alias);
    const original = path.join(alias, 'file'),
      returned = path.join(await realpath(folder), 'file');
    await writeFile(returned, 'generated');
    const native = binding();
    native.coordinateStart.mockImplementation(async () => [returned]);
    const coordination = service(native),
      lease = await coordination.acquire([{ path: original, mode: 'read' }]);
    expect(lease.path(original)).toBe(returned);
    await lease.run(async () => {
      expect(coordination.path(original)).toBe(returned);
    });
    expect(native.coordinateEnd).not.toHaveBeenCalled();
    await Promise.all([lease.release(), lease.release()]);
    expect(native.coordinateEnd).toHaveBeenCalledTimes(1);
  });
  it('rejects an actual relocation before captured work can run', async () => {
    const original = path.join(root, 'original'),
      moved = path.join(root, 'moved');
    await writeFile(original, 'same content');
    await writeFile(moved, 'same content');
    const native = binding();
    native.coordinateStart.mockImplementation(async () => [moved]);
    const work = vi.fn(async () => {});
    await expect(service(native).run([{ path: original, mode: 'move' }], work)).rejects.toThrow(
      'item moved',
    );
    expect(work).not.toHaveBeenCalled();
    expect(native.coordinateEnd).toHaveBeenCalledTimes(1);
  });
  it('preserves a symlink leaf instead of accepting its target as the item', async () => {
    const target = path.join(root, 'target'),
      link = path.join(root, 'link');
    await writeFile(target, 'generated');
    await symlink(target, link);
    const native = binding();
    native.coordinateStart.mockImplementation(async () => [target]);
    await expect(service(native).acquire([{ path: link, mode: 'metadata' }])).rejects.toThrow(
      'item moved',
    );
  });
  it('cancels a waiting provider before a mutation starts', async () => {
    const native = binding(),
      ready = deferred<string[]>(),
      entered = deferred<void>();
    native.coordinateStart.mockImplementation(async () => {
      entered.resolve();
      return ready.promise;
    });
    native.coordinateCancel.mockImplementation(() =>
      ready.reject(new DOMException('Cancelled', 'AbortError')),
    );
    const abort = new AbortController(),
      work = vi.fn(async () => {});
    const result = service(native).run(
      [{ path: path.join(root, 'file'), mode: 'write' }],
      work,
      abort.signal,
    );
    const rejected = expect(result).rejects.toThrow('Cancelled');
    await entered.promise;
    abort.abort();
    await rejected;
    expect(work).not.toHaveBeenCalled();
    expect(native.coordinateEnd).toHaveBeenCalledTimes(1);
  });
  it('does not release an acquired claim until cancelled work closes its handles', async () => {
    const native = binding(),
      entered = deferred<void>(),
      close = deferred<void>(),
      abort = new AbortController();
    const result = service(native).run(
      [{ path: path.join(root, 'file'), mode: 'read' }],
      async (signal) => {
        entered.resolve();
        await close.promise;
        signal?.throwIfAborted();
      },
      abort.signal,
    );
    const rejected = expect(result).rejects.toThrow();
    await entered.promise;
    abort.abort();
    expect(native.coordinateCancel).toHaveBeenCalledTimes(1);
    expect(native.coordinateEnd).not.toHaveBeenCalled();
    close.resolve();
    await rejected;
    expect(native.coordinateEnd).toHaveBeenCalledTimes(1);
  });
  it('drains only a revoked root, including an ancestry alias', async () => {
    const folder = path.join(root, 'affected'),
      alias = path.join(root, 'alias');
    await mkdir(folder);
    await symlink(folder, alias);
    const native = binding(),
      coordination = service(native);
    const affected = await coordination.acquire([{ path: path.join(alias, 'file'), mode: 'read' }]);
    const independent = await coordination.acquire([
      { path: path.join(root, 'other'), mode: 'read' },
    ]);
    const draining = coordination.quiesce(folder);
    await vi.waitFor(() => expect(affected.signal?.aborted).toBe(true));
    expect(independent.signal?.aborted).toBe(false);
    expect(native.coordinateEnd).not.toHaveBeenCalled();
    await affected.release();
    await draining;
    await independent.release();
  });
  it('times out a stalled provider and closes the pending native claim', async () => {
    const native = binding(),
      ready = deferred<string[]>();
    native.coordinateStart.mockImplementation(async () => ready.promise);
    native.coordinateCancel.mockImplementation(() =>
      ready.reject(new DOMException('Cancelled', 'AbortError')),
    );
    await expect(
      service(native, 10).acquire([{ path: path.join(root, 'file'), mode: 'read' }]),
    ).rejects.toThrow('in time');
    expect(native.coordinateCancel).toHaveBeenCalledTimes(1);
    expect(native.coordinateEnd).toHaveBeenCalledTimes(1);
  });
  it('does not acquire a native claim for an already cancelled request', async () => {
    const native = binding(),
      abort = new AbortController();
    abort.abort();
    await expect(
      service(native).acquire([{ path: path.join(root, 'file'), mode: 'read' }], abort.signal),
    ).rejects.toThrow();
    expect(native.coordinateStart).not.toHaveBeenCalled();
  });
  it('reuses covered paths and gives one intermediate claim the same purpose', async () => {
    const native = binding(),
      coordination = service(native),
      file = path.join(root, 'file');
    await coordination.run([{ path: file, mode: 'write' }], async () => {
      await coordination.run([{ path: file, mode: 'read' }], async () => {});
      await coordination.run(
        [{ path: path.join(root, 'intermediate'), mode: 'write' }],
        async () => {
          await expect(
            coordination.acquire([{ path: path.join(root, 'third'), mode: 'write' }]),
          ).rejects.toThrow('Declare all');
        },
      );
    });
    expect(native.coordinateStart).toHaveBeenCalledTimes(2);
    const calls = native.coordinateStart.mock.calls;
    expect(calls[1][2]).toBe(calls[0][2]);
    expect(calls[0][3]).toBe(false);
    expect(calls[1][3]).toBe(true);
  });
  it('bounds pending claims and refuses new work after close', async () => {
    const native = binding(),
      coordination = service(native);
    const leases = [];
    for (let i = 0; i < 128; i++)
      leases.push(await coordination.acquire([{ path: path.join(root, String(i)), mode: 'read' }]));
    await expect(
      coordination.acquire([{ path: path.join(root, 'overflow'), mode: 'read' }]),
    ).rejects.toThrow('Too many');
    await Promise.all(leases.map((lease) => lease.release()));
    await coordination.close();
    await expect(
      coordination.acquire([{ path: path.join(root, 'late'), mode: 'read' }]),
    ).rejects.toThrow('closed');
  });
});
