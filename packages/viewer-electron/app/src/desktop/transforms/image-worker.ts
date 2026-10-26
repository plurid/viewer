import { workerPort } from '../workers/worker-port';
import { inspectImage, previewSvg, transformImage } from './image';
import { imageTransformSchema } from '../../domain/operations/transforms';
import { errorMessage } from '../../domain/errors';
workerPort.on('message', async (event) => {
  const request = event.data as {
    id: string;
    root: string;
    bytes: Uint8Array;
    plan?: unknown;
    previewSize?: number;
  };
  try {
    const value =
      request.previewSize !== undefined
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
