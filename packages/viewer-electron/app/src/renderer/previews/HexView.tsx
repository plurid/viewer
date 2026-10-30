import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { PreviewContext } from './contracts';
import {
  asciiText,
  byteText,
  hexCachedPages,
  hexPage,
  hexRow,
  offsetDigits,
  offsetText,
  readOffset,
} from '../../domain/files/hex';
import { Empty } from '../ui/primitives';
import { PreviewToolbar, usePreviewCommands } from './controls';
import { usePreviewState } from './state';
import './modules/inspection.css';

const rowHeight = 20;
/** The tallest scroller Viewer lays out; a longer file maps it onto its rows. */
const maximumScroll = 4_000_000;
const overscan = 4;

interface PageState {
  pages: Map<number, Uint8Array>;
  /** Pages whose read failed, read again only when the person asks. */
  failed: ReadonlySet<number>;
}

/**
 * Pages of a file read through its resource with byte ranges, as the rows on screen need them.
 * The few kept are the most recently read; a page scrolled past stops loading.
 */
function usePages(url: string, size: number, signal: AbortSignal) {
  const cache = useRef(new Map<number, Uint8Array>());
  const loading = useRef(new Map<number, AbortController>());
  const [state, setState] = useState<PageState>({ pages: cache.current, failed: new Set() });
  const failed = useRef(state.failed);
  failed.current = state.failed;
  useEffect(() => {
    const pending = loading.current;
    cache.current = new Map();
    setState({ pages: cache.current, failed: new Set() });
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, [url]);
  const want = useCallback(
    (wanted: readonly number[]) => {
      for (const [page, controller] of loading.current)
        if (!wanted.includes(page)) {
          controller.abort();
          loading.current.delete(page);
        }
      for (const page of wanted) {
        const start = page * hexPage;
        if (
          cache.current.has(page) ||
          loading.current.has(page) ||
          failed.current.has(page) ||
          start < 0 ||
          start >= size
        )
          continue;
        const length = Math.min(size - start, hexPage);
        const controller = new AbortController();
        loading.current.set(page, controller);
        const pages = cache.current;
        fetch(url, {
          headers: { Range: `bytes=${start}-${start + length - 1}` },
          signal: AbortSignal.any([signal, controller.signal]),
        })
          .then(async (response) => {
            const declared = Number(response.headers.get('content-length') ?? 0);
            if (!response.ok || declared > length) throw new Error('The file could not be read.');
            return new Uint8Array(await response.arrayBuffer()).slice(0, length);
          })
          .then((bytes) => {
            if (controller.signal.aborted || pages !== cache.current) return;
            pages.set(page, bytes);
            for (const old of pages.keys()) {
              if (pages.size <= hexCachedPages) break;
              if (!wanted.includes(old)) pages.delete(old);
            }
            setState((current) => ({ ...current, pages }));
          })
          .catch(() => {
            if (!controller.signal.aborted && !signal.aborted && pages === cache.current)
              setState((current) => ({ pages, failed: new Set(current.failed).add(page) }));
          })
          .finally(() => {
            if (loading.current.get(page) === controller) loading.current.delete(page);
          });
      }
    },
    [url, size, signal],
  );
  const byte = useCallback(
    (offset: number) => state.pages.get(Math.floor(offset / hexPage))?.[offset % hexPage],
    [state],
  );
  const retry = useCallback(() => setState((current) => ({ ...current, failed: new Set() })), []);
  return { byte, want, failed: state.failed.size > 0, retry };
}

/**
 * A file's bytes, sixteen to a row: offset, hexadecimal and ASCII. Only the rows on screen are
 * drawn, and only the pages they fall in are read. Arrow keys, Page Up and Page Down, Home and
 * End move the cursor; ⌘↑ and ⌘↓ go to the file's ends, and Go to offset jumps.
 */
export function HexView({ context }: { context: PreviewContext }) {
  const { resource, signal } = context;
  const size = resource.entry.size;
  const rows = Math.ceil(size / hexRow);
  const digits = offsetDigits(size);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [stored, setCursor] = usePreviewState(context, 'hex.offset', 0);
  const cursor = Math.min(Math.max(0, stored), Math.max(0, size - 1));
  const [target, setTarget] = useState('');
  const [problem, setProblem] = useState('');
  const { byte, want, failed, retry } = usePages(resource.url, size, signal);

  const total = rows * rowHeight;
  const scaled = total > maximumScroll;
  const spacer = scaled ? maximumScroll : total;
  // jsdom and a hidden plane lay out nothing: draw a screenful anyway
  const visible = Math.max(1, Math.ceil((viewport.height || 640) / rowHeight));
  const range = Math.max(0, rows - visible);
  const first = scaled
    ? Math.round((viewport.top / Math.max(1, spacer - viewport.height)) * range)
    : Math.floor(viewport.top / rowHeight);
  const firstRow = Math.min(Math.max(0, first), range);
  const lastRow = Math.min(rows - 1, firstRow + visible + overscan);

  const measure = useCallback(() => {
    const element = scroller.current;
    if (element) setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, []);
  useLayoutEffect(() => {
    measure();
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => {
    if (!rows) return;
    const pages = new Set<number>();
    for (const row of [firstRow, lastRow]) pages.add(Math.floor((row * hexRow) / hexPage));
    want([...pages]);
  }, [rows, firstRow, lastRow, want, failed]);

  /** Scrolls so `row` is on screen, at the top or the bottom edge as it comes from. */
  const reveal = useCallback(
    (row: number, align: 'start' | 'end' | 'nearest' = 'nearest') => {
      const element = scroller.current;
      if (!element) return;
      const top =
        align === 'start' || (align === 'nearest' && row < firstRow)
          ? row
          : align === 'end' || row > firstRow + visible - 1
            ? row - visible + 1
            : undefined;
      if (top === undefined) return;
      const clamped = Math.min(Math.max(0, top), range);
      element.scrollTop = scaled
        ? (clamped / Math.max(1, range)) * Math.max(0, spacer - element.clientHeight)
        : clamped * rowHeight;
      measure();
    },
    [firstRow, visible, range, scaled, spacer, measure],
  );
  const move = useCallback(
    (offset: number) => {
      const next = Math.min(Math.max(0, offset), Math.max(0, size - 1));
      setCursor(next);
      reveal(Math.floor(next / hexRow));
    },
    [size, setCursor, reveal],
  );
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const page = visible * hexRow;
    const column = cursor % hexRow;
    const steps: Record<string, number | undefined> = {
      ArrowLeft: cursor - 1,
      ArrowRight: cursor + 1,
      ArrowUp: event.metaKey ? 0 : cursor - hexRow,
      ArrowDown: event.metaKey ? size - 1 : cursor + hexRow,
      PageUp: cursor - page,
      PageDown: cursor + page,
      Home: event.metaKey ? 0 : cursor - column,
      End: event.metaKey ? size - 1 : cursor - column + hexRow - 1,
    };
    const next = steps[event.key];
    if (next === undefined || event.altKey || event.ctrlKey) return;
    event.preventDefault();
    move(next);
  };
  const go = () => {
    const reading = readOffset(target, size);
    if ('error' in reading) {
      setProblem(reading.error);
      return;
    }
    setProblem('');
    setCursor(reading.offset);
    reveal(Math.floor(reading.offset / hexRow), 'start');
    scroller.current?.focus();
  };
  const choose = (event: MouseEvent<HTMLDivElement>) => {
    const offset = (event.target as HTMLElement).closest<HTMLElement>('[data-offset]')?.dataset
      .offset;
    if (offset !== undefined) setCursor(Number(offset));
  };
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'hex-go-to',
          label: 'Go to offset',
          aliases: ['goto', 'offset'],
          run: () => field.current?.focus(),
        },
      ],
      [],
    ),
  );
  if (!size) return <Empty icon="file" title="This file is empty" />;
  const value = byte(cursor);
  const drawn: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) drawn.push(row);
  return (
    <div className="hex-viewer">
      <PreviewToolbar context={context}>
        <form
          className="hex-go"
          onSubmit={(event) => {
            event.preventDefault();
            go();
          }}
        >
          <input
            ref={field}
            aria-label="Go to offset"
            placeholder="Go to offset"
            value={target}
            aria-invalid={!!problem}
            title={problem || 'An offset such as 0x1F0 or 496'}
            onChange={(event) => {
              setTarget(event.target.value);
              setProblem('');
            }}
          />
        </form>
        <span className="toolbar-spacer" />
        <span className="muted tabular" aria-live="polite">
          {offsetText(cursor, digits)}
          {value === undefined ? '' : ` · ${byteText(value)} · ${value.toLocaleString()}`}
        </span>
      </PreviewToolbar>
      {problem && (
        <p className="inline-warning" role="alert">
          {problem}
        </p>
      )}
      {failed && (
        <p className="inline-warning" role="alert">
          Part of the file could not be read.{' '}
          <button type="button" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      <div
        className="hex-scroll"
        ref={scroller}
        tabIndex={0}
        role="grid"
        aria-label="File bytes"
        aria-rowcount={rows}
        onScroll={measure}
        onKeyDown={keys}
        onMouseDown={choose}
      >
        <div className="hex-spacer" style={{ height: spacer }}>
          {drawn.map((row) => {
            const start = row * hexRow;
            const top = scaled ? viewport.top + (row - firstRow) * rowHeight : row * rowHeight;
            const cells = Array.from(
              { length: Math.min(hexRow, size - start) },
              (_, index) => start + index,
            );
            return (
              <div
                className="hex-row"
                role="row"
                aria-rowindex={row + 1}
                key={row}
                style={{ top, height: rowHeight }}
              >
                <span className="hex-offset">{offsetText(start, digits)}</span>
                <span className="hex-bytes">
                  {cells.map((offset) => {
                    const cell = byte(offset);
                    return (
                      <span
                        key={offset}
                        data-offset={offset}
                        role="gridcell"
                        aria-selected={offset === cursor}
                        className={cell === undefined ? 'hex-byte pending' : 'hex-byte'}
                      >
                        {cell === undefined ? '··' : byteText(cell)}
                      </span>
                    );
                  })}
                </span>
                <span className="hex-ascii" aria-hidden="true">
                  {cells.map((offset) => {
                    const cell = byte(offset);
                    return (
                      <span
                        key={offset}
                        data-offset={offset}
                        className={offset === cursor ? 'selected' : undefined}
                      >
                        {cell === undefined ? ' ' : asciiText(cell)}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
