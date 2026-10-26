import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
import type { EvidenceAnchor } from '../../domain/files/inspection';
import type {
  WorkbookCell,
  WorkbookRow,
  WorkbookMerge,
} from '../../domain/previews/documents/office';
import { columnName } from '../../domain/previews/documents/office';
import { parseDelimited } from '../../domain/previews/data/delimited';
type CellAnchor = Extract<EvidenceAnchor, { kind: 'cells' }>;
const noMerges: readonly WorkbookMerge[] = [];

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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [viewportWidth, setViewportWidth] = useState(840);
  const [selection, setSelection] = useState<{ row: number; cell: WorkbookCell; merge?: string }>();
  const body = useMemo(() => {
    const term = query.toLocaleLowerCase();
    return rows.filter(
      (row) =>
        !term ||
        row.cells.some((cell) =>
          (cell.value + ' ' + (cell.formatted ?? '')).toLocaleLowerCase().includes(term),
        ),
    );
  }, [rows, query]);
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
      for (const view of merged)
        if (view.first <= range.endIndex && view.last >= range.startIndex) included.add(view.first);
      return [...included].sort((a, b) => a - b);
    },
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
  }, [anchor]);
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
  const current =
    selection ||
    (anchor && {
      row: anchor.row,
      cell: rows
        .find((row) => row.row === anchor.row)
        ?.cells.find((cell) => cell.column === anchor.column),
    });
  const display = (cell: WorkbookCell) =>
    formatted && cell.formatted !== undefined ? cell.formatted : cell.value;
  return (
    <div className="data-viewer">
      <div className="preview-toolbar">
        <span className="muted">
          {body.length.toLocaleString()} {numbered ? 'stored rows' : 'rows'} · {columns} columns
        </span>
        <span className="toolbar-spacer" />
        <input
          aria-label={paged ? 'Filter current worksheet page' : 'Filter table rows'}
          placeholder={paged ? 'Filter this page' : 'Filter rows'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {numbered && (
        <div className="workbook-cell-detail" aria-live="polite">
          {current?.cell ? (
            <>
              <strong>
                {columnName(current.cell.column)}
                {current.row}
              </strong>
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
          ) : (
            <span className="muted">Select a cell to see its value or saved formula.</span>
          )}
        </div>
      )}
      {anchor &&
        ((!rows.some((row) => row.row === anchor.row) && (numbered || anchor.row !== 1)) ||
          anchor.column > columns) && (
          <p className="inline-warning">The referenced cell is outside the available preview.</p>
        )}
      <div
        className="data-scroll"
        ref={ref}
        role="table"
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
                      role="cell"
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
                          aria-label={`${columnName(cell.column)}${sourceRow}: ${cell.formula !== undefined && !cell.cached ? 'No saved value' : display(cell) || 'Empty'}${mergeLabel ? ' · Merged ' + mergeLabel : ''}`}
                          onClick={() => setSelection({ row: sourceRow, cell, merge: mergeLabel })}
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
}: {
  text: string;
  delimiter: string;
  anchor?: CellAnchor;
}) {
  const parsed = useMemo(() => {
    const { rows, malformed } = parseDelimited(text, delimiter);
    const columns = Math.min(
      100,
      Math.max(rows[0]?.length || 0, ...rows.slice(0, 100).map((row) => row.length), 1),
    );
    return {
      malformed,
      headers: Array.from(
        { length: columns },
        (_, index) => rows[0]?.[index] || `Column ${index + 1}`,
      ),
      rows: rows.slice(1).map((cells, index) => ({
        row: index + 2,
        cells: cells.slice(0, columns).map((value, index) => ({ column: index + 1, value })),
      })),
    };
  }, [text, delimiter]);
  return (
    <>
      {parsed.malformed && (
        <p className="inline-warning">
          Unclosed quoted field; the displayed data may be incomplete.
        </p>
      )}
      <DataTable
        rows={parsed.rows}
        headers={parsed.headers}
        label="Delimited data"
        anchor={anchor}
      />
    </>
  );
}
