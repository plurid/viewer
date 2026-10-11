/** PDF.js exposes its bundled fake-worker handler without a declaration file. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
