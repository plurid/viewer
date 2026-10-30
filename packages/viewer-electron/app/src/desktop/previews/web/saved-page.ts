import type { SavedPage } from '../../../domain/previews/saved-page';
import { savedPageLimits, savedPageName } from '../../../domain/previews/saved-page';
import { requestPath, responseHeaders, WebPreviewError } from './policy';

/** A page made from a file's own parts, held in memory and served under one capability with the
 * script-free policy. It reads no file after it is made. */
export class SavedPageReader {
  private files = new Map<string, Uint8Array<ArrayBuffer>>();
  readonly size: number;

  constructor(page: SavedPage) {
    const html = new TextEncoder().encode(page.html);
    if (html.length > savedPageLimits.htmlBytes)
      throw new WebPreviewError(413, 'The page exceeds 4 MB of HTML.');
    this.files.set(savedPageName, html);
    let size = html.length;
    for (const part of page.parts.slice(0, savedPageLimits.parts)) {
      if (this.files.has(part.path) || part.path === savedPageName) continue;
      size += part.data.length;
      if (size > savedPageLimits.pageBytes + savedPageLimits.htmlBytes)
        throw new WebPreviewError(413, 'The page parts exceed their limit.');
      this.files.set(part.path, new Uint8Array(part.data));
    }
    this.size = size;
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
    const name = requestPath(pathname).join('/') || savedPageName;
    const data = this.files.get(name);
    if (!data) throw new WebPreviewError(404, 'This page holds no such part.');
    const headers = responseHeaders(name, capability, false);
    headers['Content-Length'] = String(data.length);
    return new Response(method === 'HEAD' ? null : data, { status: 200, headers });
  }

  async close(): Promise<void> {
    this.files.clear();
  }
}
