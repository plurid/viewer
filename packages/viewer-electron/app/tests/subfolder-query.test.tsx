// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { parseFileQuery, QueryError } from '../src/domain/search/query';
import { useSearch } from '../src/renderer/explorer/useSearch';

const viewer = {
  indexedQuery: vi.fn(),
  search: vi.fn(),
  cancelSearch: vi.fn(async () => {}),
  onEvent: vi.fn(() => () => {}),
};

beforeEach(() => {
  vi.useFakeTimers();
  viewer.indexedQuery.mockReset();
  viewer.search.mockReset();
  viewer.cancelSearch.mockClear();
  viewer.onEvent.mockClear();
  viewer.indexedQuery.mockImplementation(async (request: { query: string; root: string }) => {
    try {
      parseFileQuery(request.query.trim());
    } catch (error) {
      throw error instanceof QueryError ? new Error(error.message) : error;
    }
    return {
      entries: [],
      more: false,
      indexed: true,
      scanLimited: false,
      status: {
        running: false,
        roots: [{ path: request.root, status: 'ready', count: 10, errors: 0 }],
      },
    };
  });
  viewer.search.mockImplementation(async (request: { query: string }) => {
    try {
      parseFileQuery(request.query.trim());
    } catch (error) {
      throw error instanceof QueryError ? new Error(error.message) : error;
    }
  });
  Object.assign(window, { viewer });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('incomplete query with Subfolders on triggers live fallback and fake unreadable count', () => {
  it('valid query stays on indexed search without fallback scan', async () => {
    const view = renderHook(() => useSearch('/Projects/acme', 'report', true, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(viewer.indexedQuery).toHaveBeenCalledTimes(1);
    expect(viewer.search).not.toHaveBeenCalled();
    expect(view.result.current.streamed).toBeUndefined();
    view.unmount();
  });

  it('does not trigger live fallback scan or 1-item-not-readable coverage for incomplete query size>', async () => {
    const view = renderHook(() => useSearch('/Projects/acme', 'size>', true, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(viewer.search).not.toHaveBeenCalled();
    expect(view.result.current.streamed).toBeUndefined();
    view.unmount();
  });
});
