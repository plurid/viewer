import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  moveTableCell,
  parseCellAddress,
  resolveTableCell,
} from '../../domain/previews/documents/table-navigation';
import type {
  TableAddress,
  TableCellSelection,
} from '../../domain/previews/documents/table-navigation';
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
import type { EvidenceAnchor } from '../../domain/files/inspection';
import type {
  WorkbookCell,
  WorkbookRow,
  WorkbookMerge,
} from '../../domain/previews/documents/office';
import { columnName } from '../../domain/previews/documents/office';
import { createTableSession } from './table-session';
import { delimitedRows, type DelimitedPreview } from './table-data';
import { Empty, Loading } from '../ui/primitives';
import type { PreviewContext } from './contracts';
import { usePreviewScroll } from './scroll';
import { usePreviewState } from './state';
type CellAnchor = Extract<EvidenceAnchor, { kind: 'cells' }>;
const noMerges: readonly WorkbookMerge[] = [];

export interface TableControls {
  query: string;
  setQuery(value: string): void;
  rows: number;
  columns: number;
  filtering: boolean;
}
interface TableView {
  query?: string;
  row?: number;
  column?: number;
}
/** Keep addresses and filters, never duplicate cell values into workspace state. */
export function rememberTableView(
  views: Record<string, TableView>,
  label: string,
  change: TableView,
): Record<string, TableView> {
  const next = Object.fromEntries([
    ...Object.entries(views && typeof views === 'object' ? views : {})
      .filter(([key]) => key !== label)
      .slice(-15),
    [label, { ...views?.[label], ...change }],
  ]);
  while (Object.keys(next).length > 1 && JSON.stringify(next).length * 2 > 3000)
    delete next[Object.keys(next)[0]!];
  return next;
}

