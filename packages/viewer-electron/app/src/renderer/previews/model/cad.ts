import type { CadMesh, CadReply } from './cad-data';

export function importCad(
  buffer: ArrayBuffer,
  extension: string,
  signal: AbortSignal,
): Promise<CadMesh[]> {
  return new Promise((resolve, reject) => {
    if (buffer.byteLength > 64 * 1024 * 1024) {
      reject(new Error('This CAD file exceeds the conversion limit (64 MB).'));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./cad.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      stop();
      reject(new Error('CAD conversion took too long. Try a simpler model or reopen the file.'));
    }, 45000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<CadReply>) => {
      stop();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.meshes!);
    };
    worker.onerror = () => {
      stop();
      reject(new Error('The CAD preview engine could not read this file.'));
    };
    worker.postMessage({ buffer, extension }, [buffer]);
  });
}
