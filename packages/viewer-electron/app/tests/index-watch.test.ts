import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexWatcher } from '../src/desktop/search/index-watch';
import { defaultSettings } from '../src/domain/services';

const watch = vi.hoisted(() => vi.fn());
vi.mock('../src/desktop/files/directory-watch', () => ({ watchDirectory: watch }));
beforeEach(() => {
  vi.useFakeTimers();
  watch.mockReset().mockImplementation(() => ({ close: vi.fn(async () => {}) }));
});
afterEach(() => vi.useRealTimers());

describe('bounded recursive index reconciliation', () => {
  it('collapses a bulk transfer into a root reconciliation and suppresses excluded paths', async () => {
    const changed = vi.fn(async (_file: string) => {});
    const config = {
      ...defaultSettings('/chosen').search,
      exclusions: ['node_modules', '/chosen/private'],
    };
    const watcher = new IndexWatcher(config, changed, vi.fn());
    const callbacks = watch.mock.calls[0][1];
    expect(callbacks.ignored('/chosen/node_modules/file')).toBe(true);
    expect(callbacks.ignored('/chosen/private/file')).toBe(true);
    expect(callbacks.ignored('/chosen/private-other/file')).toBe(false);
    for (let file = 0; file < 3000; file++) callbacks.changed(`/chosen/nested/file-${file}`);
    await vi.advanceTimersByTimeAsync(250);
    expect(changed).toHaveBeenCalledExactlyOnceWith('/chosen');
    await watcher.close();
  });
  it('keeps separate roots, coalesces directory/child events and retires pending updates on close', async () => {
    const changed = vi.fn(async (_file: string) => {});
    const watcher = new IndexWatcher(
      { ...defaultSettings('/one').search, roots: ['/one', '/two'] },
      changed,
      vi.fn(),
    );
    const first = watch.mock.calls[0][1],
      second = watch.mock.calls[1][1];
    first.changed('/one/folder/file');
    first.changed('/one/folder');
    second.changed('/two/file');
    await vi.advanceTimersByTimeAsync(250);
    expect(changed.mock.calls.map(([file]) => file)).toEqual(['/one/folder', '/two/file']);
    first.changed('/one/retired');
    await watcher.close();
    first.changed('/one/also-retired');
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('serializes a slow reconciliation and retains changes received while it runs', async () => {
    let finish!: () => void;
    const changed = vi
      .fn<(file: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const watcher = new IndexWatcher(defaultSettings('/chosen').search, changed, vi.fn());
    const callbacks = watch.mock.calls[0][1];
    callbacks.changed('/chosen/first');
    await vi.advanceTimersByTimeAsync(250);
    callbacks.changed('/chosen/second');
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(changed.mock.calls.map(([file]) => file)).toEqual(['/chosen/first', '/chosen/second']);
    await watcher.close();
  });
  it('releases watches for reconfiguration without waiting for an in-flight index read', async () => {
    let finish!: () => void;
    const changed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const watcher = new IndexWatcher(defaultSettings('/chosen').search, changed, vi.fn());
    watch.mock.calls[0][1].changed('/chosen/slow-read');
    await vi.advanceTimersByTimeAsync(250);
    await watcher.stop();
    expect(watch.mock.results[0].value.close).toHaveBeenCalledTimes(1);
    let drained = false;
    const closing = watcher.close().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await closing;
    expect(drained).toBe(true);
    expect(watch.mock.results[0].value.close).toHaveBeenCalledTimes(1);
  });
});