/** CSV and worksheets share virtual rows while retaining original source addresses. */
export function DataTable({
  rows,
  headers,
  label,
  anchor,
  numbered = false,
  paged = false,
  sourceLastRow,
  formatted = false,
  merges = noMerges,
  filterRows,
  retryFilter,
  state,
  renderControls,
  target,
  navigate,
}: {
  rows: readonly WorkbookRow[];
  headers: readonly string[];
  label: string;
  anchor?: CellAnchor;
  numbered?: boolean;
  paged?: boolean;
  sourceLastRow?: number;
  formatted?: boolean;
  merges?: readonly WorkbookMerge[];
  filterRows?: (query: string, signal: AbortSignal) => Promise<Uint32Array>;
  retryFilter?: () => void;
  state?: PreviewContext['state'];
  renderControls?(controls: TableControls): ReactNode;
  target?: TableAddress;
  navigate?(target: TableAddress): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState('');
  const selectedTarget = useRef<TableAddress | undefined>(undefined);
  const [views, setViews] = usePreviewState<Record<string, TableView>>(
    { state },
    'table.views',
    {},
  );
  const remembered = views?.[label];
  const query = typeof remembered?.query === 'string' ? remembered.query : '';
  const setQuery = useCallback(
    (query: string) =>
      setViews((previous) => rememberTableView(previous, label, { query: query.slice(0, 160) })),
    [setViews, label],
  );

  const [viewportWidth, setViewportWidth] = useState(840);
  const [selection, setSelection] = useState<TableCellSelection>();
  const focusedRow = selection?.row ?? target?.row ?? remembered?.row ?? anchor?.row;
  const focusedColumn =
    selection?.cell.column ?? target?.column ?? remembered?.column ?? anchor?.column ?? 1;
  const [filtered, setFiltered] = useState<{
    rows: readonly WorkbookRow[];
    query: string;
    indices?: Uint32Array;
    error?: string;
  }>();
  useEffect(() => {
    if (!filterRows || !query) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void filterRows(query, abort.signal).then(
        (indices) => {
          if (!abort.signal.aborted) setFiltered({ rows, query, indices });
        },
        (error) => {
          if (!abort.signal.aborted) setFiltered({ rows, query, error: (error as Error).message });
        },
      );
    }, 0);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [rows, query, filterRows]);
  const filtering =
    !!filterRows && !!query && (filtered?.rows !== rows || filtered.query !== query);
  const body = useMemo(() => {
    if (!query) {
      if (
        numbered &&
        focusedRow &&
        !rows.some((row) => row.row === focusedRow) &&
        (target || (focusedRow >= (rows[0]?.row ?? 1) && focusedRow <= (rows.at(-1)?.row ?? 0)))
      )
        return [...rows, { row: focusedRow, cells: [] }].sort((a, b) => a.row - b.row);
      return rows;
    }
    if (filterRows)
      return filtered?.rows === rows && filtered.indices
        ? Array.from(filtered.indices, (index) => rows[index]!).filter(Boolean)
        : rows;
    const term = query.toLocaleLowerCase();
    return rows.filter(
      (row) =>
        !term ||
        row.cells.some((cell) =>
          (cell.value + ' ' + (cell.formatted ?? '')).toLocaleLowerCase().includes(term),
        ),
    );
  }, [rows, query, filterRows, filtered, numbered, focusedRow, target]);
  const merged = useMemo(
    () =>
      merges.flatMap((merge) => {
        const first = body.findIndex((row) => row.row >= merge.fromRow && row.row <= merge.toRow);
        if (first < 0) return [];
        let last = first;
        while (last + 1 < body.length && body[last + 1]!.row <= merge.toRow) last++;
        return [{ merge, first, last }];
      }),
    [merges, body],
  );
  const columns = headers.length;
  const columnWidth = Math.max(140, (viewportWidth - (numbered ? 48 : 0)) / Math.max(1, columns));
  const horizontal = useVirtualizer({
    horizontal: true,
    count: columns,
    getScrollElement: () => ref.current,
    estimateSize: () => columnWidth,
    paddingStart: numbered ? 48 : 0,
    overscan: 2,
    initialRect: { width: 840, height: 400 },
    rangeExtractor: (range) => {
      const included = new Set(defaultRangeExtractor(range));
      if (numbered) included.add(focusedColumn - 1);
      for (const { merge } of merged)
        if (merge.fromColumn - 1 <= range.endIndex && merge.toColumn - 1 >= range.startIndex)
          included.add(merge.fromColumn - 1);
      return [...included].filter((index) => index < columns).sort((a, b) => a - b);
    },
  });
  const virtual = useVirtualizer({
    count: body.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 32,
    overscan: 8,
    rangeExtractor: (range) => {
      const included = new Set(defaultRangeExtractor(range));
      const focused = body.findIndex((row) => row.row === focusedRow);
      if (numbered && focused >= 0) included.add(focused);
      for (const view of merged)
        if (view.first <= range.endIndex && view.last >= range.startIndex) included.add(view.first);
      return [...included].sort((a, b) => a - b);
    },
  });
  usePreviewScroll(state, ref, 'table', {
    section: `${label}:${rows[0]?.row ?? 0}:${query}`,
    restore: !anchor,
  });
  const width = columns * columnWidth + (numbered ? 48 : 0);
  const template = { display: 'block', position: 'relative', width, minWidth: width } as const;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth || 840));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => horizontal.measure(), [horizontal, columnWidth]);
  useEffect(() => {
    if (anchor) setQuery('');
  }, [anchor, setQuery]);
  useEffect(() => {
    if (!anchor || query) return;
    const index = body.findIndex((row) => row.row === anchor.row);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'center' });
    if (ref.current)
      ref.current.scrollLeft = Math.max(
        0,
        (anchor.column - 1) * columnWidth - ref.current.clientWidth / 2 + columnWidth / 2,
      );
  }, [anchor, query, body, virtual, columnWidth]);
  const addressToInspect =
    remembered?.row && remembered.column
      ? { row: remembered.row, column: remembered.column }
      : (anchor ?? (rows[0] ? { row: rows[0].row, column: 1 } : undefined));
  const current =
    selection || (addressToInspect && resolveTableCell(addressToInspect, rows, merges));
  const activeRow = current?.row ?? rows[0]?.row ?? 1;
  const activeColumn = current?.cell?.column ?? remembered?.column ?? 1;
  const selectCell = useCallback(
    (requested: TableAddress, focus = true) => {
      const selected = resolveTableCell(requested, rows, merges);
      const row = selected.row,
        column = selected.cell.column;
      setSelection(selected);
      setViews((previous) => rememberTableView(previous, label, { row, column }));
      const index = body.findIndex((item) => item.row >= requested.row);
      if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
      horizontal.scrollToIndex(column - 1, { align: 'auto' });
      if (focus) ref.current?.focus({ preventScroll: true });
    },
    [merges, rows, body, setViews, label, virtual, horizontal],
  );
  useEffect(() => {
    setAddress(columnName(activeColumn) + activeRow);
  }, [activeRow, activeColumn]);
  useEffect(() => {
    if (target && selectedTarget.current !== target) {
      selectedTarget.current = target;
      selectCell(target);
    }
  }, [target, selectCell]);
  const go = (destination: TableAddress) => {
    setAddressError('');
    if (query) setQuery('');
    if (
      navigate &&
      (destination.row < (rows[0]?.row ?? 1) || destination.row > (rows.at(-1)?.row ?? 0))
    )
      navigate(destination);
    else selectCell(destination);
  };
  const display = (cell: WorkbookCell) =>
    formatted && cell.formatted !== undefined ? cell.formatted : cell.value;
  return (
    <div className="data-viewer" aria-busy={filtering}>
      {renderControls ? (
        renderControls({ query, setQuery, rows: body.length, columns, filtering })
      ) : (
        <div className="preview-toolbar">
          <span className="muted">
            {body.length.toLocaleString()} {numbered ? 'stored rows' : 'rows'} · {columns} columns
          </span>
          <span className="toolbar-spacer" />
          {filtering && (
            <span className="muted" role="status">
              Filtering…
            </span>
          )}
          <input
            aria-label={paged ? 'Filter current worksheet page' : 'Filter table rows'}
            placeholder={paged ? 'Filter this page' : 'Filter rows'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {filtered?.rows === rows && filtered.query === query && filtered.error && (
        <p className="inline-warning">
          {filtered.error} {retryFilter && <button onClick={retryFilter}>Retry table</button>}
        </p>
      )}
      {numbered && (
        <div className="workbook-cell-detail">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = parseCellAddress(address, columns);
              if (!parsed) {
                setAddressError(`Enter a cell from A1 to ${columnName(columns)}1048576.`);
                return;
              }
              go(parsed);
            }}
          >
            <input
              aria-label="Cell address"
              value={address}
              aria-invalid={!!addressError}
              onChange={(event) => setAddress(event.target.value)}
            />
            <button type="submit">Go</button>
          </form>
          {current?.cell && (
            <>
              <span>
                {current.cell.formula !== undefined
                  ? `${current.cell.cached ? 'Saved value: ' + current.cell.value : 'No saved value'} · Formula: ${current.cell.formula || '(shared formula)'}`
                  : current.cell.value || 'Empty cell'}
                {current.cell.formatted !== undefined &&
                  current.cell.formatted !== current.cell.value &&
                  ` · Formatted: ${current.cell.formatted || '(empty)'}`}
                {current.cell.numberFormat && ` · Format: ${current.cell.numberFormat}`}
                {current.cell.formatWarning && ` · ${current.cell.formatWarning}`}
                {'merge' in current && current.merge && ` · Merged ${current.merge}`}
              </span>
            </>
          )}
        </div>
      )}
      {addressError && (
        <p className="inline-warning" role="alert">
          {addressError}
        </p>
      )}
      {anchor &&
        ((!rows.some((row) => row.row === anchor.row) && (numbered || anchor.row !== 1)) ||
          anchor.column > columns) && (
          <p className="inline-warning">The referenced cell is outside the available preview.</p>
        )}
      <div
        className="data-scroll"
        ref={ref}
        role={numbered ? 'grid' : 'table'}
        tabIndex={numbered ? 0 : undefined}
        aria-readonly={numbered ? true : undefined}
        aria-activedescendant={numbered ? `${id}-${activeRow}-${activeColumn}` : undefined}
        onKeyDown={
          numbered
            ? (event) => {
                if (event.altKey || event.shiftKey || event.target !== event.currentTarget) return;
                if (event.ctrlKey && (event.key === 'PageUp' || event.key === 'PageDown')) return;
                const merge = merges.find(
                  (merge) => activeRow === merge.fromRow && activeColumn === merge.fromColumn,
                );
                const current = {
                  row: event.key === 'ArrowDown' && merge ? merge.toRow : activeRow,
                  column: event.key === 'ArrowRight' && merge ? merge.toColumn : activeColumn,
                };
                const next = moveTableCell(
                  current,
                  event.key,
                  body.map((row) => row.row),
                  columns,
                  Math.max(1, Math.floor((ref.current?.clientHeight || 400) / 32) - 1),
                  sourceLastRow ?? rows.at(-1)?.row ?? 1,
                  event.ctrlKey || event.metaKey,
                );
                if (next) {
                  event.preventDefault();
                  event.stopPropagation();
                  go(next);
                }
              }
            : undefined
        }
        aria-label={label}
        aria-rowcount={numbered ? (sourceLastRow ?? rows.at(-1)?.row ?? 0) + 1 : rows.length + 1}
        aria-colcount={columns + (numbered ? 1 : 0)}
      >
        <div
          className="data-row data-header"
          role="row"
          style={{ ...template, position: 'sticky', top: 0, height: 32, zIndex: 3 }}
        >
          {numbered && (
            <div
              role="columnheader"
              className="workbook-row-number"
              aria-label="Row number"
              style={{
                position: 'sticky',
                left: 0,
                width: 48,
                height: 32,
                zIndex: 3,
                background: 'var(--surface)',
              }}
            />
          )}
          {horizontal.getVirtualItems().map((column) => {
            const index = column.index,
              header = headers[index]!;
            return (
              <div
                role="columnheader"
                aria-colindex={index + (numbered ? 2 : 1)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: column.start,
                  width: column.size,
                  height: 32,
                }}
                title={header}
                className={
                  !numbered && anchor?.row === 1 && anchor.column === index + 1
                    ? 'evidence-cell'
                    : undefined
                }
                key={index}
              >
                {header || `Column ${index + 1}`}
              </div>
            );
          })}
        </div>
        <div
          style={{
            height: virtual.getTotalSize(),
            position: 'relative',
            minWidth: width,
          }}
        >
          {virtual.getVirtualItems().map((item) => {
            const row = body[item.index];
            if (!row) return null;
            const cells = new Map(row.cells.map((cell) => [cell.column, cell]));
            return (
              <div
                role="row"
                aria-rowindex={numbered ? row.row + 1 : row.row}
                className="data-row"
                key={item.key}
                style={{
                  ...template,
                  position: 'absolute',
                  top: item.start,
                  height: item.size,
                  width,
                }}
              >
                {numbered && (
                  <div
                    role="rowheader"
                    className="workbook-row-number"
                    style={{
                      position: 'sticky',
                      left: 0,
                      width: 48,
                      height: 32,
                      zIndex: 2,
                      background: 'var(--surface)',
                    }}
                  >
                    {row.row}
                  </div>
                )}
                {horizontal.getVirtualItems().map((column) => {
                  const index = column.index;
                  const merge = merged.find(
                    (view) =>
                      row.row >= view.merge.fromRow &&
                      row.row <= view.merge.toRow &&
                      index + 1 >= view.merge.fromColumn &&
                      index + 1 <= view.merge.toColumn,
                  );
                  if (merge && (item.index !== merge.first || index + 1 !== merge.merge.fromColumn))
                    return null;
                  const cell = merge?.merge.anchor ??
                    cells.get(index + 1) ?? { column: index + 1, value: '' };
                  const sourceRow = merge?.merge.fromRow ?? row.row;
                  const mergeLabel = merge
                    ? `${columnName(merge.merge.fromColumn)}${merge.merge.fromRow}:${columnName(merge.merge.toColumn)}${merge.merge.toRow}`
                    : undefined;
                  const continuation = merge && sourceRow < row.row;
                  return (
                    <div
                      role={numbered ? 'gridcell' : 'cell'}
                      id={numbered ? `${id}-${sourceRow}-${cell.column}` : undefined}
                      aria-selected={
                        numbered
                          ? activeRow === sourceRow && activeColumn === cell.column
                          : undefined
                      }
                      aria-colindex={index + (numbered ? 2 : 1)}
                      aria-colspan={
                        merge ? merge.merge.toColumn - merge.merge.fromColumn + 1 : undefined
                      }
                      aria-rowspan={merge ? merge.last - merge.first + 1 : undefined}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: column.start,
                        width:
                          column.size *
                          (merge ? merge.merge.toColumn - merge.merge.fromColumn + 1 : 1),
                        height: 32 * (merge ? merge.last - merge.first + 1 : 1),
                        ...(merge ? { zIndex: 1, background: 'var(--surface)' } : {}),
                      }}
                      title={
                        cell.formula !== undefined
                          ? `${cell.cached ? cell.value : 'No saved value'} · =${cell.formula}`
                          : display(cell)
                      }
                      className={
                        anchor?.row === row.row && anchor.column === index + 1
                          ? 'evidence-cell'
                          : undefined
                      }
                      key={index}
                    >
                      {numbered ? (
                        <button
                          className={`workbook-cell${merge ? ' workbook-merged-cell' : ''}`}
                          tabIndex={-1}
                          aria-label={`${columnName(cell.column)}${sourceRow}: ${cell.formula !== undefined && !cell.cached ? 'No saved value' : display(cell) || 'Empty'}${mergeLabel ? ' · Merged ' + mergeLabel : ''}`}
                          onClick={() => {
                            selectCell({ row: sourceRow, column: cell.column });
                          }}
                        >
                          {continuation && (
                            <small>
                              Continued from {columnName(cell.column)}
                              {sourceRow}
                            </small>
                          )}
                          {cell.formula !== undefined && !cell.cached
                            ? 'No saved value'
                            : display(cell)}
                        </button>
                      ) : (
                        cell.value
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {!body.length && (
        <p className="inline-warning">
          {query
            ? 'No rows match this filter.'
            : paged && sourceLastRow !== 0
              ? 'No stored rows in this page.'
              : 'No stored rows in this sheet.'}
        </p>
      )}
    </div>
  );
}
export function DelimitedTable({
  text,
  delimiter,
  anchor,
  state,
}: {
  text: string;
  delimiter: string;
  anchor?: CellAnchor;
  state?: PreviewContext['state'];
}) {
  const [retry, setRetry] = useState(0);
  const request = useMemo(() => ({ text, delimiter, retry }), [text, delimiter, retry]);
  const [loaded, setLoaded] = useState<{
    request: typeof request;
    parsed?: Omit<DelimitedPreview, 'rows'> & { rows: WorkbookRow[] };
    reader?: ReturnType<typeof createTableSession>;
    error?: string;
  }>();
  useEffect(() => {
    const { text, delimiter } = request;
    let live = true;
    let reader: ReturnType<typeof createTableSession> | undefined;
    try {
      reader = createTableSession();
      const owned = reader;
      void reader.load(text, delimiter).then(
        (parsed) => {
          if (live)
            setLoaded({
              request,
              parsed: { ...parsed, rows: delimitedRows(parsed) },
              reader: owned,
            });
        },
        (error) => {
          if (live) {
            owned.close();
            setLoaded({ request, error: (error as Error).message });
          }
        },
      );
    } catch (error) {
      setLoaded({ request, error: (error as Error).message });
    }
    return () => {
      live = false;
      reader?.close();
    };
  }, [request]);
  if (loaded?.request !== request) return <Loading label="Reading table…" />;
  if (loaded.error)
    return (
      <Empty icon="warning" title="Table unavailable" detail={loaded.error}>
        <button onClick={() => setRetry((value) => value + 1)}>Retry table</button>
      </Empty>
    );
  const parsed = loaded.parsed!;
  return (
    <>
      {parsed.malformed && (
        <p className="inline-warning">
          Unclosed quoted field; the displayed data may be incomplete.
        </p>
      )}
      {parsed.truncated && (
        <p className="inline-warning">
          Showing a bounded preview: at most 100 columns, 100,000 records and 500,000 cells. Open
          the source for the complete table.
        </p>
      )}
      <DataTable
        rows={parsed.rows}
        state={state}
        headers={parsed.headers}
        label="Delimited data"
        anchor={anchor}
        filterRows={loaded.reader!.filter}
        retryFilter={() => setRetry((value) => value + 1)}
      />
    </>
  );
}
