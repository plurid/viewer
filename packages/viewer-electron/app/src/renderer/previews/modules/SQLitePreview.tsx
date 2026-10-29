import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkbookRow } from '../../../domain/previews/documents/office';
import type {
  SQLiteObject,
  SQLiteObjectKind,
  SQLiteRequest,
  SQLiteRowCount,
  SQLiteRows,
  SQLiteTables,
  SQLiteUncounted,
  SQLiteUnreadable,
} from '../../../domain/previews/data/sqlite';
import { sqliteCellText, sqliteLimits } from '../../../domain/previews/data/sqlite';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { DataTable } from '../DataTable';
import type { TableControls } from '../DataTable';
import { usePreviewState } from '../state';
import { useSQLite } from '../useSQLite';
import { Empty, Loading } from '../../ui/primitives';
import { report } from '../../state/store';
import './sqlite.css';

// A `.db` file need not be SQLite: one that is not keeps the ordinary file preview.
const FilePreview = lazy(() => import('./TextPreview'));

type SQLiteView = 'rows' | 'schema';

const tablesRequest: SQLiteRequest = { kind: 'tables' };
const kindLabels: Record<SQLiteObjectKind, string> = {
  table: 'Table',
  virtual: 'Virtual table',
  view: 'View',
};
const uncountedLabels: Record<SQLiteUncounted, string> = {
  view: 'View',
  time: 'Not counted',
  unreadable: 'Unreadable',
};
const schemaHeaders = ['Column', 'Type', 'Not null', 'Primary key', 'Default', 'Generated'];
const viewNotRun = [
  'A view runs a query stored in the database.',
  'Viewer shows its columns and definition instead.',
].join(' ');

export default function SQLitePreview(context: PreviewContext) {
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const listing = useSQLite(context, tablesRequest, attempt);
  const reply = listing.reply;
  if (listing.error)
    return (
      <Unavailable
        context={context}
        title="Database could not be read"
        detail={listing.error}
        retry={reload}
      />
    );
  if (listing.loading || !reply) return <Loading label="Reading database…" />;
  if (reply.kind === 'unreadable') {
    if (reply.reason === 'not-sqlite' && context.resource.entry.extension === 'db')
      return (
        <Suspense fallback={<Loading />}>
          <FilePreview {...context} editing={undefined} />
        </Suspense>
      );
    return (
      <Unavailable
        context={context}
        title={unreadableTitle(reply)}
        detail={reply.message}
        retry={reload}
      />
    );
  }
  if (reply.kind !== 'tables')
    return (
      <Unavailable
        context={context}
        title="Database could not be read"
        detail="The database reader returned rows instead of the table list."
        retry={reload}
      />
    );
  return <SQLiteDatabase context={context} database={reply} reload={reload} />;
}

function unreadableTitle(reply: SQLiteUnreadable): string {
  switch (reply.reason) {
    case 'not-sqlite':
      return 'Not a readable SQLite database';
    case 'too-large':
      return 'Database too large to preview';
    case 'damaged':
      return 'Database could not be read';
  }
}

function Unavailable({
  context,
  title,
  detail,
  retry,
}: {
  context: PreviewContext;
  title: string;
  detail: string;
  retry(): void;
}) {
  return (
    <Empty icon="data" title={title} detail={detail}>
      <button onClick={retry}>Try again</button>
      <button
        onClick={() => {
          void window.viewer.openExternal(context.resource.entry.path).catch(report);
        }}
      >
        Open in Default App
      </button>
    </Empty>
  );
}

function readable(object: SQLiteObject): boolean {
  return object.kind !== 'view' && !object.problem;
}

