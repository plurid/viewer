import { describe, expect, it, vi } from 'vitest';
import { Watchers } from '../src/desktop/files/watchers';
import { createFileHandlers } from '../src/desktop/ipc/file-handlers';

const watch = vi.hoisted(() => vi.fn());
vi.mock('../src/desktop/files/directory-watch', () => ({ watchDirectory: watch }));
vi.mock('electron', () => ({
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn(), openExternal: vi.fn() },
}));
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

  it('removes only a closed window owner subscriptions and closes watches left without subscribers', async () => {
    const watchA = new Watch(),
      watchB = new Watch(),
      watchShared = new Watch(),
      events = vi.fn();
    watch
      .mockReset()
      .mockReturnValueOnce(watchA)
      .mockReturnValueOnce(watchShared)
      .mockReturnValueOnce(watchB);
    const watchers = new Watchers(events);
    await watchers.add('/folder-a', 'plane-1', 1);
    await watchers.add('/folder-shared', 'plane-2', 1);
    await watchers.add('/folder-b', 'plane-1', 2);
    await watchers.add('/folder-shared', 'plane-2', 2);
    expect(watchers.count).toBe(3);

    await watchers.stopOwner(2);
    expect(watchB.close).toHaveBeenCalledTimes(1);
    expect(watchShared.close).not.toHaveBeenCalled();
    expect(watchA.close).not.toHaveBeenCalled();
    expect(watchers.count).toBe(2);

    await watchers.stopOwner(1);
    expect(watchA.close).toHaveBeenCalledTimes(1);
    expect(watchShared.close).toHaveBeenCalledTimes(1);
    expect(watchers.count).toBe(0);
    await watchers.close();
  });

  it('emits folder-changed for watched folders under /Volumes when mounted volumes change', async () => {
    vi.useFakeTimers();
    try {
      const usbWatch = new Watch(),
        localWatch = new Watch(),
        events = vi.fn(),
        stopVolumes = vi.fn();
      let onVolumesChanged: (() => void) | undefined;
      const watchVolumes = vi.fn((changed: () => void) => {
        onVolumesChanged = changed;
        return stopVolumes;
      });
      watch.mockReset().mockReturnValueOnce(usbWatch).mockReturnValueOnce(localWatch);
      const watchers = new Watchers(events, watchVolumes);
      await watchers.add('/Volumes/USB/Photos', 'sub-usb', 1);
      await watchers.add('/Users/al/Docs', 'sub-local', 1);
      expect(watchVolumes).toHaveBeenCalledOnce();
      expect(onVolumesChanged).toBeTypeOf('function');

      onVolumesChanged!();
      await vi.advanceTimersByTimeAsync(150);
      expect(events).toHaveBeenCalledWith({ type: 'folder-changed', path: '/Volumes/USB/Photos' });
      expect(events).not.toHaveBeenCalledWith({ type: 'folder-changed', path: '/Users/al/Docs' });

      await watchers.remove('sub-usb', 1);
      expect(stopVolumes).toHaveBeenCalledOnce();
      await watchers.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards owner to watchers in file handlers and skips or detaches watches when the owner closes or reloads in flight', async () => {
    const liveWatch = new Watch();
    const raceWatch = new Watch();
    watch.mockReset().mockReturnValueOnce(liveWatch).mockReturnValueOnce(raceWatch);
    const watchers = new Watchers(vi.fn());
    const addSpy = vi.spyOn(watchers, 'add');
    const removeSpy = vi.spyOn(watchers, 'remove');
    const alive = new Set<number>([10, 20, 30]);
    let resolveRequire: (() => void) | undefined;
    const requireAccess = vi.fn(async () => {});
    const handlers = createFileHandlers({
      fileAccess: { require: requireAccess },
      files: {
        inspect: vi.fn(),
        sizeStart: vi.fn(),
        sizeGet: vi.fn(),
        sizeCancel: vi.fn(),
      },
      information: { get: vi.fn(), update: vi.fn() },
      watchers,
      ownerAlive: (owner) => alive.has(owner),
    });

    // Normal watch and unwatch forward owner.
    await handlers.watch(['/folder-live', 'pane-1'], 10);
    expect(addSpy).toHaveBeenCalledWith('/folder-live', 'pane-1', 10);
    expect(watchers.count).toBe(1);
    await handlers.unwatch(['pane-1'], 10);
    expect(removeSpy).toHaveBeenCalledWith('pane-1', 10);
    expect(liveWatch.close).toHaveBeenCalledOnce();
    expect(watchers.count).toBe(0);

    // Owner closes while the initial fileAccess.require is in flight: never attaches an orphaned watch.
    addSpy.mockClear();
    requireAccess.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRequire = resolve;
        }),
    );
    const pendingClose = handlers.watch(['/folder-closed', 'pane-2'], 20);
    await vi.waitFor(() => expect(resolveRequire).toBeTypeOf('function'));
    alive.delete(20);
    await watchers.stopOwner(20);
    resolveRequire!();
    await pendingClose;
    expect(addSpy).not.toHaveBeenCalled();
    expect(watchers.count).toBe(0);

    // Owner reloads (still alive, stopOwner ran) while the post-attach require is in flight: detaches cleanly.
    resolveRequire = undefined;
    requireAccess.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRequire = resolve;
        }),
    );
    const pendingReload = handlers.watch(['/folder-reloaded', 'pane-3'], 30);
    await vi.waitFor(() => expect(resolveRequire).toBeTypeOf('function'));
    await watchers.stopOwner(30);
    resolveRequire!();
    await pendingReload;
    expect(watchers.count).toBe(0);
    expect(raceWatch.close).toHaveBeenCalledOnce();

    await watchers.close();
  });
});
