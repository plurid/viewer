// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import { useFolder } from '../src/renderer/explorer/useFolder';

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
  vi.useRealTimers();
});
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
};

describe('a folder listing', () => {
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
    // The watch's error took the place of the whole folder: "Folder unavailable" over a listing that
    // had loaded.
    const path = `/fixtures/folder-${++folder}`;
    viewer.list.mockResolvedValueOnce({ entries: [entry('a')] });
    viewer.watch.mockImplementation(async () => {
      throw failure('Too many open files', 'EMFILE');
    });
    const { result } = renderHook(() => useFolder(path));
    await settle();
    expect(result.current.entries.map((item) => item.name)).toEqual(['a']);
    expect(result.current.error).toBe('Too many open files');
    expect(result.current.unavailable).toBe(false);
  });
});
