import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchDirectory } from '../src/desktop/files/directory-watch';

const native = vi.hoisted(() => vi.fn());
vi.mock('node:fs', () => ({ watch: native }));
class Watch extends EventEmitter {
  close = vi.fn();
}
afterEach(() => native.mockReset());

describe('directory watcher resource ownership', () => {
  it('closes a failed watcher immediately, reports the failure once and ignores later events', async () => {
    const backend = new Watch();
    native.mockReturnValue(backend);
    const changed = vi.fn(),
      failed = vi.fn();
    const owned = watchDirectory('/chosen', { changed, failed });
    const callback = native.mock.calls[0][2];
    callback('rename', 'file.txt');
    expect(changed).toHaveBeenCalledWith('/chosen/file.txt');
    const error = Object.assign(new Error('Too many open files'), { code: 'EMFILE' });
    backend.emit('error', error);
    expect(backend.close).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    callback('change', 'file.txt');
    backend.emit('error', error);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    await owned.close();
    expect(backend.close).toHaveBeenCalledTimes(1);
  });
  it('reconciles missing filenames and rejects event paths outside the owned directory', async () => {
    native.mockReturnValue(new Watch());
    const changed = vi.fn();
    const owned = watchDirectory('/chosen', { changed, failed: vi.fn() });
    const callback = native.mock.calls[0][2];
    callback('change', null);
    expect(changed).toHaveBeenCalledExactlyOnceWith('/chosen');
    callback('rename', '../outside');
    callback('rename', '/other/file');
    expect(changed).toHaveBeenCalledTimes(1);
    await owned.close();
  });
  it('reports synchronous permission failures after shared ownership is installed', async () => {
    const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    native.mockImplementation(() => {
      throw error;
    });
    const failed = vi.fn();
    const owned = watchDirectory('/chosen', { changed: vi.fn(), failed });
    expect(failed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    await owned.close();
  });
});
