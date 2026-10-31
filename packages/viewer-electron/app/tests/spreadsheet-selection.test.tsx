// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataTable } from '../src/renderer/previews/DataTable';
vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: ({
    count,
    estimateSize,
    paddingStart = 0,
  }: {
    count: number;
    estimateSize(): number;
    paddingStart?: number;
  }) => ({
    measure: () => {},
    scrollToIndex: () => {},
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: paddingStart + index * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

beforeEach(() => {
  Object.assign(window, { viewer: { clipboardWriteText: vi.fn(async () => {}) } });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const rows = [
  {
    row: 1,
    cells: [
      { column: 1, value: 'First' },
      { column: 2, value: 'Second' },
    ],
  },
  { row: 3, cells: [{ column: 1, value: 'Third' }] },
];
it('extends a range with Shift-click and Shift-arrows, copies TSV and clears with Escape', async () => {
  const writeText = vi.fn(async () => {});
  const bubbled = vi.fn();
  Object.assign(window.viewer, { clipboardWriteText: writeText });
  render(
    <div onKeyDown={bubbled}>
      <DataTable rows={rows} headers={['A', 'B']} label="Data" numbered />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'A1: First' }));
  fireEvent.click(screen.getByRole('button', { name: 'B3: Empty' }), { shiftKey: true });
  expect(screen.getByLabelText('Selected range').textContent).toBe('A1:B3');
  expect(screen.getAllByRole('gridcell', { selected: true })).toHaveLength(4);
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowLeft', shiftKey: true });
  expect(screen.getByLabelText('Selected range').textContent).toBe('A1:A3');
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'c', metaKey: true });
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('First\n\nThird'));
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'Escape' });
  expect(screen.getByLabelText('Selected range').textContent).toBe('A3');
  expect(bubbled).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'Escape' });
  expect(bubbled).toHaveBeenCalledOnce();
});
it('keeps range coordinates through a page transition and restoration', () => {
  const values = new Map<string, unknown>(),
    navigate = vi.fn();
  const state = {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  const view = render(
    <DataTable
      rows={rows}
      headers={['A', 'B']}
      label="Data"
      state={state}
      numbered
      navigate={navigate}
      sourceLastRow={20}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'A3: Third' }));
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown', shiftKey: true });
  expect(navigate).toHaveBeenCalledWith({ row: 4, column: 1 });
  view.unmount();
  render(
    <DataTable
      rows={[{ row: 4, cells: [] }]}
      headers={['A', 'B']}
      label="Data"
      state={state}
      numbered
    />,
  );
  expect(screen.getByLabelText('Selected range').textContent).toBe('A3:A4');
});
it('reports clipboard failures instead of claiming a successful copy', async () => {
  Object.assign(window.viewer, {
    clipboardWriteText: vi.fn(async () => {
      throw new Error('Clipboard denied');
    }),
  });
  render(<DataTable rows={rows} headers={['A', 'B']} label="Data" numbered />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await screen.findByText('Clipboard denied');
});
