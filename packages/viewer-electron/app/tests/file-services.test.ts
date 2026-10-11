import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileServices } from '../src/desktop/file-services';
import { defaultSettings } from '../src/domain/services';

const fork = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ utilityProcess: { fork } }));
class TestWorker extends EventEmitter {
  pid: number | undefined = 9999999;
  acknowledgeClose = true;
  acknowledgeInit = true;
  exitOnKill = true;
  postMessage = vi.fn((request: { id: string; method: string }) => {
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
