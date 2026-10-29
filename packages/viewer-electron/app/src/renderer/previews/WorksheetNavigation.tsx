import { useState } from 'react';
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
  const at = page.sheet + ':' + page.fromRow;
  const [draft, setDraft] = useState({ at, row: String(page.fromRow), error: '' });
  // A new page brings its own row in the same render. Reset in an effect, it landed after a row
  // the person had already typed, and replaced it.
  if (draft.at !== at) setDraft({ at, row: String(page.fromRow), error: '' });
  const { row, error } = draft.at === at ? draft : { row: String(page.fromRow), error: '' };
  const setRow = (value: string) => setDraft((current) => ({ ...current, row: value }));
  const setError = (value: string) => setDraft((current) => ({ ...current, error: value }));
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
