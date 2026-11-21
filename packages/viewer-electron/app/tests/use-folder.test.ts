// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import { refreshFolder, reloadFolder, useFolder } from '../src/renderer/explorer/useFolder';

const entry = (name: string): FileEntry => ({
  path: `/fixtures/folder/${name}`,
  name,
  parent: '/fixtures/folder',
  extension: '',
  mime: 'text/plain',
  size: 1,
  kind: 'file',
  directory: false,
  identity: `1:${name}`,
  modified: 0,
  created: 0,
  hidden: false,
});
const failure = (message: string, code: string) => Object.assign(new Error(message), { code });
let folder = 0;
const viewer = {
  list: vi.fn(),
  watch: vi.fn(async () => {}),
  unwatch: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ identity: '1:folder' })),
  onEvent: vi.fn(() => () => {}),
};
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(viewer)) mock.mockClear();
  viewer.list.mockReset();
  viewer.watch.mockImplementation(async () => {});
  Object.assign(window, { viewer });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
};

describe('a folder listing', () => {
  it('waits for an older listing and reloads before selecting a newly pasted picture', async () => {
    const path = `/fixtures/folder-${++folder}`;
    const picture = entry('Pasted image.png');
    let finishOldListing: () => void = () => {};
    viewer.list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOldListing = () => resolve({ entries: [] });
          }),
      )
      .mockResolvedValueOnce({ entries: [picture] });
    const view = renderHook(() => useFolder(path));
    await act(async () => {
      const current = reloadFolder(path);
      finishOldListing();
      expect(await current).toEqual([picture]);
    });
    expect(view.result.current.entries).toEqual([picture]);
    expect(viewer.list).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  it('refreshes the requested child listing without refreshing its mounted ancestor', async () => {
    const parent = `/fixtures/folder-${++folder}`,
      child = parent + '/child';
    viewer.list.mockResolvedValue({ entries: [entry('a')] });
    const root = renderHook(() => useFolder(parent));
    const nested = renderHook(() => useFolder(child));
    await settle();
    viewer.list.mockClear();
    act(() => refreshFolder(child));
    await settle();
    expect(viewer.list.mock.calls.map(([path]) => path)).toEqual([child]);
    root.unmount();
    nested.unmount();
  });
  it('keeps what it showed when a reload fails, and empties only when the folder is gone', async () => {
    // A reload that failed replaced the listing with nothing: a transient error (a network volume's
    // timeout) emptied the view until the next change in the folder.
    const path = `/fixtures/folder-${++folder}`;
    viewer.list
      .mockResolvedValueOnce({ entries: [entry('a'), entry('b')] })
      .mockRejectedValueOnce(failure('Input/output error', 'EIO'))
      .mockRejectedValueOnce(failure('No such folder', 'ENOENT'));
    const { result } = renderHook(() => useFolder(path));
    await settle();
    expect(result.current.entries.map((item) => item.name)).toEqual(['a', 'b']);

    act(() => result.current.refresh());
    await settle();
    expect(result.current.entries.map((item) => item.name)).toEqual(['a', 'b']);
    expect(result.current.error).toBe('Input/output error');
    expect(result.current.unavailable).toBe(false);

    act(() => result.current.refresh());
    await settle();
    expect(result.current.entries).toEqual([]);
    expect(result.current.errorCode).toBe('ENOENT');
    expect(result.current.unavailable).toBe(true);
  });

  it('stays available when only its watch fails', async () => {
    // The watch's error took the place of the whole folder: an unreadable folder over a listing that
    // had loaded. It says what the failure means, not the system's words for it.
    const path = `/fixtures/folder-${++folder}`;
    viewer.list.mockResolvedValueOnce({ entries: [entry('a')] });
    viewer.watch.mockImplementation(async () => {
      throw failure('Too many open files', 'EMFILE');
    });
    const { result } = renderHook(() => useFolder(path));
    await settle();
    expect(result.current.entries.map((item) => item.name)).toEqual(['a']);
    expect(result.current.error).toBe(
      "This folder won't update by itself: Viewer can't watch it for changes.",
    );
    expect(result.current.unavailable).toBe(false);
  });

  it('clears rows when window focus detects a folder became unavailable or changed identity', async () => {
    const path = `/fixtures/folder-${++folder}`;
    viewer.list.mockResolvedValueOnce({ entries: [entry('a'), entry('b')] });
    viewer.stat.mockResolvedValue({ identity: '1:folder' });
    const view = renderHook(() => useFolder(path));
    await settle();
    expect(view.result.current.entries.map((item) => item.name)).toEqual(['a', 'b']);

    // Unchanged identity on focus does not re-list.
    viewer.list.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(viewer.list).not.toHaveBeenCalled();

    // Replaced folder identity on focus reloads the new listing.
    viewer.stat.mockResolvedValueOnce({ identity: '1:replaced' });
    viewer.list.mockResolvedValueOnce({ entries: [entry('c')] });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(view.result.current.entries.map((item) => item.name)).toEqual(['c']);

    // Missing or ejected folder on focus clears rows and marks it unavailable.
    viewer.stat.mockRejectedValueOnce(failure('No such folder', 'ENOENT'));
    viewer.list.mockRejectedValueOnce(failure('No such folder', 'ENOENT'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(view.result.current.entries).toEqual([]);
    expect(view.result.current.unavailable).toBe(true);
    expect(view.result.current.errorCode).toBe('ENOENT');
    view.unmount();
  });
});
