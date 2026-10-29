import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { LocalServerLog } from '../../../domain/previews/web';
import { errorResponse, webLimits, WebPreviewError } from './policy';
import type { StaticRoot } from './static-root';

type RequestLog = Omit<LocalServerLog, 'sequence'>;

function headerCount(request: Pick<IncomingMessage, 'rawHeaders'>, name: string): number {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]?.toLowerCase() === name) count++;
  return count;
}

function authorizeLoopbackRequest(
  request: Pick<IncomingMessage, 'headers' | 'rawHeaders'>,
  port: number,
): void {
  const origin = `http://127.0.0.1:${port}`;
  if (request.headers.host !== `127.0.0.1:${port}` || headerCount(request, 'host') !== 1)
    throw new WebPreviewError(403, 'The loopback Host does not match this server.');
  if (
    headerCount(request, 'origin') > 1 ||
    (request.headers.origin !== undefined && request.headers.origin !== origin)
  )
    throw new WebPreviewError(403, 'Cross-origin requests are unavailable.');
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none')
    throw new WebPreviewError(403, 'Cross-site requests are unavailable.');
  const referer = request.headers.referer;
  if (referer !== undefined) {
    try {
      if (new URL(referer).origin !== origin) throw new Error('Foreign referrer');
    } catch {
      throw new WebPreviewError(403, 'Cross-site requests are unavailable.');
    }
  }
}

/** One explicitly started IPv4 loopback listener. It owns every accepted socket and response. */
export class LoopbackServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly requests = new Set<AbortController>();
  private readonly pending = new Set<Promise<void>>();
  private stopping?: Promise<void>;
  port = 0;

  constructor(
    private reader: StaticRoot,
    private log: (entry: RequestLog) => void,
    stopped?: () => void,
  ) {
    this.server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
      const work = this.respond(request, response);
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work)).catch(() => {});
    });
    this.server.maxConnections = 16;
    this.server.maxRequestsPerSocket = 100;
    this.server.headersTimeout = 5000;
    this.server.requestTimeout = webLimits.requestMs;
    this.server.timeout = webLimits.requestMs;
    this.server.keepAliveTimeout = 3000;
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    this.server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      else socket.destroy();
    });
    this.server.on('error', () => {
      void this.close();
    });
    this.server.on('close', () => {
      try {
        stopped?.();
      } catch {
        /* Lifecycle observers do not own cleanup. */
      }
    });
  }

  async listen(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        clean();
        reject(error);
      };
      const cancelled = () => failed(new Error('Server start cancelled.'));
      const clean = () => {
        this.server.removeListener('error', failed);
        signal.removeEventListener('abort', cancelled);
      };
      this.server.once('error', failed);
      signal.addEventListener('abort', cancelled, { once: true });
      this.server.listen({ host: '127.0.0.1', port: 0, exclusive: true, signal }, () => {
        clean();
        const address = this.server.address();
        if (!address || typeof address === 'string')
          return reject(new Error('No loopback port was assigned.'));
        this.port = address.port;
        resolve();
      });
    });
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const began = Date.now();
    const abort = new AbortController();
    this.requests.add(abort);
    const cancelled = () => abort.abort(new Error('HTTP request cancelled.'));
    request.once('aborted', cancelled);
    response.once('close', () => {
      if (!response.writableFinished) cancelled();
    });
    let status = 500;
    let bytes = 0;
    let problem: string | undefined;
    try {
      if (this.stopping) throw new WebPreviewError(503, 'Server stopped.');
      authorizeLoopbackRequest(request, this.port);
      if (
        request.headers['transfer-encoding'] ||
        (request.headers['content-length'] && request.headers['content-length'] !== '0')
      )
        throw new WebPreviewError(400, 'Request bodies are unavailable.');
      const result = await this.reader.response(
        request.url ?? '/',
        request.method ?? '',
        request.headers.range ?? null,
        abort.signal,
      );
      status = result.status;
      response.writeHead(status, Object.fromEntries(result.headers));
      if (request.method === 'HEAD' || !result.body) {
        await result.body?.cancel();
        response.end();
      } else {
        const count = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            done(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(result.body as NodeReadableStream<Uint8Array>),
          count,
          response,
          { signal: abort.signal },
        );
      }
    } catch (error) {
      if (response.destroyed || abort.signal.aborted) {
        status = response.headersSent ? status : 499;
        problem = 'Request cancelled';
        response.destroy();
      } else if (response.headersSent) {
        problem = 'Response interrupted';
        response.destroy();
      } else {
        const result = errorResponse(error);
        status = result.status;
        const body = Buffer.from(await result.text());
        response.writeHead(status, {
          ...Object.fromEntries(result.headers),
          Connection: 'close',
          'Content-Length': String(body.length),
        });
        bytes = request.method === 'HEAD' ? 0 : body.length;
        response.end(request.method === 'HEAD' ? undefined : body);
        problem = status >= 500 ? 'Request failed' : undefined;
      }
    } finally {
      request.removeListener('aborted', cancelled);
      this.requests.delete(abort);
      const raw = request.url?.split(/[?#]/, 1)[0] ?? '/';
      const pathname = raw.startsWith('/') ? raw : '/[invalid-target]';
      try {
        this.log({
          timestamp: began,
          method: (request.method ?? '').slice(0, 20),
          path: pathname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 1024),
          status,
          durationMs: Math.max(0, Date.now() - began),
          bytes,
          ...(problem ? { error: problem } : {}),
        });
      } catch {
        /* A status observer never owns a socket's cleanup. */
      }
    }
  }

  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    return (this.stopping = (async () => {
      for (const request of this.requests) request.abort(new Error('Server stopped.'));
      const closed = new Promise<void>((resolve) => this.server.close(() => resolve()));
      this.server.closeAllConnections();
      for (const socket of this.sockets) socket.destroy();
      await Promise.allSettled([closed, this.reader.close(), ...this.pending]);
    })());
  }
}
