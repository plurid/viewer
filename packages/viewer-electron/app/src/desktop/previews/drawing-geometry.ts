import { createHash } from 'node:crypto';
import { entry } from '../files/filesystem';
import { documentBytes } from './formats';
import { fileCoordination } from '../files/file-coordination';
import { decodeDXF } from '../../domain/previews/drawings/dxf/decode';
import { DXF_MAX_BYTES } from '../../domain/previews/drawings/dxf/math';
import { sourceVersion, sameSourceVersion } from '../../domain/files/inspection';
import {
  drawingGeometryPage,
  drawingGeometryOptionsSchema,
  type DrawingGeometryOptions,
  type DrawingGeometryPage,
} from '../../domain/previews/drawings/geometry';

export async function readDrawingGeometry(
  file: string,
  options: DrawingGeometryOptions = {},
  signal?: AbortSignal,
): Promise<DrawingGeometryPage> {
  const input = drawingGeometryOptionsSchema.parse(options);
  const before = await entry(file);
  if (before.kind !== 'file' || before.extension !== 'dxf')
    throw new Error('Choose a regular DXF drawing.');
  const result = await fileCoordination.run(
    [{ path: file, mode: 'read' }],
    async (coordinated) => {
      coordinated?.throwIfAborted();
      const bytes = await documentBytes(file, DXF_MAX_BYTES);
      const { parseDrawing } = await import('../../domain/previews/drawings/dxf/geometry');
      const drawing = parseDrawing(decodeDXF(bytes));
      coordinated?.throwIfAborted();
      return {
        path: file,
        version: sourceVersion(before),
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        ...drawingGeometryPage(drawing, input),
      };
    },
    signal,
  );
  signal?.throwIfAborted();
  if (!sameSourceVersion(result.version, sourceVersion(await entry(file))))
    throw new Error('The drawing changed. Read its geometry again.');
  return result;
}
