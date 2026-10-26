// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WordBlock } from '../src/renderer/previews/WordBlock';
import { DataTable } from '../src/renderer/previews/DataTable';
import type { Resource } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) =>
    Array.from({ length: endIndex - startIndex + 1 }, (_, index) => startIndex + index),
  useVirtualizer: ({
    count,
    horizontal,
    estimateSize,
    paddingStart = 0,
  }: {
    count: number;
    horizontal?: boolean;
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
        start: paddingStart + index * (horizontal ? estimateSize() : 32),
        size: horizontal ? estimateSize() : 32,
      })),
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows formatted values while keeping the stored formula and source coordinate inspectable', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const rows = [
    {
      row: 104,
      cells: [
        {
          column: 4,
          value: '1234.5',
          formatted: '$1,234.50',
          numberFormat: '$#,##0.00',
          formula: 'SUM(D2)',
          cached: true,
        },
      ],
    },
  ];
  const merges = [
    {
      fromRow: 3,
      toRow: 104,
      fromColumn: 1,
      toColumn: 3,
      anchor: { column: 1, value: 'Source range' },
    },
  ];
  const view = render(
    <DataTable
      rows={rows}
      merges={merges}
      headers={['A', 'B', 'C', 'D']}
      label="Report"
      numbered
      formatted
    />,
  );
  const merge = screen.getByRole('button', { name: 'A3: Source range · Merged A3:C104' });
  expect(merge.textContent).toContain('Continued from A3');
  expect(merge.parentElement?.getAttribute('aria-colspan')).toBe('3');
  fireEvent.click(merge);
  expect(document.querySelector('.workbook-cell-detail')?.textContent).toContain('A3Source range');
  fireEvent.click(screen.getByRole('button', { name: 'D104: $1,234.50' }));
  expect(document.querySelector('.workbook-cell-detail')?.textContent).toContain(
    'Saved value: 1234.5 · Formula: SUM(D2)',
  );
  view.rerender(
    <DataTable
      rows={rows}
      merges={merges}
      headers={['A', 'B', 'C', 'D']}
      label="Report"
      numbered
    />,
  );
  expect(screen.getByRole('button', { name: 'D104: 1234.5' })).toBeTruthy();
});
it('cancels offscreen image reads, releases late bytes and recovers when the document becomes active', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  let finish!: (resource: Resource) => void;
  const services = {
    officeImage: vi.fn(
      () =>
        new Promise<Resource>((resolve) => {
          finish = resolve;
        }),
    ),
    cancelDocument: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const context = { active: true, resource: { id: 'doc' }, services } as unknown as PreviewContext;
  const block = {
    kind: 'paragraph' as const,
    text: 'BeforeAfter',
    inlines: [
      { kind: 'text' as const, text: 'Before' },
      { kind: 'image' as const, alt: 'Study', part: 'word/media/study.png' },
      { kind: 'text' as const, text: 'After' },
    ],
  };
  const view = render(<WordBlock block={block} context={context} />);
  await waitFor(() => expect(services.officeImage).toHaveBeenCalledTimes(1));
  const first = services.officeImage.mock.calls[0] as unknown[];
  view.rerender(<WordBlock block={block} context={{ ...context, active: false }} />);
  expect(services.cancelDocument).toHaveBeenCalledWith('doc', first[2]);
  await act(async () => {
    finish({ id: 'late', url: 'viewer-resource://late/asset/image.png' } as Resource);
  });
  expect(services.release).toHaveBeenCalledWith('late');
  expect(document.querySelector('img')).toBeNull();
  view.rerender(<WordBlock block={block} context={context} />);
  await waitFor(() => expect(services.officeImage).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish({ id: 'live', url: 'viewer-resource://live/asset/image.png' } as Resource);
  });
  expect(screen.getByAltText('Study').getAttribute('src')).toContain('viewer-resource://live/');
  expect(document.querySelector('p')?.textContent).toBe('BeforeAfter');
  view.unmount();
  expect(services.release).toHaveBeenCalledWith('live');
});
