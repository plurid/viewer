import { useEffect, useMemo, useRef, useState } from 'react';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { pdfCanvasRatio, pdfScale, pdfZoom, type PDFZoom } from '../pdf-viewport';
import type { PreviewContext } from '../contracts';
import { Empty, IconButton, Loading } from '../../ui/primitives';
import { cssDPI, type DjVuReply, type DjVuRequest } from '../djvu/protocol';

type Unsent = {
  [K in DjVuRequest['kind']]: Omit<Extract<DjVuRequest, { kind: K }>, 'id'>;
}[DjVuRequest['kind']];
interface DjVuClient {
  ask(request: Unsent): Promise<DjVuReply>;
  close(): void;
}
/** A decoding worker per preview; closing the preview terminates it with its document. */
function connect(): DjVuClient {
  const worker = new Worker(new URL('../djvu/djvu.worker.ts', import.meta.url), {
    type: 'module',
  });
  const pending = new Map<
    number,
    { resolve(reply: DjVuReply): void; reject(error: Error): void }
  >();
  let next = 0;
  const failAll = (message: string) => {
    for (const waiting of pending.values()) waiting.reject(new Error(message));
    pending.clear();
  };
  worker.onmessage = ({ data }: MessageEvent<DjVuReply>) => {
    const waiting = pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id);
    if (data.kind === 'error') waiting.reject(new Error(data.message));
    else waiting.resolve(data);
  };
  worker.onerror = (event) => failAll(event.message || 'The DjVu decoder stopped.');
  return {
    ask: (request) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        worker.postMessage({ ...request, id });
      }),
    close: () => {
      worker.terminate();
      failAll('The preview closed.');
    },
  };
}