function SQLiteDatabase({
  context,
  database,
  reload,
}: {
  context: PreviewContext;
  database: SQLiteTables;
  reload(): void;
}) {
  const [chosen, setChosen] = usePreviewState(context, 'sqlite.table', '');
  const [savedView, setView] = usePreviewState<SQLiteView>(context, 'sqlite.view', 'rows');
  const [savedOffset, setOffset] = usePreviewState(context, 'sqlite.offset', 0);
  const objects = database.objects;
  const remembered = objects.find((object) => object.name === chosen);
  const selected = remembered ?? objects.find(readable) ?? objects[0];
  const view: SQLiteView = savedView === 'schema' ? 'schema' : 'rows';
  // A remembered page belongs to the remembered table only.
  const offset =
    remembered &&
    Number.isSafeInteger(savedOffset) &&
    savedOffset >= 0 &&
    savedOffset <= sqliteLimits.offset
      ? savedOffset
      : 0;
  const choose = useCallback(
    (name: string) => {
      setChosen(name);
      setOffset(0);
    },
    [setChosen, setOffset],
  );
  // Paging the table shown by default remembers it too, so the page applies to it.
  const turnPage = useCallback(
    (next: number) => {
      if (selected) setChosen(selected.name);
      setOffset(next);
    },
    [selected, setChosen, setOffset],
  );
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'sqlite-preview-view',
          label: view === 'schema' ? 'Show table rows' : 'Show table schema',
          aliases: ['database', 'sqlite', 'columns'],
          available: Boolean(selected),
          run: () => setView(view === 'schema' ? 'rows' : 'schema'),
        },
      ],
      [view, selected, setView],
    ),
  );
  return (
    <div className="sqlite-viewer">
      <PreviewToolbar context={context}>
        <button aria-pressed={view === 'rows'} onClick={() => setView('rows')}>
          Rows
        </button>
        <button aria-pressed={view === 'schema'} onClick={() => setView('schema')}>
          Schema
        </button>
        <span className="toolbar-spacer" />
        <span className="muted">{objectsLabel(database)}</span>
      </PreviewToolbar>
      {database.wal && (
        <p className="inline-warning">
          This database uses a write-ahead log. Recent changes still in its log file may not be
          shown.
        </p>
      )}
      {database.limited && (
        <p className="inline-warning">
          Showing the first {sqliteLimits.objects.toLocaleString()} tables and views.
        </p>
      )}
      {selected ? (
        <div className="sqlite-layout">
          <ObjectList objects={objects} selected={selected.name} choose={choose} />
          <section className="sqlite-content" aria-label={selected.name}>
            {view === 'schema' ? (
              <SchemaView key={selected.name} context={context} object={selected} />
            ) : readable(selected) ? (
              <RowsView
                key={selected.name}
                context={context}
                object={selected}
                offset={offset}
                setOffset={turnPage}
                version={database.version}
                reload={reload}
              />
            ) : (
              <Empty
                icon="data"
                title={selected.kind === 'view' ? 'Views are not run' : 'Rows unavailable'}
                detail={selected.problem ?? viewNotRun}
              >
                <button onClick={() => setView('schema')}>Show Schema</button>
              </Empty>
            )}
          </section>
        </div>
      ) : (
        <Empty icon="data" title="No tables" detail="This database has no tables or views." />
      )}
    </div>
  );
}

