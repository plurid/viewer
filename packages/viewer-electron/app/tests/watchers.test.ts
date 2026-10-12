import { describe, expect, it, vi } from 'vitest';
import { Watchers } from '../src/desktop/watchers';

const watch = vi.hoisted(() => vi.fn());
vi.mock('../src/desktop/directory-watch', () => ({ watchDirectory: watch }));
class Watch {
  close = vi.fn(async () => {});
}

describe('shared watcher recovery', () => {
  it('replaces a failed watcher without losing other subscribers or accepting retired events', async () => {
    const first = new Watch(),
      recovered = new Watch(),
      events = vi.fn();
    watch.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(recovered);
    const watchers = new Watchers(events);
    await watchers.add('/chosen', 'first');
    await watchers.add('/chosen', 'second');
    const firstCallbacks = watch.mock.calls[0][1];
    firstCallbacks.failed(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
    expect(events).toHaveBeenLastCalledWith({
      type: 'watch-error',
      path: '/chosen',
      message: 'Permission denied',
      code: 'EACCES',
    });
    await watchers.add('/chosen', 'first');
    expect(watch).toHaveBeenCalledTimes(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(watchers.count).toBe(1);
    events.mockClear();
    firstCallbacks.failed(new Error('retired event'));
    firstCallbacks.changed('/chosen/file');
    expect(events).not.toHaveBeenCalled();
    await watchers.remove('first');
    expect(recovered.close).not.toHaveBeenCalled();
    await watchers.remove('second');
    expect(recovered.close).toHaveBeenCalledTimes(1);
    expect(watchers.count).toBe(0);
    await watchers.close();
  });
});
