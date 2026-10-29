// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SQLitePreview from '../src/renderer/previews/modules/SQLitePreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type {
  SQLiteObject,
  SQLiteReply,
  SQLiteRequest,
  SQLiteRows,
  SQLiteTables,
} from '../src/domain/previews/data/sqlite';

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
vi.mock('../src/renderer/previews/modules/TextPreview', () => ({
  default: () => <p>Ordinary file preview</p>,
}));

beforeEach(() => {
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
});

const books: SQLiteObject = {
  name: 'books',
  kind: 'table',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: false, primaryKey: 1 },
    { name: 'title', type: 'TEXT', notNull: true, primaryKey: 0 },
    { name: 'cover', type: 'BLOB', notNull: false, primaryKey: 0 },
  ],
  columnCount: 3,
  count: { kind: 'exact', rows: 450 },
  definition: 'CREATE TABLE books(id INTEGER PRIMARY KEY, title TEXT NOT NULL, cover BLOB)',
};
const titles: SQLiteObject = {
  name: 'titles',
  kind: 'view',
  columns: [{ name: 'title', type: '', notNull: false, primaryKey: 0 }],
  columnCount: 1,
  count: { kind: 'not-counted', reason: 'view' },
  definition: 'CREATE VIEW titles AS SELECT title FROM books',
};
const database: SQLiteTables = {
  kind: 'tables',
  version: '1:1',
  objects: [books, titles],
  limited: false,
  wal: false,
};

function rowsFor(request: Extract<SQLiteRequest, { kind: 'rows' }>): SQLiteRows {
  return {
    kind: 'rows',
    version: '1:1',
    table: request.table,
    columns: ['id', 'title', 'cover'],
    columnCount: 3,
    offset: request.offset,
    rows: [
      [
        { kind: 'integer', text: String(request.offset + 1) },
        { kind: 'text', text: `Title ${request.offset + 1}` },
        { kind: 'blob', bytes: 4 },
      ],
      [
        { kind: 'integer', text: String(request.offset + 2) },
        { kind: 'null' },
        { kind: 'text', text: 'Long', bytes: 9000 },
      ],
    ],
    more: request.offset < 400,
  };
}

function preview(
  answer: (request: SQLiteRequest) => SQLiteReply,
  extension = 'sqlite',
  id = 'database',
): { context: PreviewContext; sqlite: ReturnType<typeof vi.fn> } {
  const values = new Map<string, unknown>();
  const sqlite = vi.fn(async (_id: string, request: SQLiteRequest) => answer(request));
  const context = {
    resource: {
      id,
      url: 'viewer-resource://database/asset/library.' + extension,
      entry: { path: '/fixtures/library.' + extension, extension, name: 'library.' + extension },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    services: { sqlite },
  } as unknown as PreviewContext;
  return { context, sqlite };
}

function answer(request: SQLiteRequest): SQLiteReply {
  return request.kind === 'tables' ? database : rowsFor(request);
}

it('lists tables with counts, pages the selected table and shows its schema', async () => {
  const { context, sqlite } = preview(answer);
  render(<SQLitePreview {...context} />);
  const list = await screen.findByRole('navigation', { name: 'Tables and views' });
  expect(list.textContent).toContain('books');
  expect(list.textContent).toContain('450 rows');
  expect(list.textContent).toContain('View');
  expect(await screen.findByText('Title 1')).toBeTruthy();
  expect(screen.getByText('<blob 4 bytes>')).toBeTruthy();
  expect(screen.getByText('NULL')).toBeTruthy();
  expect(screen.getByText('Long…')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Rows 1–2 of 450');
  expect(sqlite).toHaveBeenCalledWith('database', {
    kind: 'rows',
    table: 'books',
    offset: 0,
    limit: 200,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Title 3')).toBeTruthy();
  expect(sqlite).toHaveBeenLastCalledWith('database', {
    kind: 'rows',
    table: 'books',
    offset: 2,
    limit: 200,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect(await screen.findByText('Title 1')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Schema' }));
  expect(await screen.findByText('INTEGER')).toBeTruthy();
  expect(screen.getByText('BLOB')).toBeTruthy();
  expect(screen.getByText(books.definition)).toBeTruthy();
});

it('explains a view instead of running it', async () => {
  const { context, sqlite } = preview(answer);
  render(<SQLitePreview {...context} />);
  fireEvent.click(await screen.findByRole('button', { name: /^titles/ }));
  expect(await screen.findByText('Views are not run')).toBeTruthy();
  expect(sqlite).not.toHaveBeenCalledWith(
    'database',
    expect.objectContaining({ kind: 'rows', table: 'titles' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show Schema' }));
  expect(await screen.findByText(titles.definition)).toBeTruthy();
});

it('explains an encrypted or damaged database and tries again on request', async () => {
  let reply: SQLiteReply = {
    kind: 'unreadable',
    reason: 'not-sqlite',
    message: 'This file does not start with a SQLite header. It may be encrypted.',
  };
  const { context, sqlite } = preview(() => reply);
  render(<SQLitePreview {...context} />);
  expect(await screen.findByText('Not a readable SQLite database')).toBeTruthy();
  expect(screen.getByText(/may be encrypted/)).toBeTruthy();
  reply = { kind: 'unreadable', reason: 'damaged', message: 'The database is damaged.' };
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('The database is damaged.')).toBeTruthy();
  expect(sqlite).toHaveBeenCalledTimes(2);
});

it('keeps the ordinary file preview for a .db file that is not SQLite', async () => {
  const { context } = preview(
    () => ({ kind: 'unreadable', reason: 'not-sqlite', message: 'Not SQLite.' }),
    'db',
  );
  render(<SQLitePreview {...context} />);
  expect(await screen.findByText('Ordinary file preview')).toBeTruthy();
});

it('reports a reader failure readably', async () => {
  const { context } = preview(() => {
    throw new Error('This preview resource has expired.');
  });
  render(<SQLitePreview {...context} />);
  expect(await screen.findByText('Database could not be read')).toBeTruthy();
  expect(screen.getByText('This preview resource has expired.')).toBeTruthy();
});

it('drops a late answer for a file the preview has moved away from', async () => {
  let settle: (reply: SQLiteReply) => void = () => {};
  const first = preview(answer);
  first.sqlite.mockImplementation(() => new Promise<SQLiteReply>((resolve) => (settle = resolve)));
  const view = render(<SQLitePreview {...first.context} />);
  const second = preview(() => ({ ...database, objects: [titles] }), 'sqlite', 'second');
  view.rerender(<SQLitePreview {...second.context} />);
  expect(await screen.findByText('Views are not run')).toBeTruthy();
  await act(async () => settle(database));
  expect(screen.queryByText('books')).toBeNull();
  expect(screen.getByText('Views are not run')).toBeTruthy();
});
