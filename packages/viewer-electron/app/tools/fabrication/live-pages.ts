/**
 * A CHECK'S DRAWING PAGES, DRAWN IN NODE for the live evaluation, as renderer/fabrication/pages.ts
 * draws them in the app: each page by pdf.js at `checkLimits.pageSide` pixels on its longer side,
 * a JPEG at the renderer's quality, with its text runs and their boxes from the arithmetic the
 * renderer uses (domain/fabrication/page-text.ts). pdf.js's Node build draws onto @napi-rs/canvas,
 * its own canvas dependency, where the app draws onto Chromium's canvas; docs/reference/
 * fabrication.md lists what differs.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { CheckSource, RenderedPage } from '../../src/domain/fabrication/check';
import { checkLimits } from '../../src/domain/fabrication/check';
import {
  pagePictureQuality,
  pageScale,
  pageTextRuns,
} from '../../src/domain/fabrication/page-text';
import { errorMessage } from '../../src/domain/errors';

interface NodeCanvas {
  width: number;
  height: number;
  encode(format: 'jpeg', quality: number): Promise<Buffer>;
}

// The worker runs in this thread, as in the tests that read PDFs.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
const pdfRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const { createCanvas } = createRequire(path.join(pdfRoot, 'package.json'))('@napi-rs/canvas') as {
  createCanvas(width: number, height: number): NodeCanvas;
};

/** How the pages are drawn, for the results. */
export const nodePages = `pdf.js ${version} in Node on @napi-rs/canvas, ${checkLimits.pageSide} px on the longer side, JPEG quality ${pagePictureQuality}`;

/** Every drawing's pages, at most `checkLimits.pages` across the job, and what could not be read. */
export async function drawPagesInNode(
  sources: readonly CheckSource[],
): Promise<{ pages: RenderedPage[]; problems: string[] }> {
  const pages: RenderedPage[] = [];
  const problems: string[] = [];
  let left: number = checkLimits.pages;
  for (const source of sources) {
    if (source.kind !== 'drawing') continue;
    if (!left) {
      problems.push(`${source.name}: the check sends at most ${checkLimits.pages} pages.`);
      continue;
    }
    // The renderer's options, with pdf.js's own folders in place of the app's copies.
    const task = getDocument({
      data: new Uint8Array(await readFile(source.path)),
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      useSystemFonts: true,
      cMapUrl: pdfRoot + '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: pdfRoot + '/standard_fonts/',
      wasmUrl: pdfRoot + '/wasm/',
    });
    try {
      const document = await task.promise;
      const count = document.numPages;
      for (let number = 1; number <= count && left > 0; number++, left--) {
        const page = await document.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: pageScale(base, checkLimits.pageSide) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
        const image = await canvas.encode('jpeg', Math.round(pagePictureQuality * 100));
        pages.push({
          ref: source.ref,
          version: source.version,
          page: number,
          pages: count,
          width: canvas.width,
          height: canvas.height,
          image: new Uint8Array(image),
          text: pageTextRuns(base, (await page.getTextContent()).items, checkLimits.pageItems),
        });
      }
    } catch (error) {
      problems.push(`${source.name}: ${errorMessage(error)}`);
    } finally {
      await task.destroy();
    }
  }
  return { pages, problems };
}
