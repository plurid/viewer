/** Reads DXF drawings once and extracts their parts again whenever units or layers change. */
import { readCutDrawing, type CutDrawing } from '../../../domain/layout/nesting/drawing';
import { extractParts, suggestedMarks } from '../../../domain/layout/nesting/parts';
import { DXF_MAX_BYTES } from '../../../domain/previews/drawings/dxf/math';
import { decodeDXF } from '../../../domain/previews/drawings/dxf/decode';
import { errorMessage } from '../../../domain/errors';
import type { PartsReply, PartsRequest } from './protocol';

const drawings = new Map<string, CutDrawing>();
const post = (reply: PartsReply) => self.postMessage(reply);

async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The drawing is unavailable. Select it again.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > DXF_MAX_BYTES) throw new Error('This drawing is larger than 32 MB.');
  return new Uint8Array(buffer);
}

self.onmessage = async (event: MessageEvent<PartsRequest>) => {
  const request = event.data;
  if (request.kind === 'forget') return void drawings.delete(request.key);
  try {
    if (request.kind === 'read') {
      const drawing = readCutDrawing(decodeDXF(await bytes(request.url)));
      drawings.set(request.key, drawing);
      post({
        id: request.id,
        kind: 'read',
        drawing: {
          units: drawing.units,
          layers: drawing.layers,
          suggested: suggestedMarks(drawing.layers),
        },
      });
      return;
    }
    const drawing = drawings.get(request.key);
    if (!drawing) throw new Error('The drawing is no longer open. Select it again.');
    const { options } = request;
    const file = extractParts(
      drawing,
      { scale: options.scale, marks: new Set(options.marks), together: options.together },
      options.name,
    );
    post({
      id: request.id,
      kind: 'parts',
      parts: { ...file, parts: file.parts.map(({ entities: _entities, ...part }) => part) },
    });
  } catch (error) {
    post({ id: request.id, kind: 'error', error: errorMessage(error) });
  }
};
