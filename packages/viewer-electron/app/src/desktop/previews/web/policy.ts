import { lookup } from 'mime-types';

export const webLimits = {
  htmlBytes: 4 * 1024 * 1024,
  embeddedAssetBytes: 32 * 1024 * 1024,
  httpAssetBytes: 128 * 1024 * 1024,
  directoryEntries: 200,
  globalReads: 32,
  sessionReads: 8,
  requestMs: 15_000,
  servers: 16,
  ownerServers: 8,
  records: 64,
  ownerRecords: 32,
  previews: 64,
  ownerPreviews: 16,
  logs: 200,
} as const;

export class WebPreviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requestPath(raw: string): string[] {
  const pathname = raw.split(/[?#]/, 1)[0] ?? '';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.length > 8192)
    throw new WebPreviewError(400, 'Invalid request path.');
  if (/%(?:2f|5c|00)/i.test(pathname))
    throw new WebPreviewError(400, 'Encoded separators are unavailable.');
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new WebPreviewError(400, 'Invalid path encoding.');
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded))
    throw new WebPreviewError(400, 'Invalid request path.');
  const parts = decoded.slice(1).split('/');
  if (parts.at(-1) === '') parts.pop();
  if (parts.some((part) => !part || part.startsWith('.') || part.includes(':')))
    throw new WebPreviewError(403, 'Hidden files and traversal paths are unavailable.');
  return parts;
}

const embeddedExtensions = new Set([
  'html',
  'htm',
  'xhtml',
  'css',
  'js',
  'mjs',
  'json',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'ico',
  'bmp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
]);

export function embeddedFileAllowed(file: string): boolean {
  return embeddedExtensions.has(file.split('.').at(-1)?.toLowerCase() ?? '');
}

export function htmlFile(file: string): boolean {
  return /\.(?:html?|xhtml)$/i.test(file);
}

/** `scripts: false` serves a page made from a file's own parts: it runs nothing, loads nothing
 * but its capability's parts, and its frame's sandbox has no tokens. */
export function responseHeaders(
  file: string,
  capability?: string,
  scripts = true,
): Record<string, string> {
  const mime = lookup(file) || 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': /^(text\/|application\/(javascript|json))/.test(mime)
      ? mime + '; charset=utf-8'
      : mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': capability ? 'cross-origin' : 'same-origin',
  };
  if (capability && !scripts) {
    const origin = `viewer-html://${capability}`;
    headers['Content-Security-Policy'] = [
      'sandbox',
      "default-src 'none'",
      `style-src ${origin} 'unsafe-inline'`,
      `img-src ${origin} data:`,
      `font-src ${origin} data:`,
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      'frame-ancestors viewer-app: http://127.0.0.1:* http://localhost:*',
    ].join('; ');
    headers['X-DNS-Prefetch-Control'] = 'off';
    headers['Access-Control-Allow-Origin'] = 'null';
    headers.Vary = 'Origin';
  } else if (capability) {
    const origin = `viewer-html://${capability}`;
    headers['Content-Security-Policy'] = [
      'sandbox allow-scripts',
      "default-src 'none'",
      `script-src ${origin} 'unsafe-inline'`,
      `style-src ${origin} 'unsafe-inline'`,
      `img-src ${origin} data: blob:`,
      `font-src ${origin} data:`,
      `connect-src ${origin}`,
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      'frame-ancestors viewer-app: http://127.0.0.1:* http://localhost:*',
    ].join('; ');
    // The embedding sandbox deliberately has an opaque origin. The capability is the authority.
    headers['Access-Control-Allow-Origin'] = 'null';
    headers.Vary = 'Origin';
  }
  return headers;
}

export function byteRange(
  value: string | null,
  size: number,
): { start: number; end: number; partial: boolean } {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !size)
    throw new WebPreviewError(416, 'Invalid byte range.');
  let start = Number(match[1]);
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      throw new WebPreviewError(416, 'Invalid byte range.');
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new WebPreviewError(416, 'Invalid byte range.');
  return { start, end: Math.min(end, size - 1), partial: true };
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export function errorResponse(error: unknown): Response {
  const code = (error as NodeJS.ErrnoException)?.code;
  const status =
    error instanceof WebPreviewError
      ? error.status
      : code === 'ENOENT'
        ? 404
        : ['EACCES', 'EPERM', 'ELOOP'].includes(code ?? '')
          ? 403
          : 500;
  const messages: Record<number, string> = {
    400: 'Bad request',
    403: 'Forbidden',
    404: 'Not found',
    405: 'Method not allowed',
    410: 'Preview closed',
    413: 'Asset too large',
    416: 'Range not satisfiable',
    429: 'Too many requests',
    503: 'Service unavailable',
  };
  return new Response(messages[status] ?? 'Request failed', {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 405 ? { Allow: 'GET, HEAD' } : {}),
    },
  });
}

export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error('Request cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
