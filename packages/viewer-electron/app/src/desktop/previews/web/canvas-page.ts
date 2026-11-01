import { requestPath, responseHeaders, WebPreviewError } from './policy';

/** Only this immutable snapshot's named parts are available to generated code. */
export class CanvasPageReader {
  readonly size: number;
  constructor(private files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>) {
    this.size = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    if (this.size > 128 * 1024 * 1024)
      throw new WebPreviewError(413, 'The canvas assets exceed 128 MiB.');
  }
  async response(
    pathname: string,
    method: string,
    _range: string | null,
    signal: AbortSignal,
    capability: string,
  ): Promise<Response> {
    signal.throwIfAborted();
    if (method !== 'GET' && method !== 'HEAD')
      throw new WebPreviewError(405, 'Method not allowed.');
    const name = requestPath(pathname).join('/') || 'index.html';
    const bytes = this.files.get(name);
    if (!bytes) throw new WebPreviewError(404, 'This asset is not attached to the canvas.');
    const headers = responseHeaders(name, capability);
    headers['Content-Length'] = String(bytes.length);
    return new Response(method === 'HEAD' ? null : bytes, { headers });
  }
  async close(): Promise<void> {
    this.files = new Map();
  }
}
