// @vitest-environment jsdom
/**
 * A TABLE'S TOOLBAR (DESIGN.md, the Preview Bar Rule): a worksheet's, a delimited file's and a
 * database table's are the one toolbar every preview has. Their row and column counts are facts
 * the footer shows with the file's others, not words that crowd the toolbar until a width hides them.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';
import { DataTable } from '../src/renderer/previews/DataTable';
import type { DocumentData } from '../src/domain/services';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { PreviewFrameFixture } from './support/preview-frame';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const footer = () => screen.getByRole('contentinfo', { name: 'Footer facts' }).textContent;
const toolbars = () =>
  [...document.querySelectorAll('.preview-toolbar')].map((toolbar) => toolbar.textContent).join('');

it('shows a worksheet’s rows and columns as facts in the footer', async () => {
  const workbook: DocumentData = {
    path: '/Workbook.xlsx',
    metadata: {},
    evidence: [],
    text: 'Data',
    truncated: false,
    office: {
      kind: 'workbook',
      formulas: 0,
      missingCached: 0,
      sheets: [
        {
          name: 'Data',
          hidden: false,
          loaded: true,
          rows: [
            { row: 1, cells: [{ column: 1, value: 'First' }] },
            { row: 2, cells: [{ column: 1, value: 'Second' }] },
          ],
          columns: 1,
          truncated: false,
        },
      ],
      page: { sheet: 'Data', fromRow: 1, lastRow: 2, nextRow: 3, limited: false },
    },
  };
  const values = new Map<string, unknown>();
  const context = {
    resource: {
      id: 'book',
      entry: { name: 'Workbook.xlsx', path: '/Workbook.xlsx', extension: 'xlsx' },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: { get: (key: string) => values.get(key), set: values.set.bind(values) },
    services: {
      document: vi.fn(async () => workbook),
      cancelDocument: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
  } as unknown as PreviewContext;
  render(
    <PreviewFrameFixture>
      <OfficePreview {...context} />
    </PreviewFrameFixture>,
  );
  await screen.findByRole('searchbox', { name: 'Filter current worksheet page' });
  expect(footer()).toContain('2 rows · 1 column');
  expect(toolbars()).not.toContain('2 rows');
});

it('shows a delimited table’s rows and columns as facts in the footer', () => {
  render(
    <PreviewFrameFixture>
      <DataTable
        label="Delimited data"
        headers={['Name', 'Size']}
        rows={[
          { row: 2, cells: [{ column: 1, value: 'a' }] },
          { row: 3, cells: [{ column: 1, value: 'b' }] },
          { row: 4, cells: [{ column: 1, value: 'c' }] },
        ]}
      />
    </PreviewFrameFixture>,
  );
  expect(document.querySelectorAll('.preview-toolbar')).toHaveLength(1);
  expect(footer()).toContain('3 rows · 2 columns');
  expect(toolbars()).not.toContain('3 rows');
  expect(screen.getByRole('textbox', { name: 'Filter table rows' })).toBeTruthy();
});