export default function DjVuPreview(context: PreviewContext) {
  const { resource, signal, active } = context;
  const [pages, setPages] = useState(0);
  const [page, setPage] = usePreviewState(context, 'djvu.page', 1);
  const [savedZoom, setZoom] = usePreviewState<PDFZoom>(context, 'djvu.view', 'page');
  const zoom = pdfZoom(savedZoom);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<DjVuClient>();
  const texts = useRef(new Map<number, string>());
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const connection = connect();
    texts.current = new Map();
    setPages(0);
    setError('');
    setClient(connection);
    void connection
      .ask({ kind: 'open', url: resource.url })
      .then((reply) => {
        if (reply.kind === 'opened' && !signal.aborted) setPages(reply.pages);
      })
      .catch((value: Error) => {
        if (!signal.aborted) setError(value.message);
      });
    return () => connection.close();
  }, [resource.url, signal]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setAvailable((before) =>
        before.width === width && before.height === height ? before : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pages]);
  useEffect(() => {
    if (pages && page > pages) setPage(pages);
  }, [pages, page, setPage]);
  useEffect(() => {
    if (!client || !pages || !active || available.width <= 0 || available.height <= 0) return;
    let cancelled = false;
    void (async () => {
      const size = await client.ask({ kind: 'size', page });
      if (cancelled || size.kind !== 'size') return;
      const nextScale = pdfScale(size, available, zoom);
      const viewport = { width: size.width * nextScale, height: size.height * nextScale };
      // The same density and pixel limits as PDF pages.
      const ratio = pdfCanvasRatio(viewport, devicePixelRatio);
      const rendered = await client.ask({ kind: 'render', page, dpi: cssDPI * nextScale * ratio });
      const target = canvas.current;
      if (cancelled || rendered.kind !== 'rendered' || !target) return;
      setScale(nextScale);
      target.width = rendered.width;
      target.height = rendered.height;
      target.style.width = `${rendered.width / ratio}px`;
      target.style.height = `${rendered.height / ratio}px`;
      target
        .getContext('2d')
        ?.putImageData(
          new ImageData(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height),
          0,
          0,
        );
    })().catch((value: Error) => {
      if (!cancelled) setError(value.message);
    });
    return () => {
      cancelled = true;
    };
  }, [client, pages, page, zoom, available, active]);
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
  }, [page, zoom]);
  useEffect(() => {
    if (!client || !pages || !query.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        const found: number[] = [];
        const needle = query.toLocaleLowerCase();
        for (let index = 1; index <= Math.min(pages, 2000); index++) {
          if (cancelled || signal.aborted) return;
          let text = texts.current.get(index);
          if (text === undefined) {
            const reply = await client.ask({ kind: 'text', page: index });
            text = reply.kind === 'text' ? reply.text.toLocaleLowerCase() : '';
            texts.current.set(index, text);
          }
          if (text.includes(needle)) found.push(index);
        }
        if (cancelled) return;
        setMatches(found);
        const [first] = found;
        if (first) setPage(first);
        setSearching(false);
      })().catch((value: Error) => {
        if (cancelled) return;
        setError(value.message);
        setSearching(false);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [client, pages, query, signal, setPage]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'djvu-next',
          label: 'Next DjVu page',
          aliases: ['np'],
          available: page < pages,
          run: () => setPage((value) => value + 1),
        },
        {
          id: 'djvu-previous',
          label: 'Previous DjVu page',
          aliases: ['pp'],
          available: page > 1 && pages > 0,
          run: () => setPage((value) => value - 1),
        },
        {
          id: 'djvu-search',
          label: 'Search DjVu text…',
          primary: true,
          available: pages > 0,
          run: () => setSearchOpen(true),
        },
        {
          id: 'djvu-fit-page',
          label: 'Fit DjVu page',
          available: pages > 0,
          run: () => setZoom('page'),
        },
        {
          id: 'djvu-fit-width',
          label: 'Fit DjVu width',
          available: pages > 0,
          run: () => setZoom('width'),
        },
        {
          id: 'zoom-in',
          label: 'Zoom in',
          available: pages > 0 && scale < 4,
          run: () => setZoom(Math.min(4, Math.max(0.1, Math.round(scale * 1.25 * 100) / 100))),
        },
        {
          id: 'zoom-out',
          label: 'Zoom out',
          available: pages > 0 && scale > 0.1,
          run: () => setZoom(Math.max(0.1, Math.min(4, Math.round((scale / 1.25) * 100) / 100))),
        },
      ],
      [page, pages, scale, setPage, setZoom],
    ),
  );
  if (error)
    return <Empty icon="file" title="DjVu document could not be displayed" detail={error} />;
  if (!pages) return <Loading label="Opening DjVu document…" />;
  return (
    <div className="pdf-viewer djvu-viewer">
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
          max={pages}
          value={page}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value >= 1 && value <= pages) setPage(value);
          }}
        />
        <span className="muted">/ {pages}</span>
        <IconButton
          icon="right"
          label="Next page"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        />
        <select
          aria-label="DjVu zoom"
          value={zoom}
          onChange={(event) => {
            const value = event.target.value;
            setZoom(pdfZoom(value === 'page' || value === 'width' ? value : Number(value)));
          }}
        >
          <option value="page">Fit page</option>
          <option value="width">Fit width</option>
          {[...new Set([0.5, 0.75, 1, 1.5, 2, 3, ...(typeof zoom === 'number' ? [zoom] : [])])]
            .sort((a, b) => a - b)
            .map((value) => (
              <option value={value} key={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
        </select>
        <IconButton icon="search" label="Search text" onClick={() => setSearchOpen(true)} />
      </PreviewToolbar>
      {searchOpen && (
        <div className="search-row">
          <input
            ref={searchInput}
            aria-label="Search DjVu text"
            placeholder="Find in document"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            icon="close"
            label="Close search"
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
            : `${matches.length} matching pages${pages > 2000 ? ' in the first 2,000 pages' : ''}`}
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
        </div>
      </div>
    </div>
  );
}