function objectsLabel(database: SQLiteTables): string {
  const tables = database.objects.filter((object) => object.kind !== 'view').length;
  const views = database.objects.length - tables;
  const parts = [plural(tables, 'table', 'tables')];
  if (views) parts.push(plural(views, 'view', 'views'));
  return parts.join(' · ');
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function countLabel(count: SQLiteRowCount): string {
  switch (count.kind) {
    case 'exact':
      return plural(count.rows, 'row', 'rows');
    case 'at-least':
      return count.estimate
        ? `about ${plural(count.estimate, 'row', 'rows')}`
        : `${count.rows.toLocaleString()}+ rows`;
    case 'not-counted':
      return uncountedLabels[count.reason];
  }
}

function objectTitle(object: SQLiteObject): string {
  const lines = [object.name, kindLabels[object.kind]];
  if (object.problem) lines.push(object.problem);
  return lines.join('\n');
}

function ObjectList({
  objects,
  selected,
  choose,
}: {
  objects: readonly SQLiteObject[];
  selected: string;
  choose(name: string): void;
}) {
  return (
    <nav className="sqlite-objects" aria-label="Tables and views">
      {objects.map((object) => (
        <button
          key={object.name}
          className="sqlite-object"
          aria-current={object.name === selected ? 'true' : undefined}
          title={objectTitle(object)}
          onClick={() => choose(object.name)}
        >
          <span>{object.name}</span>
          <span className="muted tabular">{countLabel(object.count)}</span>
        </button>
      ))}
    </nav>
  );
}

function rowControls(controls: TableControls): ReactNode {
  return (
    <div className="preview-toolbar">
      <input
        type="search"
        aria-label="Filter rows on this page"
        placeholder="Filter this page"
        value={controls.query}
        onChange={(event) => controls.setQuery(event.target.value)}
      />
      <span className="toolbar-spacer" />
      <span className="muted tabular">
        {plural(controls.rows, 'row', 'rows')} · {plural(controls.columns, 'column', 'columns')}
      </span>
    </div>
  );
}

function schemaControls(controls: TableControls): ReactNode {
  return (
    <div className="preview-toolbar">
      <input
        type="search"
        aria-label="Filter columns"
        placeholder="Filter columns"
        value={controls.query}
        onChange={(event) => controls.setQuery(event.target.value)}
      />
      <span className="toolbar-spacer" />
      <span className="muted tabular">{plural(controls.rows, 'column', 'columns')}</span>
    </div>
  );
}

/** Rows are numbered from 2, below the header row, as delimited tables number theirs. */
function tableRows(page: SQLiteRows): WorkbookRow[] {
  return page.rows.map((cells, index) => ({
    row: page.offset + index + 2,
    cells: cells.map((cell, column) => ({ column: column + 1, value: sqliteCellText(cell) })),
  }));
}

function rangeLabel(page: SQLiteRows, count: SQLiteRowCount): string {
  if (!page.rows.length)
    return page.offset ? `No rows after row ${page.offset.toLocaleString()}` : 'No rows';
  const first = (page.offset + 1).toLocaleString();
  const last = (page.offset + page.rows.length).toLocaleString();
  return `Rows ${first}–${last}${totalLabel(count)}`;
}

function totalLabel(count: SQLiteRowCount): string {
  switch (count.kind) {
    case 'exact':
      return ` of ${count.rows.toLocaleString()}`;
    case 'at-least':
      return count.estimate
        ? ` of about ${count.estimate.toLocaleString()}`
        : ` of ${count.rows.toLocaleString()}+`;
    case 'not-counted':
      return '';
  }
}

function RowsView({
  context,
  object,
  offset,
  setOffset,
  version,
  reload,
}: {
  context: PreviewContext;
  object: SQLiteObject;
  offset: number;
  setOffset(offset: number): void;
  version: string;
  reload(): void;
}) {
  const [attempt, setAttempt] = useState(0);
  // Pages can end early to stay within their text budget, so Previous returns to where it was.
  const [history, setHistory] = useState<number[]>([]);
  const request = useMemo<SQLiteRequest>(
    () => ({ kind: 'rows', table: object.name, offset, limit: sqliteLimits.pageRows }),
    [object.name, offset],
  );
  const load = useSQLite(context, request, attempt);
  const page = load.reply?.kind === 'rows' ? load.reply : undefined;
  const rows = useMemo(() => (page ? tableRows(page) : []), [page]);
  const retry = () => setAttempt((value) => value + 1);
  if (load.error)
    return (
      <Empty icon="data" title="Rows could not be read" detail={load.error}>
        <button onClick={retry}>Try again</button>
      </Empty>
    );
  if (load.loading || !load.reply) return <Loading label="Reading rows…" />;
  if (load.reply.kind === 'unreadable')
    return (
      <Empty icon="data" title={unreadableTitle(load.reply)} detail={load.reply.message}>
        <button onClick={reload}>Try again</button>
      </Empty>
    );
  if (!page)
    return (
      <Empty
        icon="data"
        title="Rows could not be read"
        detail="The database reader returned the table list instead of rows."
      >
        <button onClick={retry}>Try again</button>
      </Empty>
    );
  const next = page.offset + page.rows.length;
  const beyond = page.more && next > sqliteLimits.offset;
  return (
    <>
      {page.version !== version && (
        <p className="inline-warning">
          The database changed after its tables were listed.{' '}
          <button onClick={reload}>Reload</button>
        </p>
      )}
      {page.columnCount > page.columns.length && (
        <p className="inline-warning">
          Showing the first {page.columns.length.toLocaleString()} of{' '}
          {page.columnCount.toLocaleString()} columns.
        </p>
      )}
      <DataTable
        key={page.offset}
        state={context.state}
        label={object.name}
        rows={rows}
        headers={page.columns}
        paged
        renderControls={rowControls}
      />
      <nav className="worksheet-navigation" aria-label="Table rows">
        <button
          disabled={page.offset === 0}
          onClick={() => {
            setOffset(history.at(-1) ?? Math.max(0, page.offset - sqliteLimits.pageRows));
            setHistory((previous) => previous.slice(0, -1));
          }}
        >
          Previous
        </button>
        <span className="muted tabular" role="status">
          {rangeLabel(page, object.count)}
        </span>
        <button
          disabled={!page.more || beyond}
          onClick={() => {
            setHistory((previous) => [...previous, page.offset].slice(-128));
            setOffset(next);
          }}
        >
          Next
        </button>
        {beyond && (
          <span className="muted">
            Rows after {sqliteLimits.offset.toLocaleString()} are not previewed.
          </span>
        )}
      </nav>
    </>
  );
}

function schemaRows(object: SQLiteObject): WorkbookRow[] {
  return object.columns.map((column, index) => {
    const values = [
      column.name,
      column.type,
      column.notNull ? 'Yes' : '',
      column.primaryKey ? String(column.primaryKey) : '',
      column.defaultValue ?? '',
      column.generated === 'virtual' ? 'Virtual, not computed' : (column.generated ?? ''),
    ];
    return {
      row: index + 2,
      cells: values.map((value, position) => ({ column: position + 1, value })),
    };
  });
}

function SchemaView({ context, object }: { context: PreviewContext; object: SQLiteObject }) {
  const rows = useMemo(() => schemaRows(object), [object]);
  return (
    <>
      {object.problem && <p className="inline-warning">{object.problem}</p>}
      {object.columnCount > object.columns.length && (
        <p className="inline-warning">
          Showing the first {object.columns.length.toLocaleString()} of{' '}
          {object.columnCount.toLocaleString()} columns.
        </p>
      )}
      {rows.length ? (
        <DataTable
          state={context.state}
          label={`${object.name} schema`}
          rows={rows}
          headers={schemaHeaders}
          renderControls={schemaControls}
        />
      ) : (
        <p className="sqlite-note muted">No columns could be read.</p>
      )}
      {object.definition && (
        <details className="sqlite-definition">
          <summary>Definition</summary>
          <pre>{object.definition}</pre>
        </details>
      )}
    </>
  );
}
