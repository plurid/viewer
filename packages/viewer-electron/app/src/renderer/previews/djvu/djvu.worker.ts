/// <reference lib="webworker" />
import init, { WasmDocument } from 'djvu-rs';
import { djvuLimits, type DjVuReply, type DjVuRequest } from './protocol';

// The decoder is memory-safe Rust compiled to WebAssembly, running in this worker of the
// sandboxed renderer. The preview terminates the worker when it closes.
const scope = self as unknown as DedicatedWorkerGlobalScope;
let document: WasmDocument | undefined;
const reply = (message: DjVuReply, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

async function open(request: Extract<DjVuRequest, { kind: 'open' }>) {
  const response = await fetch(request.url);
  if (!response.ok) throw new Error('The file is unavailable.');
  if (Number(response.headers.get('content-length') ?? 0) > djvuLimits.bytes)
    throw new Error('This DjVu file is larger than 256 MB.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > djvuLimits.bytes) throw new Error('This DjVu file is larger than 256 MB.');
  // Loads the bundled WebAssembly build, with SIMD where the engine supports it.
  await init();
  document?.free();
  document = WasmDocument.from_bytes(bytes);
  reply({ kind: 'opened', id: request.id, pages: document.page_count() });
}

scope.onmessage = async ({ data }: MessageEvent<DjVuRequest>) => {
  try {
    if (data.kind === 'open') return await open(data);
    if (!document) throw new Error('The document is not open.');
    if (!Number.isInteger(data.page) || data.page < 1 || data.page > document.page_count())
      throw new Error('That page does not exist.');
    const page = document.page(data.page - 1);
    try {
      if (data.kind === 'size')
        reply({ kind: 'size', id: data.id, width: page.width_at(96), height: page.height_at(96) });
      else if (data.kind === 'text') reply({ kind: 'text', id: data.id, text: page.text() ?? '' });
      else {
        const dpi = Math.max(1, Math.min(1200, Math.round(data.dpi)));
        const width = page.width_at(dpi),
          height = page.height_at(dpi);
        if (width * height > djvuLimits.pixels)
          throw new Error('This page is too large to render.');
        const pixels = page.render(dpi);
        reply({ kind: 'rendered', id: data.id, width, height, pixels }, [pixels.buffer]);
      }
    } finally {
      page.free();
    }
  } catch (error) {
    reply({
      kind: 'error',
      id: data.id,
      message: (error as Error).message || 'DjVu decoding failed.',
    });
  }
};
