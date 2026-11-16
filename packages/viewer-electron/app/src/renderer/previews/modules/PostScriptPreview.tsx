import { useEffect, useMemo, useRef, useState } from 'react';
import type { Resource } from '../../../domain/contracts';
import type {
  GhostscriptStatus,
  PostScriptInspection,
  PostScriptMetadata,
} from '../../../domain/previews/documents/postscript';
import type { PreviewContext } from '../contracts';
import { errorMessage } from '../../../domain/errors';
import { HexView } from '../HexView';
import { Loading } from '../../ui/primitives';
import TextPreview from './TextPreview';
import ImagePreview from './ImagePreview';
import PDFPreview from './PDFPreview';
import './postscript.css';

type PostScriptView = 'source' | 'embedded' | 'pages';
type RenderState = 'idle' | 'running' | 'finished';
const unknown = 'Unknown';
const number = (value: number) => String(Math.round(value * 100) / 100);
const sizeText = (size: PostScriptMetadata['size']) =>
  size
    ? `${number(size.width)} × ${number(size.height)} pt (${number((size.width * 25.4) / 72)} × ${number((size.height * 25.4) / 72)} mm)`
    : unknown;

export default function PostScriptPreview(context: PreviewContext) {
  const { resource, services, signal } = context;
  const [document, setDocument] = useState<PostScriptInspection>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState<GhostscriptStatus>({ kind: 'missing' });
  const [view, setView] = useState<PostScriptView>('source');
  const [renderState, setRenderState] = useState<RenderState>('idle');
  const [message, setMessage] = useState('');
  const [rendered, setRendered] = useState<Resource>();
  const request = useRef<string | undefined>(undefined);
  const owned = useRef<Resource | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let preview: Resource | undefined;
    const requestID = crypto.randomUUID();
    setDocument(undefined);
    setError('');
    setMessage('');
    setRendered(undefined);
    setRenderState('idle');
    if (!services.inspectPostscript) {
      setError('PostScript inspection is unavailable here.');
      return;
    }
    void services
      .inspectPostscript(resource.id, requestID)
      .then((value) => {
        if (!live || signal.aborted) {
          if (value.preview) void services.release(value.preview.id);
          return;
        }
        preview = value.preview;
        setDocument(value);
        setView(value.preview ? 'embedded' : 'source');
      })
      .catch((value: unknown) => {
        if (live && !signal.aborted) setError(errorMessage(value));
      });
    void services
      .postscriptStatus?.()
      .then((value) => {
        if (live && !signal.aborted) setStatus(value);
      })
      .catch(() => {});
    const cancel = () => {
      if (request.current) void services.cancelDocument(resource.id, request.current);
      request.current = undefined;
    };
    signal.addEventListener('abort', cancel, { once: true });
    return () => {
      live = false;
      signal.removeEventListener('abort', cancel);
      cancel();
      void services.cancelDocument(resource.id, requestID);
      if (preview) void services.release(preview.id);
      if (owned.current) void services.release(owned.current.id);
      owned.current = undefined;
    };
  }, [resource.id, services, signal]);

  const sourceServices = useMemo(
    () => ({
      ...services,
      read: async () => document!.source,
    }),
    [services, document],
  );

  const render = async () => {
    if (
      request.current ||
      signal.aborted ||
      !services.renderPostscript ||
      status.kind !== 'found' ||
      !document ||
      document.pdf
    )
      return;
    const requestID = crypto.randomUUID();
    request.current = requestID;
    setRenderState('running');
    setMessage('Rendering pages with Ghostscript…');
    try {
      const value = await services.renderPostscript(resource.id, requestID);
      if (request.current !== requestID || signal.aborted) {
        void services.release(value.id);
        return;
      }
      owned.current = value;
      setRendered(value);
      setView('pages');
      setRenderState('finished');
      setMessage(`Pages rendered with ${value.derivation?.decoder ?? 'Ghostscript'}.`);
    } catch (value) {
      if (request.current === requestID && !signal.aborted) {
        setMessage(errorMessage(value));
        setRenderState('idle');
      }
    } finally {
      if (request.current === requestID) request.current = undefined;
    }
  };

  const cancel = () => {
    const requestID = request.current;
    request.current = undefined;
    if (requestID) void services.cancelDocument(resource.id, requestID);
    setRenderState('idle');
    setMessage('PostScript rendering was cancelled.');
  };

  if (error)
    return (
      <div className="postscript-viewer">
        <p className="inline-warning" role="status">
          {error}
        </p>
        <HexView context={context} />
      </div>
    );
  if (!document) return <Loading label="Reading document comments…" />;
  if (document.pdf)
    return (
      <div className="postscript-viewer">
        <p className="postscript-caption">Illustrator file with a PDF inside.</p>
        <PDFPreview {...context} editing={undefined} editPDF={undefined} optimize={undefined} />
      </div>
    );
  const metadata = document.metadata;
  const facts = [
    ['Title', metadata.title ?? unknown],
    ['Creator', metadata.creator ?? unknown],
    ['Creation date', metadata.creationDate ?? unknown],
    ['Page count', metadata.pages ?? unknown],
    [metadata.size?.kind ?? 'Page or bounding-box size', sizeText(metadata.size)],
    ['Language level', metadata.languageLevel ?? unknown],
  ];
  return (
    <div className="postscript-viewer">
      <section className="postscript-description" aria-label="PostScript document details">
        <strong>{document.kind}</strong>
        <details open>
          <summary>Document comments</summary>
          <dl className="inspection-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {document.limited && (
            <p className="muted">Comments beyond the text preview limit were not inspected.</p>
          )}
        </details>
        <div className="empty-actions">
          <button aria-pressed={view === 'source'} onClick={() => setView('source')}>
            Source
          </button>
          {document.preview && (
            <button aria-pressed={view === 'embedded'} onClick={() => setView('embedded')}>
              Embedded preview
            </button>
          )}
          {rendered && (
            <button aria-pressed={view === 'pages'} onClick={() => setView('pages')}>
              Rendered pages
            </button>
          )}
          {status.kind === 'found' && services.renderPostscript && renderState === 'idle' && (
            <button onClick={() => void render()}>Render pages with Ghostscript</button>
          )}
          {renderState === 'running' && <button onClick={cancel}>Cancel rendering</button>}
        </div>
        {document.wmf && (
          <p className="muted">Embedded WMF preview; this picture is not displayed.</p>
        )}
        {status.kind === 'missing' && (
          <p className="muted">Pages can be rendered if Ghostscript is installed.</p>
        )}
        {status.kind === 'store' && (
          <p className="muted">Page rendering is unavailable in the Store edition.</p>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      {view === 'embedded' && document.preview ? (
        <>
          <p className="postscript-caption">
            Embedded EPS preview; this is the picture saved in the file.
          </p>
          <ImagePreview
            {...context}
            resource={document.preview}
            editing={undefined}
            editImage={undefined}
            optimize={undefined}
          />
        </>
      ) : view === 'pages' && rendered ? (
        <PDFPreview
          {...context}
          resource={rendered}
          editing={undefined}
          editPDF={undefined}
          optimize={undefined}
        />
      ) : (
        <TextPreview {...context} services={sourceServices} editing={undefined} />
      )}
    </div>
  );
}
