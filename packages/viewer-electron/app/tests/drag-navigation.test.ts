import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  DragAutoScroll,
  SpringHover,
  SpringNavigation,
  edgeVelocity,
  type DragScrollTarget,
} from '../src/renderer/explorer/drag-navigation';
import { folderDragNavigation } from '../src/renderer/explorer/folder-drag';
import { stateSchema } from '../src/desktop/storage';
import {
  activeWorkspace,
  flushState,
  getState,
  initialize,
  navigate,
  newWorkspace,
  removePanes,
  updateFolderPresentation,
  updatePane,
} from '../src/renderer/state/store';
import { browseSession } from '../src/renderer/workspace/sessions';

const folder = (path: string): FileEntry => ({
  path,
  parent: path.slice(0, path.lastIndexOf('/')) || '/',
  name: path.split('/').pop()!,
  directory: true,
  kind: 'directory',
  extension: '',
  mime: '',
  size: 0,
  created: 0,
  modified: 0,
  hidden: false,
  identity: path,
});
const stat = vi.fn(),
  chooseFolder = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  stat.mockReset().mockImplementation(async (path: string) => folder(path));
  chooseFolder.mockReset();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: {
      stat,
      chooseFolder,
      save: vi.fn(async (state) => {
        stateSchema.parse(state);
      }),
    },
  });
  initialize({ home: '/home', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('spring-loaded folder ownership', () => {
  it('restores the original folder, per-folder presentation, history and selection on cancellation', async () => {
    const id = activeWorkspace().panes[0].id;
    updatePane(id, { mode: 'list', showHidden: true });
    updateFolderPresentation('/home/Nested', { mode: 'grid' });
    const initial = activeWorkspace().panes[0];
    const session = browseSession(id, '/home');
    session.selection = ['/home/original.txt'];
    session.scroll = 150;
    const drag = folderDragNavigation(id);
    await drag.open('/home/Nested', () => true);
    expect(activeWorkspace().panes[0]).toMatchObject({ path: '/home/Nested', mode: 'grid' });
    await drag.open('/home/Nested/Deeper', () => true);
    expect(activeWorkspace().panes[0].path).toBe('/home/Nested/Deeper');
    expect(activeWorkspace().panes[0]).toMatchObject({
      history: ['/home/Nested/Deeper'],
      historyIndex: 0,
    });
    await flushState(false);
    expect(() => stateSchema.parse(getState().saved)).not.toThrow();
    expect(getState().saved.recents).toEqual([]);
    drag.finish();
    expect(activeWorkspace().panes[0]).toEqual(initial);
    expect(browseSession(id, '/home')).toBe(session);
    expect(session.selection).toEqual(['/home/original.txt']);
    expect(session.scroll).toBe(150);
  });
  it('commits only the final folder to history on drop', async () => {
    const id = activeWorkspace().panes[0].id;
    const drag = folderDragNavigation(id);
    await drag.open('/home/Nested', () => true);
    await drag.open('/home/Nested/Deeper', () => true);
    drag.finish(true);
    expect(activeWorkspace().panes[0]).toMatchObject({
      path: '/home/Nested/Deeper',
      history: ['/home', '/home/Nested/Deeper'],
      historyIndex: 1,
    });
    expect(getState().saved.recents).toEqual(['/home/Nested/Deeper']);
    drag.finish();
    expect(activeWorkspace().panes[0].path).toBe('/home/Nested/Deeper');
  });
  it('reveals columns without changing the root or file selection, and restores the trail', async () => {
    const id = activeWorkspace().panes[0].id;
    updatePane(id, { mode: 'columns' });
    const pane = activeWorkspace().panes[0];
    const session = browseSession(id, '/home');
    session.selection = ['/home/source.txt'];
    const drag = folderDragNavigation(id);
    await drag.open('/home/Nested', () => true);
    await drag.open('/home/Nested/Deeper', () => true);
    expect(activeWorkspace().panes[0]).toBe(pane);
    expect(session.columnTrail).toEqual(['/home/Nested', '/home/Nested/Deeper']);
    expect(session.columnDirectory).toBe('/home/Nested/Deeper');
    expect(session.selection).toEqual(['/home/source.txt']);
    drag.finish();
    expect(session.columnTrail).toEqual([]);
    expect(session.columnDirectory).toBe('/home');
    expect(session.columnScope).toBe('/home');
  });
  it('does not open denied folders, links or non-folders, or ask for a picker on hover', async () => {
    const initial = activeWorkspace().panes[0];
    const drag = folderDragNavigation(initial.id);
    stat.mockRejectedValueOnce(new Error('Access denied'));
    await drag.open('/denied', () => true);
    stat.mockResolvedValueOnce({ ...folder('/link'), kind: 'symlink' });
    await drag.open('/link', () => true);
    stat.mockResolvedValueOnce({ ...folder('/file'), directory: false, kind: 'file' });
    await drag.open('/file', () => true);
    expect(activeWorkspace().panes[0]).toBe(initial);
    expect(chooseFolder).not.toHaveBeenCalled();
  });
  it.each(['workspace', 'closed', 'navigated', 'cancelled'])(
    'ignores a pending inspection after its origin is %s',
    async (change) => {
      const initial = activeWorkspace().panes[0];
      const drag = folderDragNavigation(initial.id);
      let resolve!: (entry: FileEntry) => void;
      stat.mockImplementationOnce(() => new Promise<FileEntry>((complete) => (resolve = complete)));
      const opening = drag.open('/home/Nested', () => true);
      if (change === 'workspace') await newWorkspace('Elsewhere');
      else if (change === 'closed') removePanes([initial.id]);
      else if (change === 'navigated') navigate(initial.id, '/other');
      else drag.finish();
      const panes = activeWorkspace().panes;
      resolve(folder('/home/Nested'));
      await opening;
      drag.finish();
      expect(activeWorkspace().panes).toEqual(panes);
      expect(chooseFolder).not.toHaveBeenCalled();
    },
  );
  it('does not restore over deliberate navigation while a drag is in progress', async () => {
    const id = activeWorkspace().panes[0].id;
    const drag = folderDragNavigation(id);
    await drag.open('/home/Nested', () => true);
    navigate(id, '/other');
    await drag.open('/home/Nested/Deeper', () => true);
    drag.finish();
    expect(activeWorkspace().panes[0].path).toBe('/other');
    expect(stat).toHaveBeenCalledTimes(1);
  });
  it('bounds nested traversal and concurrent inspections', async () => {
    let current = { path: '/home' };
    let finish!: (path: string) => void;
    const inspect = vi.fn(
      (path: string) => new Promise<string>((resolve) => (finish = () => resolve(path))),
    );
    const drag = new SpringNavigation({
      read: () => current,
      inspect,
      open: (path: string) => (current = { path }),
      restore: (initial) => (current = initial),
      commit: () => {},
    });
    const opening = drag.open('/one', () => true);
    await drag.open('/two', () => true);
    expect(inspect).toHaveBeenCalledTimes(1);
    finish('/one');
    await opening;
    inspect.mockImplementation(async (path) => path);
    for (let i = 0; i < 40; i++) await drag.open('/folder/' + i, () => true);
    expect(inspect).toHaveBeenCalledTimes(32);
    drag.finish();
    expect(current.path).toBe('/home');
  });
});

describe('stationary spring hover', () => {
  it('waits for a sustained hover and attempts it once', async () => {
    const open = vi.fn(async () => {});
    const hover = new SpringHover(open);
    hover.hover('/folder');
    await vi.advanceTimersByTimeAsync(400);
    hover.hover('/folder');
    await vi.advanceTimersByTimeAsync(249);
    expect(open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(open).toHaveBeenCalledTimes(1);
    hover.hover('/folder');
    await vi.advanceTimersByTimeAsync(1000);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('invalidates both queued and asynchronous hover work on leave', async () => {
    let valid!: () => boolean;
    const open = vi.fn(async (_path: string, owns: () => boolean) => {
      valid = owns;
    });
    const hover = new SpringHover(open);
    hover.hover('/one');
    await vi.advanceTimersByTimeAsync(500);
    hover.hover('/two');
    await vi.advanceTimersByTimeAsync(650);
    expect(open).toHaveBeenCalledExactlyOnceWith('/two', expect.any(Function));
    expect(valid()).toBe(true);
    hover.cancel();
    expect(valid()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

function scroller(targets: DragScrollTarget[]) {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  const changed = vi.fn();
  const scroll = new DragAutoScroll(
    () => targets,
    changed,
    (callback) => {
      frames.set(++next, callback);
      return next;
    },
    (id) => frames.delete(id),
  );
  return {
    scroll,
    frames,
    changed,
    frame(time: number) {
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback(time);
    },
  };
}
function scrollTarget(patch: Partial<DragScrollTarget> = {}): DragScrollTarget {
  const target: DragScrollTarget = {
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 200,
    scrollHeight: 1000,
    scroll(x, y) {
      target.scrollLeft += x;
      target.scrollTop += y;
    },
    ...patch,
  };
  return target;
}
describe('drag edge scrolling', () => {
  it('calls browser animation functions without assigning a controller as their receiver', () => {
    const receiver = (value: unknown) => {
      if (value !== undefined && value !== globalThis) throw new TypeError('Illegal invocation');
    };
    vi.stubGlobal(
      'requestAnimationFrame',
      function (this: unknown, _callback: FrameRequestCallback) {
        receiver(this);
        return 1;
      },
    );
    vi.stubGlobal('cancelAnimationFrame', function (this: unknown, _frame: number) {
      receiver(this);
    });
    const scroll = new DragAutoScroll(
      () => [scrollTarget()],
      () => {},
    );
    expect(() => scroll.move({ x: 100, y: 199 })).not.toThrow();
    expect(() => scroll.stop()).not.toThrow();
  });
  it('scrolls only near an edge and stops outside the viewport', () => {
    expect(edgeVelocity(100, 200)).toBe(0);
    expect(edgeVelocity(199, 200)).toBeGreaterThan(0);
    expect(edgeVelocity(1, 200)).toBeLessThan(0);
    expect(edgeVelocity(-1, 200)).toBe(0);
    expect(edgeVelocity(201, 200)).toBe(0);
    const target = scrollTarget();
    const runtime = scroller([target]);
    runtime.scroll.move({ x: 100, y: 199 });
    runtime.frame(10);
    expect(target.scrollTop).toBeGreaterThan(0);
    runtime.scroll.move({ x: 100, y: 201 });
    runtime.frame(26);
    expect(runtime.frames.size).toBe(0);
  });
  it('normalizes plane scale and limits a stalled frame to 50 milliseconds', () => {
    const target = scrollTarget({ left: 100, top: 100, right: 500, bottom: 500 });
    const runtime = scroller([target]);
    runtime.scroll.move({ x: 300, y: 498 });
    runtime.frame(10);
    const before = target.scrollTop;
    runtime.frame(5000);
    expect(target.scrollTop - before).toBeGreaterThan(0);
    expect(target.scrollTop - before).toBeLessThanOrEqual(30);
    runtime.scroll.stop();
    expect(runtime.frames.size).toBe(0);
  });
  it('uses the inner vertical viewport and outer horizontal viewport independently', () => {
    const inner = scrollTarget();
    const outer = scrollTarget({ scrollWidth: 1000, scrollHeight: 200 });
    const runtime = scroller([inner, outer]);
    runtime.scroll.move({ x: 199, y: 199 });
    runtime.frame(10);
    expect(inner.scrollTop).toBeGreaterThan(0);
    expect(inner.scrollLeft).toBe(0);
    expect(outer.scrollLeft).toBeGreaterThan(0);
    expect(outer.scrollTop).toBe(0);
    expect(runtime.changed).toHaveBeenCalledTimes(1);
    runtime.scroll.stop();
  });
  it('does not keep scheduling frames after reaching the last row', () => {
    const target = scrollTarget({ scrollTop: 795 });
    const runtime = scroller([target]);
    runtime.scroll.move({ x: 100, y: 200 });
    runtime.frame(10);
    expect(target.scrollTop).toBe(800);
    runtime.frame(26);
    expect(runtime.frames.size).toBe(0);
  });
});
