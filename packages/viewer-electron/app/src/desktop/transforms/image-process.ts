import { randomUUID } from 'node:crypto';
import type { ImageTransform } from '../../domain/operations/transforms';
import { launchWorker } from '../workers/utility-client';
import type { ImageInspection } from './image';
import type { WorkerBackend } from '../workers/utility-client';

/** One bounded utility process per conversion. Cancelling terminates libvips work,
 * rather than merely discarding a reply while the decoder keeps consuming CPU. */
export function imageProcess(
  worker: string,
  root: string,
  bytes: Buffer,
  plan: ImageTransform,
  signal: AbortSignal,
  backend?: WorkerBackend,
): Promise<Buffer> {
  return requestImage<Uint8Array>(worker, root, bytes, plan, signal, backend).then((value) =>
    Buffer.from(value),
  );
}
export function imageInspectionProcess(
  worker: string,
  root: string,
  bytes: Buffer,
  signal: AbortSignal,
  backend?: WorkerBackend,
): Promise<ImageInspection> {
  return requestImage<ImageInspection>(worker, root, bytes, undefined, signal, backend);
}
export function svgPreviewProcess(
  worker: string,
  root: string,
  bytes: Buffer,
  size: number,
  signal: AbortSignal,
  backend?: WorkerBackend,
): Promise<Buffer> {
  return requestImage<Uint8Array>(worker, root, bytes, undefined, signal, backend, size).then(
    (value) => Buffer.from(value),
  );
}
function requestImage<T>(
  worker: string,
  root: string,
  bytes: Buffer,
  plan: ImageTransform | undefined,
  signal: AbortSignal,
  backend?: WorkerBackend,
  previewSize?: number,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = launchWorker(worker, 'Viewer Image Tools', backend),
      id = randomUUID();
    let finished = false;
    const settle = (error?: unknown, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      child.process?.kill();
      void child.thread?.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const cancel = () => settle(signal.reason ?? new Error('Image conversion cancelled.'));
    const timer = setTimeout(
      () => settle(new Error('Image processing timed out. Its source was kept.')),
      previewSize === undefined ? 90000 : 10000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    child.exit(() => settle(new Error('Image processor stopped. Try again.')));
    child.thread?.on('error', () => settle(new Error('Image processor stopped. Try again.')));
    child.message((reply) => {
      if (reply.id === id)
        settle(reply.error ? new Error(reply.error) : undefined, reply.value as T);
    });
    try {
      child.postMessage({ id, root, bytes, plan, previewSize });
    } catch (error) {
      settle(error);
    }
  });
}
