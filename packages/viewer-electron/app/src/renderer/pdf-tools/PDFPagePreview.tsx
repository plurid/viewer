import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Empty, Loading } from '../ui/primitives';
GlobalWorkerOptions.workerSrc = workerURL;

/** One bounded page bitmap, one scoped resource. Switching pages cancels the old render;
 * switching sources releases even a resource that arrives after unmount. */
export function PDFPagePreview({
  file,
  page,
  rotate,
}: {
  file: string;
  page: number;
  rotate: number;
}) {
  const [pdf, setPDF] = useState<PDFDocumentProxy>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [rendered, setRendered] = useState(false);
  const [bitmap, setBitmap] = useState<{ url: string; page: number; rotate: number }>();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true,
      resource: string | undefined,
      task: ReturnType<typeof getDocument> | undefined;
    setPDF(undefined);
    setBitmap(undefined);
    setError('');
    setRendered(false);
    const timer = setTimeout(() => {
      if (live)
        setError('The page preview is taking longer than expected. Retry to load it again.');
    }, 15000);
    void window.viewer
      .resource(file)
      .then(async (value) => {
        if (!live) {
          await window.viewer.release(value.id);
          return;
        }
        resource = value.id;
        const local = new URL('/pdfjs/', document.baseURI).href;
        task = getDocument({
          url: value.url,
          disableAutoFetch: true,
          disableStream: true,
          enableXfa: false,
          useSystemFonts: true,
          cMapUrl: local + 'cmaps/',
          cMapPacked: true,
          standardFontDataUrl: local + 'standard_fonts/',
          wasmUrl: local + 'wasm/',
        });
        task.onPassword = () => {
          if (live) setError('Use an unlocked copy to edit PDF pages.');
          void task?.destroy();
        };
        const loaded = await task.promise;
        if (live) {
          clearTimeout(timer);
          setPDF(loaded);
        }
      })
      .catch((reason) => {
        if (live) {
          clearTimeout(timer);
          setError(String(reason.message || reason));
        }
      });
    const off = window.viewer.onEvent((event) => {
      if (
        event.type === 'file-access' &&
        (file === event.path || file.startsWith(event.path.replace(/\/$/, '') + '/'))
      ) {
        setPDF(undefined);
        setError('File access changed. Retry after restoring access.');
        void task?.destroy();
      }
    });
    return () => {
      live = false;
      clearTimeout(timer);
      off();
      void task?.destroy();
      if (resource) void window.viewer.release(resource).catch(() => {});
    };
  }, [file, attempt]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false,
      task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setRendered(false);
    setBitmap(undefined);
    void pdf
      .getPage(page)
      .then(async (sheet) => {
        if (cancelled) return;
        const base = sheet.getViewport({ scale: 1, rotation: (sheet.rotate + rotate) % 360 });
        const viewport = sheet.getViewport({
          scale: Math.min(2, 1100 / base.width, 1400 / base.height),
          rotation: (sheet.rotate + rotate) % 360,
        });
        const target = canvas.current!;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        task = sheet.render({ canvas: target, viewport });
        await task.promise;
        if (!cancelled) {
          // A retained bitmap survives compositor invalidation when a modal's
          // theme or viewport changes. The scratch canvas never owns display.
          setBitmap({ url: target.toDataURL('image/png'), page, rotate });
        }
      })
      .catch((reason) => {
        if (!cancelled && reason.name !== 'RenderingCancelledException')
          setError(String(reason.message || reason));
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, rotate]);
  return (
    <div className="pdf-tools-page">
      <canvas ref={canvas} hidden />
      {bitmap && (
        <img
          src={bitmap.url}
          alt={`PDF page ${bitmap.page} preview`}
          data-pdf-page={bitmap.page}
          data-pdf-rotation={bitmap.rotate}
          hidden={!rendered || !!error}
          onLoad={() => setRendered(true)}
          onError={() => setError('The page bitmap could not be displayed. Retry the preview.')}
        />
      )}
      {error ? (
        <Empty title="Page preview unavailable" detail={error}>
          <button onClick={() => setAttempt((value) => value + 1)}>Retry preview</button>
        </Empty>
      ) : (
        !rendered && <Loading label="Reading page…" />
      )}
    </div>
  );
}
