import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { FileEntry } from '../../domain/contracts';
import type { Size } from '../../domain/layout/geometry';
import type { PageText } from '../../domain/fabrication/check';
import { pagePictureQuality, pageScale, pageTextRuns } from '../../domain/fabrication/page-text';
GlobalWorkerOptions.workerSrc = workerURL;

/** An open PDF: its page sizes as displayed, and page pictures for the preview. */
export interface LayoutDocument {
  pages: Size[];
  /** The file as its resource read it. */
  entry: FileEntry;
  /** A page drawn with its longer side `longest` pixels, as a data URL. */
  picture(page: number, longest: number): Promise<string>;
  /** A page drawn as `picture` draws it, as JPEG bytes. */
  drawing(page: number, longest: number): Promise<{ data: Uint8Array<ArrayBuffer> } & Size>;
  /** A page's text runs, each with its box on the page as shown (`PageText`). */
  text(page: number, limit: number): Promise<PageText[]>;
  close(): void;
}

/** A page drawn on a canvas whose longer side is `longest` pixels. */
async function drawPage(page: PDFPageProxy, longest: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: pageScale(page.getViewport({ scale: 1 }), longest) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}
/** A page's text runs with their boxes on the page as shown (`pageTextRuns`). */
async function pageText(page: PDFPageProxy, limit: number): Promise<PageText[]> {
  const content = await page.getTextContent();
  return pageTextRuns(page.getViewport({ scale: 1 }), content.items, limit);
}

/** Reads a PDF through a scoped resource, as the PDF previews do; `close` releases both. */
export async function openLayoutDocument(
  path: string,
  signal: AbortSignal,
): Promise<LayoutDocument> {
  const resource = await window.viewer.resource(path);
  let task: ReturnType<typeof getDocument> | undefined;
  const close = () => {
    void task?.destroy();
    void window.viewer.release(resource.id).catch(() => {});
  };
  try {
    const local = new URL('/pdfjs/', document.baseURI).href;
    task = getDocument({
      url: resource.url,
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      useSystemFonts: true,
      cMapUrl: local + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: local + 'standard_fonts/',
      wasmUrl: local + 'wasm/',
    });
    const loading = task;
    let locked = false;
    loading.onPassword = () => {
      locked = true;
      void loading.destroy();
    };
    const pdf: PDFDocumentProxy = await loading.promise.catch((error: unknown) => {
      throw locked ? new Error('It is protected by a password.') : error;
    });
    const pages: Size[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      pages.push({ width, height });
    }
    const open = pdf;
    return {
      pages,
      entry: resource.entry,
      async picture(number, longest) {
        const canvas = await drawPage(await open.getPage(number), longest);
        const url = canvas.toDataURL('image/jpeg', pagePictureQuality);
        canvas.width = canvas.height = 0;
        return url;
      },
      async drawing(number, longest) {
        const canvas = await drawPage(await open.getPage(number), longest);
        const { width, height } = canvas;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', pagePictureQuality),
        );
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error(`Page ${number} could not be drawn.`);
        return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
      },
      async text(number, limit) {
        return pageText(await open.getPage(number), limit);
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
