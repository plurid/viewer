// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';
import type { DocumentData } from '../src/domain/services';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type {
  WorksheetDocumentRequest,
  WorkbookRow,
} from '../src/domain/previews/documents/office';

vi.mock('../src/renderer/ui/ChoiceMenu', () => ({
  ChoiceButton: ({
    label,
    value,
    choices,
    onChoose,
  }: {
    label: string;
    value: string;
    choices: { value: string; label: string }[];
    onChoose(value: string): void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChoose(event.target.value)}>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../src/renderer/previews/DataTable', () => ({
  DataTable: ({ rows, label }: { rows: WorkbookRow[]; label: string }) => (
    <div data-testid="page-cells">
      {label}:{rows.map((row) => row.row).join(',')}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const document = (sheet = 'Data', fromRow = 1): DocumentData => ({
  path: '/Workbook.xlsx',
  metadata: {},
  evidence: [],
  text: sheet,
  truncated: true,
  office: {
    kind: 'workbook',
    formulas: 0,
    missingCached: 0,
    sheets: ['Data', 'Other'].map((name) => ({
      name,
      hidden: false,
      loaded: name === sheet,
      rows: name === sheet ? [{ row: fromRow, cells: [{ column: 1, value: sheet }] }] : [],
      columns: 1,
      truncated: false,
    })),
    page: { sheet, fromRow, lastRow: 10000, nextRow: fromRow + 100, limited: false },
  },
});
const context = (read: (id: string, request?: WorksheetDocumentRequest) => Promise<DocumentData>) =>
  ({
    resource: {
      id: 'book',
      entry: { name: 'Workbook.xlsx', path: '/Workbook.xlsx', extension: 'xlsx' },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: {
      document: vi.fn(read),
      cancelDocument: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
  }) as unknown as PreviewContext;

it('pages, jumps with original row numbers, remembers each sheet and rejects invalid jumps', async () => {
  const current = context(async (_id, request) =>
    document(request?.sheet || 'Data', request?.fromRow),
  );
  render(<OfficePreview {...current} />);
  await screen.findByText('Data:1');
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  await screen.findByText('Data:101');
  fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'Other' } });
  await screen.findByText('Other:1');
  fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'Data' } });
  await screen.findByText('Data:101');
  const row = screen.getByLabelText('Go to source row');
  fireEvent.change(row, { target: { value: '0' } });
  fireEvent.submit(row.closest('form')!);
  expect(screen.getByRole('alert').textContent).toContain('1,048,576');
  fireEvent.change(row, { target: { value: '2500' } });
  fireEvent.submit(row.closest('form')!);
  await screen.findByText('Data:2500');
  expect(current.services.document).toHaveBeenLastCalledWith(
    'book',
    expect.objectContaining({ sheet: 'Data', fromRow: 2500, limit: 100 }),
  );
  expect(screen.queryByText('The reader limit was reached. Some content is not shown.')).toBeNull();
});

it('cancels superseded pages and prevents an older completion from replacing the selected sheet', async () => {
  const waiting: { request: WorksheetDocumentRequest; finish(value: DocumentData): void }[] = [];
  const current = context(async (_id, request) => {
    if (request?.fromRow === 1 && !request.sheet) return document();
    return new Promise((resolve) => waiting.push({ request: request!, finish: resolve }));
  });
  render(<OfficePreview {...current} />);
  await screen.findByText('Data:1');
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  expect(screen.queryByTestId('page-cells')).toBeNull();
  fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'Other' } });
  await waitFor(() => expect(waiting).toHaveLength(2));
  expect(current.services.cancelDocument).toHaveBeenCalledWith(
    'book',
    waiting[0].request.requestID,
  );
  await act(async () => {
    waiting[1].finish(document('Other'));
  });
  expect(screen.getByTestId('page-cells').textContent).toBe('Other:1');
  await act(async () => {
    waiting[0].finish(document('Data', 101));
  });
  expect(screen.getByTestId('page-cells').textContent).toBe('Other:1');
});

it('loads a cited cell row directly and keeps retry available after a page failure', async () => {
  let fails = true;
  const current = context(async (_id, request) => {
    if (fails) throw new Error('Reader temporarily unavailable');
    return document(request?.sheet, request?.fromRow);
  });
  current.evidence = {
    anchor: { kind: 'cells', sheet: 'Other', row: 2500, column: 1 },
  } as PreviewContext['evidence'];
  render(<OfficePreview {...current} />);
  await screen.findByText('Office preview unavailable');
  expect(current.services.document).toHaveBeenLastCalledWith(
    'book',
    expect.objectContaining({ sheet: 'Other', fromRow: 2500 }),
  );
  fails = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Other:2500');
  expect(screen.getByLabelText('Go to source row')).toBeTruthy();
});
