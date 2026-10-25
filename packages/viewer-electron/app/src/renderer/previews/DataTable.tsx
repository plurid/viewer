import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { EvidenceAnchor } from '../../domain/files/inspection';
import type { WorkbookCell, WorkbookRow } from '../../domain/previews/documents/office';
import { columnName } from '../../domain/previews/documents/office';
import { parseDelimited } from '../../domain/previews/data/delimited';
type CellAnchor = Extract<EvidenceAnchor, { kind: 'cells' }>;

/** CSV and worksheets share virtual rows while retaining original source addresses. */
export function DataTable({
  rows,
  headers,
  label,
  anchor,
  numbered = false,
}: {
  rows: readonly WorkbookRow[];
  headers: readonly string[];
  label: string;
  anchor?: CellAnchor;
  numbered?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [viewportWidth, setViewportWidth] = useState(840);
  const [selection, setSelection] = useState<{ row: number; cell: WorkbookCell }>();
  const body = useMemo(() => {
    const term = query.toLocaleLowerCase();
    return rows.filter(
      (row) => !term || row.cells.some((cell) => cell.value.toLocaleLowerCase().includes(term)),
    );
  }, [rows, query]);
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
  });
  const virtual = useVirtualizer({
    count: body.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 32,
    overscan: 8,
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
  return (
    <div className="data-viewer">
      <div className="preview-toolbar">
        <span className="muted">
          {body.length.toLocaleString()} {numbered ? 'stored rows' : 'rows'} · {columns} columns
        </span>
        <span className="toolbar-spacer" />
        <input
          aria-label="Filter table rows"
          placeholder="Filter rows"
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
        aria-rowcount={numbered ? (rows.at(-1)?.row ?? 0) + 1 : rows.length + 1}
        aria-colcount={columns + (numbered ? 1 : 0)}
      >
        <div
          className="data-row data-header"
          role="row"
          style={{ ...template, position: 'sticky', top: 0, height: 32 }}
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
                zIndex: 1,
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
                      zIndex: 1,
                      background: 'var(--surface)',
                    }}
                  >
                    {row.row}
                  </div>
                )}
                {horizontal.getVirtualItems().map((column) => {
                  const index = column.index;
                  const cell = cells.get(index + 1) || { column: index + 1, value: '' };
                  return (
                    <div
                      role="cell"
                      aria-colindex={index + (numbered ? 2 : 1)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: column.start,
                        width: column.size,
                        height: 32,
                      }}
                      title={
                        cell.formula !== undefined
                          ? `${cell.cached ? cell.value : 'No saved value'} · =${cell.formula}`
                          : cell.value
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
                          className="workbook-cell"
                          aria-label={`${columnName(index + 1)}${row.row}: ${cell.formula !== undefined && !cell.cached ? 'No saved value' : cell.value || 'Empty'}`}
                          onClick={() => setSelection({ row: row.row, cell })}
                        >
                          {cell.formula !== undefined && !cell.cached
                            ? 'No saved value'
                            : cell.value}
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
          {query ? 'No rows match this filter.' : 'No stored rows in this sheet.'}
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
