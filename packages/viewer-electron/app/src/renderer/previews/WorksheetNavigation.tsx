import { useEffect, useState } from 'react';
import type { WorkbookSheet, WorksheetPage } from '../../domain/previews/documents/office';

export function WorksheetNavigation({
  page,
  sheet,
  loading,
  previous,
  navigate,
}: {
  page: WorksheetPage;
  sheet: WorkbookSheet;
  loading: boolean;
  previous: number;
  navigate(row: number, direction: 'previous' | 'next' | 'jump'): void;
}) {
  const [row, setRow] = useState(String(page.fromRow));
  const [error, setError] = useState('');
  useEffect(() => {
    setRow(String(page.fromRow));
    setError('');
  }, [page.sheet, page.fromRow]);
  return (
    <>
      <nav className="worksheet-navigation" aria-label="Worksheet rows">
        <button
          disabled={loading || page.fromRow <= 1}
          onClick={() => navigate(previous, 'previous')}
        >
          Previous
        </button>
        <span className="muted tabular" role="status">
          {loading
            ? 'Loading rows…'
            : sheet.rows.length
              ? `Rows ${sheet.rows[0]!.row.toLocaleString()}–${sheet.rows.at(-1)!.row.toLocaleString()}`
              : `No rows from ${page.fromRow.toLocaleString()}`}
        </span>
        <button
          disabled={loading || page.nextRow === undefined}
          onClick={() => navigate(page.nextRow!, 'next')}
        >
          Next
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const number = /^\d+$/.test(row) ? Number(row) : NaN;
            if (!Number.isSafeInteger(number) || number < 1 || number > 1048576) {
              setError('Enter a row from 1 to 1,048,576.');
              return;
            }
            setError('');
            navigate(number, 'jump');
          }}
        >
          <label>
            Row{' '}
            <input
              aria-label="Go to source row"
              inputMode="numeric"
              value={row}
              onChange={(event) => setRow(event.target.value)}
              aria-invalid={Boolean(error)}
              disabled={loading}
            />
          </label>
          <button type="submit" disabled={loading}>
            Go
          </button>
        </form>
      </nav>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
