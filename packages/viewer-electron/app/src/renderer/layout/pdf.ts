import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { Size } from '../../domain/layout/geometry';
GlobalWorkerOptions.workerSrc = workerURL;

/** An open PDF: its page sizes as displayed, and page pictures for the preview. */
export interface LayoutDocument {
  pages: Size[];
  /** A page drawn with its longer side `longest` pixels, as a data URL. */
  picture(page: number, longest: number): Promise<string>;
  close(): void;
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
      async picture(number, longest) {
        const page = await open.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: longest / Math.max(base.width, base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const url = canvas.toDataURL('image/jpeg', 0.86);
        canvas.width = canvas.height = 0;
        return url;
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
