import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  PixelsPerInch,
  TextLayer,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { pdfCanvasRatio, pdfScale, pdfZoom, type PDFZoom } from '../pdf-viewport';
import type { PreviewContext } from '../contracts';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { getState, report } from '../../state/store';
import { PDFOutline, PDFThumbnails } from '../pdf/PDFSidebar';

type PDFSidebar = 'none' | 'pages' | 'outline';

GlobalWorkerOptions.workerSrc = workerURL;
export default function PDFPreview(context: PreviewContext) {
  const { resource, signal, active } = context;
  const [pdf, setPDF] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = usePreviewState(context, 'pdf.page', 1);
  const pageText = useRef(new WeakMap<object, Map<number, string>>());
  // The old pdf.zoom value was width-relative, even though its label said 100%.
  const [savedZoom, setZoom] = usePreviewState<PDFZoom>(context, 'pdf.view', 'page');
  const zoom = pdfZoom(savedZoom);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = usePreviewState<PDFSidebar>(context, 'pdf.sidebar', 'none');
  // The password lives only in this view's memory; it is never saved with preview state.
  const password = useRef('');
  const [unlock, setUnlock] = useState<{ update(password: string): void; incorrect: boolean }>();
  const [entered, setEntered] = useState('');
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
    password.current = '';
    setUnlock(undefined);
    task.onPassword = (update: (password: string) => void, reason: number) => {
      if (signal.aborted) return;
      setEntered('');
      setUnlock({ update, incorrect: reason === PasswordResponses.INCORRECT_PASSWORD });
    };
    void task.promise
      .then((document) => {
        if (signal.aborted) return;
        setUnlock(undefined);
        setPDF(document);
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
      if (!entry) return;
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
        const ratio = pdfCanvasRatio(viewport, devicePixelRatio);
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
        // Page text is extracted once per document; later queries reuse it.
        let pages = pageText.current.get(pdf);
        if (!pages) pageText.current.set(pdf, (pages = new Map()));
        for (let index = 1; index <= Math.min(pdf.numPages, 1000); index++) {
          if (cancelled || signal.aborted) return;
          let text = pages.get(index);
          if (text === undefined) {
            const sheet = await pdf.getPage(index);
            const content = await sheet.getTextContent();
            text = content.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' ')
              .toLocaleLowerCase();
            sheet.cleanup();
            pages.set(index, text);
          }
          if (text.includes(query.toLocaleLowerCase())) found.push(index);
        }
        if (!cancelled) {
          setMatches(found);
          const [first] = found;
          if (first) setPage(first);
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
  }, [pdf, query, signal, setPage]);
  const printable = getState().bootstrap.platform === 'darwin';
  const print = useMemo(
    () => () => {
      void window.viewer.printPDF(resource.id, password.current || undefined).catch(report);
    },
    [resource.id],
  );
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
          id: 'pdf-pages',
          label: sidebar === 'pages' ? 'Hide PDF pages' : 'Show PDF pages',
          aliases: ['thumbnails'],
          available: !!pdf,
          run: () => setSidebar(sidebar === 'pages' ? 'none' : 'pages'),
        },
        {
          id: 'pdf-outline',
          label: sidebar === 'outline' ? 'Hide PDF outline' : 'Show PDF outline',
          aliases: ['contents', 'table of contents', 'bookmarks'],
          available: !!pdf,
          run: () => setSidebar(sidebar === 'outline' ? 'none' : 'outline'),
        },
        {
          id: 'pdf-print',
          label: 'Print PDF…',
          aliases: ['print'],
          available: !!pdf && printable,
          run: print,
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
      [pdf, page, scale, setPage, setZoom, sidebar, setSidebar, printable, print],
    ),
  );
  if (error) return <Empty icon="pdf" title="PDF could not be displayed" detail={error} />;
  if (!pdf && unlock)
    return (
      <form
        className="pdf-password"
        onSubmit={(event) => {
          event.preventDefault();
          if (!entered) return;
          password.current = entered;
          unlock.update(entered);
        }}
      >
        <Empty
          icon="pdf"
          title="This PDF is protected by a password"
          detail={
            unlock.incorrect
              ? 'That password is not correct. Try again.'
              : 'The password opens it in this view only and is not saved.'
          }
        >
          <input
            type="password"
            aria-label="PDF password"
            autoComplete="off"
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
          />
          <button type="submit" className="primary" disabled={!entered}>
            Open
          </button>
        </Empty>
      </form>
    );
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
        <ChoiceButton
          label="PDF zoom"
          value={String(zoom)}
          choices={[
            { value: 'page', label: 'Fit page' },
            { value: 'width', label: 'Fit width' },
            ...[
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
              .map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` })),
          ]}
          onChoose={(value) =>
            setZoom(pdfZoom(value === 'page' || value === 'width' ? value : Number(value)))
          }
        />
        <IconButton icon="search" label="Search PDF" onClick={() => setSearchOpen(true)} />
        <IconButton
          icon="sidebar"
          label={sidebar === 'pages' ? 'Hide pages' : 'Show pages'}
          aria-pressed={sidebar === 'pages'}
          onClick={() => setSidebar(sidebar === 'pages' ? 'none' : 'pages')}
        />
        <IconButton
          icon="list"
          label={sidebar === 'outline' ? 'Hide outline' : 'Show outline'}
          aria-pressed={sidebar === 'outline'}
          onClick={() => setSidebar(sidebar === 'outline' ? 'none' : 'outline')}
        />
        {printable && <IconButton icon="print" label="Print…" onClick={print} />}
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
      <div className="pdf-body">
        {sidebar === 'pages' && <PDFThumbnails pdf={pdf} page={page} onSelect={setPage} />}
        {sidebar === 'outline' && <PDFOutline pdf={pdf} page={page} onSelect={setPage} />}
        <div className="pdf-scroll" ref={scroll}>
          <div className="pdf-sheet">
            <canvas ref={canvas} />
            <div className="textLayer" ref={text} />
          </div>
        </div>
      </div>
    </div>
  );
}
