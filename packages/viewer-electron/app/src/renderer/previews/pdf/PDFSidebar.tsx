import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { resolveOutline, type OutlineEntry } from './outline';
import { Loading } from '../../ui/primitives';

/** A page thumbnail, rendered only while its row is in view. */
function Thumbnail({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false,
      task: RenderTask | undefined;
    void pdf
      .getPage(page)
      .then((sheet) => {
        const target = canvas.current;
        if (cancelled || !target) return;
        const base = sheet.getViewport({ scale: 1 });
        const viewport = sheet.getViewport({
          scale: Math.min(120 / base.width, 150 / base.height),
        });
        const ratio = Math.min(2, devicePixelRatio || 1);
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        task = sheet.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        return task.promise;
      })
      .catch(() => {
        // A page that cannot render keeps an empty frame; the main view reports errors.
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);
  return <canvas ref={canvas} aria-hidden="true" />;
}

export function PDFThumbnails({
  pdf,
  page,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  onSelect(page: number): void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: pdf.numPages,
    getScrollElement: () => scroll.current,
    estimateSize: () => 182,
    overscan: 3,
  });
  useEffect(() => {
    virtual.scrollToIndex(page - 1, { align: 'auto' });
  }, [page, virtual]);
  return (
    <div className="pdf-thumbnails" ref={scroll} role="listbox" aria-label="Pages">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const number = item.index + 1;
          return (
            <button
              key={item.key}
              role="option"
              aria-selected={number === page}
              aria-label={`Page ${number}`}
              className={number === page ? 'selected' : ''}
              style={{ position: 'absolute', top: item.start, height: item.size, width: '100%' }}
              onClick={() => onSelect(number)}
            >
              <Thumbnail pdf={pdf} page={number} />
              <span>{number}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OutlineItems({
  entries,
  page,
  onSelect,
}: {
  entries: OutlineEntry[];
  page: number;
  onSelect(page: number): void;
}) {
  return (
    <ul>
      {entries.map((entry, index) => (
        <li key={index}>
          {entry.page ? (
            <button
              className={entry.page === page ? 'selected' : ''}
              onClick={() => onSelect(entry.page!)}
              title={`${entry.title} · page ${entry.page}`}
            >
              <span>{entry.title}</span>
              <small className="muted">{entry.page}</small>
            </button>
          ) : (
            <span className="muted">{entry.title}</span>
          )}
          {entry.children.length > 0 && (
            <OutlineItems entries={entry.children} page={page} onSelect={onSelect} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function PDFOutline({
  pdf,
  page,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  onSelect(page: number): void;
}) {
  const [entries, setEntries] = useState<OutlineEntry[]>();
  useEffect(() => {
    let live = true;
    setEntries(undefined);
    void pdf
      .getOutline()
      .then((outline) => resolveOutline(pdf, outline ?? []))
      .then((value) => {
        if (live) setEntries(value);
      })
      .catch(() => {
        if (live) setEntries([]);
      });
    return () => {
      live = false;
    };
  }, [pdf]);
  if (!entries) return <Loading label="Reading outline…" />;
  if (!entries.length) return <p className="muted pdf-outline-empty">This PDF has no outline.</p>;
  return (
    <nav className="pdf-outline" aria-label="Outline">
      <OutlineItems entries={entries} page={page} onSelect={onSelect} />
    </nav>
  );
}
