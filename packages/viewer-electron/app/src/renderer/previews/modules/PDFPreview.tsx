import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  PixelsPerInch,
  TextLayer,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { pdfScale, pdfZoom, type PDFZoom } from '../pdf-viewport';
import type { PreviewContext } from '../contracts';
import { Empty, IconButton, Loading } from '../../ui/primitives';

GlobalWorkerOptions.workerSrc = workerURL;
export default function PDFPreview(context: PreviewContext) {
  const { resource, signal, active } = context;
  const [pdf, setPDF] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = usePreviewState(context, 'pdf.page', 1);
  // The old pdf.zoom value was width-relative, even though its label said 100%.
  const [savedZoom, setZoom] = usePreviewState<PDFZoom>(context, 'pdf.view', 'page');
  const zoom = pdfZoom(savedZoom);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (context.evidence?.anchor.kind === 'pdf') {
      setPage(context.evidence.anchor.page);
      setQuery(context.evidence.quote.slice(0, 150));
    }
  }, [context.evidence, setPage]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const local = new URL('/pdfjs/', document.baseURI).href;
    const task = getDocument({
      url: resource.url,
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      useSystemFonts: true,
      cMapUrl: `${local}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${local}standard_fonts/`,
      wasmUrl: `${local}wasm/`,
    });
    void task.promise
      .then((document) => {
        if (!signal.aborted) setPDF(document);
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message);
      });
    return () => {
      void task.destroy();
    };
  }, [resource.url, signal]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // ResizeObserver's content box already excludes padding and scrollbars.
      const { width, height } = entry.contentRect;
      setAvailable((before) =>
        before.width === width && before.height === height ? before : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pdf]);
  useEffect(() => {
    if (pdf && page > pdf.numPages) setPage(pdf.numPages);
  }, [pdf, page, setPage]);
  useEffect(() => {
    if (
      !pdf ||
      !active ||
      !canvas.current ||
      !text.current ||
      available.width <= 0 ||
      available.height <= 0
    )
      return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let layer: TextLayer | undefined;
    void pdf
      .getPage(page)
      .then(async (sheet) => {
        if (cancelled) return;
        const initial = sheet.getViewport({ scale: PixelsPerInch.PDF_TO_CSS_UNITS });
        const nextScale = pdfScale(initial, available, zoom);
        const viewport = sheet.getViewport({
          scale: nextScale * PixelsPerInch.PDF_TO_CSS_UNITS,
        });
        setScale(nextScale);
        const target = canvas.current!;
        const container = text.current!;
        const ratio = Math.min(devicePixelRatio, 2);
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        container.replaceChildren();
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;
        container.style.setProperty('--scale-factor', String(viewport.scale));
        container.style.setProperty('--total-scale-factor', String(viewport.scale));
        render = sheet.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await render.promise;
        if (cancelled) return;
        layer = new TextLayer({
          textContentSource: await sheet.getTextContent(),
          container,
          viewport,
        });
        await layer.render();
      })
      .catch((error) => {
        if (!cancelled && error.name !== 'RenderingCancelledException') setError(error.message);
      });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, zoom, available, active]);
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
  }, [page, zoom]);
  useEffect(() => {
    if (!pdf || !query.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        const found: number[] = [];
        for (let index = 1; index <= Math.min(pdf.numPages, 1000); index++) {
          if (cancelled || signal.aborted) return;
          const sheet = await pdf.getPage(index);
          const content = await sheet.getTextContent();
          if (
            content.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' ')
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())
          )
            found.push(index);
        }
        if (!cancelled) {
          setMatches(found);
          if (found.length) setPage(found[0]);
          setSearching(false);
        }
      })().catch((error) => {
        if (!cancelled) {
          setError(error.message);
          setSearching(false);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [pdf, query, signal]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'pdf-next',
          label: 'Next PDF page',
          aliases: ['np'],
          available: !!pdf && page < pdf.numPages,
          run: () => setPage((value) => value + 1),
        },
        {
          id: 'pdf-previous',
          label: 'Previous PDF page',
          aliases: ['pp'],
          available: !!pdf && page > 1,
          run: () => setPage((value) => value - 1),
        },
        {
          id: 'pdf-search',
          label: 'Search PDF text…',
          aliases: ['sp'],
          primary: true,
          available: !!pdf,
          run: () => setSearchOpen(true),
        },
        {
          id: 'pdf-fit-page',
          label: 'Fit PDF page',
          available: !!pdf,
          run: () => setZoom('page'),
        },
        {
          id: 'pdf-fit-width',
          label: 'Fit PDF width',
          available: !!pdf,
          run: () => setZoom('width'),
        },
        {
          id: 'zoom-in',
          label: 'Zoom in',
          available: !!pdf && scale < 4,
          run: () => setZoom(Math.min(4, Math.max(0.1, Math.round(scale * 1.25 * 100) / 100))),
        },
        {
          id: 'zoom-out',
          label: 'Zoom out',
          available: !!pdf && scale > 0.1,
          run: () => setZoom(Math.max(0.1, Math.min(4, Math.round((scale / 1.25) * 100) / 100))),
        },
      ],
      [pdf, page, scale, setPage, setZoom],
    ),
  );
  if (error) return <Empty icon="pdf" title="PDF could not be displayed" detail={error} />;
  if (!pdf) return <Loading label="Opening PDF…" />;
  return (
    <div className="pdf-viewer">
      <PreviewToolbar context={context}>
        <IconButton
          icon="left"
          label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        />
        <input
          className="page-number"
          type="number"
          aria-label="Page number"
          min={1}
          max={pdf.numPages}
          value={page}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (next >= 1 && next <= pdf.numPages) setPage(next);
          }}
        />
        <span className="muted">/ {pdf.numPages}</span>
        <IconButton
          icon="right"
          label="Next page"
          disabled={page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        />
        <select
          aria-label="PDF zoom"
          value={zoom}
          onChange={(event) => {
            const value = event.target.value;
            setZoom(pdfZoom(value === 'page' || value === 'width' ? value : Number(value)));
          }}
        >
          <option value="page">Fit page</option>
          <option value="width">Fit width</option>
          {[
            ...new Set([
              0.25,
              0.5,
              0.75,
              1,
              1.25,
              1.5,
              2,
              3,
              4,
              ...(typeof zoom === 'number' ? [zoom] : []),
            ]),
          ]
            .sort((a, b) => a - b)
            .map((value) => (
              <option value={value} key={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
        </select>
        <IconButton icon="search" label="Search PDF" onClick={() => setSearchOpen(true)} />
      </PreviewToolbar>
      {searchOpen && (
        <div className="search-row">
          <input
            ref={searchInput}
            aria-label="Search PDF text"
            placeholder="Find in PDF"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            icon="close"
            label="Close PDF search"
            onClick={() => {
              setSearchOpen(false);
              setQuery('');
            }}
          />
        </div>
      )}
      {query && (
        <div className="pdf-search-results">
          {searching
            ? 'Searching…'
            : `${matches.length} matching pages${pdf.numPages > 1000 ? ' in the first 1,000 pages' : ''}`}
          {matches.slice(0, 100).map((index) => (
            <button
              className={page === index ? 'selected' : ''}
              key={index}
              onClick={() => setPage(index)}
            >
              {index}
            </button>
          ))}
        </div>
      )}
      <div className="pdf-scroll" ref={scroll}>
        <div className="pdf-sheet">
          <canvas ref={canvas} />
          <div className="textLayer" ref={text} />
        </div>
      </div>
    </div>
  );
}
