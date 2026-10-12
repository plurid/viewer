import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileServices } from '../src/desktop/file-services';
import { defaultSettings } from '../src/domain/services';
import { FileAccessRequired } from '../src/desktop/file-access';

const fork = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ utilityProcess: { fork } }));
class TestWorker extends EventEmitter {
  pid: number | undefined = 9999999;
  acknowledgeClose = true;
  acknowledgeInit = true;
  exitOnKill = true;
  postMessage = vi.fn((request: { id: string; method: string; args: unknown[] }) => {
    if (request.method === 'status') {
      queueMicrotask(() =>
        this.emit('message', { id: request.id, value: { roots: [], count: 0, running: false } }),
      );
      return;
    }
    if (
      (request.method === 'init' && this.acknowledgeInit) ||
      request.method === 'configure' ||
      (request.method === 'close' && this.acknowledgeClose)
    )
      queueMicrotask(() => this.emit('message', { id: request.id, value: true }));
  });
  kill = vi.fn(() => {
    if (this.exitOnKill) {
      this.pid = undefined;
      this.emit('exit', 0);
    }
    return true;
  });
}
let worker: TestWorker;
const force = vi.fn(() => true as const);
beforeEach(() => {
  vi.useFakeTimers();
  worker = new TestWorker();
  fork.mockReset().mockReturnValue(worker);
  force.mockReset().mockImplementation(() => {
    worker.pid = undefined;
    worker.emit('exit', 0);
    return true as const;
  });
  vi.spyOn(process, 'kill').mockImplementation(force);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const services = () => new FileServices('/isolated-profile', '/worker', '/ocr', () => {});
describe('read-only file-services shutdown', () => {
  it('preserves OS permission errors from readers so previews can request folder access', async () => {
    const files = services();
    const pending = files.extract('/document.pdf');
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'EPERM',
      message: 'Permission denied',
    });
    await vi.advanceTimersByTimeAsync(0);
    const request = worker.postMessage.mock.calls.find(
      ([request]) => request.method === 'extract',
    )![0];
    worker.emit('message', { id: request.id, error: 'Permission denied', code: 'EPERM' });
    await rejected;
    await files.close();
  });
  it('indexes granted roots while reporting missing permissions without rewriting user preferences', async () => {
    const access = vi.fn(async (paths: readonly string[]) => {
      if (paths.includes('/denied')) throw new FileAccessRequired('/denied');
    });
    const files = new FileServices(
      '/private',
      '/worker',
      '/ocr',
      () => {},
      () => {},
      {
        access,
      },
    );
    const configuration = {
      ...defaultSettings('/fixtures').search,
      roots: ['/allowed', '/denied'],
      contentRoots: ['/denied'],
    };
    await files.configure(configuration);
    const sent = worker.postMessage.mock.calls.find(
      ([request]) => request.method === 'configure',
    )![0];
    expect(sent.args).toEqual([{ ...configuration, roots: ['/allowed'], contentRoots: [] }]);
    expect(configuration.roots).toEqual(['/allowed', '/denied']);
    expect(configuration.contentRoots).toEqual(['/denied']);
    expect((await files.status()).roots).toContainEqual({
      path: '/denied',
      status: 'offline',
      count: 0,
      errors: 1,
    });
    await files.close();
  });
  it('refuses unauthorized extraction, measurements, updates and scoped searches before starting a worker', async () => {
    const files = new FileServices(
      '/private',
      '/worker',
      '/ocr',
      () => {},
      () => {},
      {
        access: async (paths) => {
          throw new FileAccessRequired(paths[0]);
        },
      },
    );
    for (const pending of [
      files.extract('/denied'),
      files.sizeStart(['/denied']),
      files.update('/denied'),
      files.query({ query: 'private', root: '/denied' }),
    ]) {
      await expect(pending).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    }
    expect(fork).not.toHaveBeenCalled();
    await files.close();
  });
  it('rejects pending reads, closes once and prevents a late request from restarting the worker', async () => {
    const files = services();
    await files.configure(defaultSettings('/fixtures').search);
    const pending = files.query({ query: 'book', limit: 10 });
    const rejected = expect(pending).rejects.toThrow('shutting down');
    await vi.advanceTimersByTimeAsync(0);
    const closing = files.close();
    expect(files.close()).toBe(closing);
    await closing;
    await rejected;
    await expect(files.status()).rejects.toThrow('shutting down');
    expect(fork).toHaveBeenCalledTimes(1);
    expect(worker.kill).toHaveBeenCalledTimes(1);
    expect(force).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops a suspended worker within three seconds rather than the ordinary two-minute timeout', async () => {
    const files = services();
    await files.configure(defaultSettings('/fixtures').search);
    worker.acknowledgeClose = false;
    worker.exitOnKill = false;
    let closed = false;
    const closing = files.close().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1001);
    await closing;
    expect(force).toHaveBeenCalledExactlyOnceWith(9999999, 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not wait for initialization before closing and never spawns a worker just to shut down', async () => {
    const idle = services();
    await idle.close();
    await expect(idle.status()).rejects.toThrow('shutting down');
    expect(fork).not.toHaveBeenCalled();
    const files = services();
    worker.acknowledgeInit = false;
    const pending = files.status();
    const rejected = expect(pending).rejects.toThrow('shutting down');
    await files.close();
    await rejected;
    expect(fork).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
