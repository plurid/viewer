// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DelimitedTable } from '../src/renderer/previews/DataTable';
import type { DelimitedPreview } from '../src/renderer/previews/table-data';

const create = vi.hoisted(() => vi.fn());
vi.mock('../src/renderer/previews/table-session', () => ({ createTableSession: create }));
vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex() {},
    measure() {},
  }),
}));
const pending: {
  resolve(value: DelimitedPreview): void;
  reject(error: Error): void;
  close: ReturnType<typeof vi.fn>;
}[] = [];
beforeEach(() => {
  pending.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  create.mockReset().mockImplementation(() => {
    const close = vi.fn();
    return {
      load: () =>
        new Promise<DelimitedPreview>((resolve, reject) =>
          pending.push({ resolve, reject, close }),
        ),
      filter: vi.fn(),
      close,
    };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const table = (value: string): DelimitedPreview => ({
  headers: ['Name'],
  rows: [[value]],
  malformed: false,
  truncated: false,
});

it('closes old workers and ignores late parsing results after changing files', async () => {
  const view = render(createElement(DelimitedTable, { text: 'first', delimiter: ',' }));
  view.rerender(createElement(DelimitedTable, { text: 'second', delimiter: ',' }));
  expect(pending[0]!.close).toHaveBeenCalledOnce();
  await act(async () => pending[0]!.resolve(table('old')));
  expect(view.getByRole('status').textContent).toContain('Reading table');
  await act(async () => pending[1]!.resolve(table('current')));
  expect(view.container.textContent).toContain('1 rows');
  view.unmount();
  expect(pending[1]!.close).toHaveBeenCalledOnce();
});

it('does not reuse a closed table reader when content changes from A to B back to A', async () => {
  const view = render(createElement(DelimitedTable, { text: 'A', delimiter: ',' }));
  await act(async () => pending[0]!.resolve(table('A')));
  view.rerender(createElement(DelimitedTable, { text: 'B', delimiter: ',' }));
  view.rerender(createElement(DelimitedTable, { text: 'A', delimiter: ',' }));
  expect(view.getByRole('status').textContent).toContain('Reading table');
  await act(async () => {
    pending[1]!.resolve(table('B'));
    pending[2]!.resolve(table('A'));
  });
  expect(view.container.textContent).toContain('1 rows');
  expect(pending[0]!.close).toHaveBeenCalledOnce();
  expect(pending[1]!.close).toHaveBeenCalledOnce();
});

it('retains an explicit recovery action after a worker failure', async () => {
  const view = render(createElement(DelimitedTable, { text: 'A', delimiter: ',' }));
  await act(async () =>
    pending[0]!.reject(new Error('Table processing stopped. Retry the preview.')),
  );
  expect(view.container.textContent).toContain('Table unavailable');
  fireEvent.click(view.getByRole('button', { name: 'Retry table' }));
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1]!.resolve(table('recovered')));
  expect(view.container.textContent).toContain('1 rows');
});
