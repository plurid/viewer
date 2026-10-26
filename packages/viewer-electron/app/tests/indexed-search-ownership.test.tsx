// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useIndexedSearch } from '../src/renderer/explorer/useIndexedSearch';
import type { IndexedResult } from '../src/domain/services';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('never presents results or evidence from a previous query/root as the current search', async () => {
  vi.useFakeTimers();
  const pending: ((value: IndexedResult) => void)[] = [];
  Object.assign(window, {
    viewer: {
      onEvent: () => () => {},
      indexedQuery: vi.fn(() => new Promise<IndexedResult>((resolve) => pending.push(resolve))),
    },
  });
  const { result, rerender } = renderHook(
    ({ query, root }) => useIndexedSearch(query, root, true, false, 0, true),
    { initialProps: { query: 'first', root: '/one' } },
  );
  await act(async () => vi.advanceTimersByTime(151));
  const reply = {
    entries: [],
    evidence: [],
    indexed: true,
    more: false,
    status: { roots: [], running: false, count: 0 },
  } satisfies IndexedResult;
  await act(async () => pending[0]!(reply));
  expect(result.current.result).toBe(reply);
  rerender({ query: 'second', root: '/two' });
  expect(result.current.result).toBeUndefined();
  await act(async () => vi.advanceTimersByTime(151));
  await act(async () => pending[1]!({ ...reply, indexed: false }));
  expect(result.current.result?.indexed).toBe(false);
});
