import { parseDrawing } from '../../../domain/previews/drawings/dxf/geometry';
import { DXF_MAX_BYTES, type Drawing } from '../../../domain/previews/drawings/dxf/math';
import { decodeDXF } from '../../../domain/previews/drawings/dxf/decode';
export type DrawingResult =
  { drawing: Drawing; error?: never } | { error: string; drawing?: never };
self.onmessage = async (event: MessageEvent<{ url: string }>) => {
  try {
    const response = await fetch(event.data.url);
    if (!response.ok || !response.body) throw new Error("Viewer couldn't read this drawing.");
    if (Number(response.headers.get('content-length')) > DXF_MAX_BYTES)
      throw new Error('Viewer shows drawings up to 32 MB.');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > DXF_MAX_BYTES) throw new Error('Viewer shows drawings up to 32 MB.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    self.postMessage({
      drawing: parseDrawing(decodeDXF(buffer)),
    } satisfies DrawingResult);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Viewer couldn't read this drawing.",
    } satisfies DrawingResult);
  }
};
