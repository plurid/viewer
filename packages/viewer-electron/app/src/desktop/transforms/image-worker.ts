import { workerPort } from '../workers/worker-port';
import { inspectImage, previewSvg, transformImage } from './image';
import { layoutImageSession } from './layout-image';
import type { LayoutImageRequest } from './layout-image';
import { imageTransformSchema } from '../../domain/operations/transforms';
import { errorMessage } from '../../domain/errors';
/** A layout's requests share one session: its canvas lives here between them. */
let layout: ReturnType<typeof layoutImageSession> | undefined;
workerPort.on('message', async (event) => {
  const request = event.data as {
    id: string;
    root: string;
    bytes: Uint8Array;
    plan?: unknown;
    previewSize?: number;
    layout?: LayoutImageRequest;
  };
  try {
    const value = request.layout
      ? await (layout ??= layoutImageSession(request.root))(request.layout)
      : request.previewSize !== undefined
        ? await previewSvg(request.root, Buffer.from(request.bytes), request.previewSize)
        : request.plan
          ? await transformImage(
              request.root,
              Buffer.from(request.bytes),
              imageTransformSchema.parse(request.plan),
            )
          : await inspectImage(request.root, Buffer.from(request.bytes));
    workerPort.postMessage({ id: request.id, value });
  } catch (error) {
    workerPort.postMessage({ id: request.id, error: errorMessage(error) });
  }
});
