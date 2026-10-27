import { BrowserWindow, session, type Session } from 'electron';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import type { Decoder } from './derived';
import {
  isOfficeFormat,
  officeLayoutMetadataSchema,
  type OfficeLayoutMetadata,
} from '../../domain/previews/documents/layout';
import { verifyOfficeRuntime } from './office-assets';
import { officeInput } from './office-input';
import { createOfficeJob, type OfficeRenderOptions } from './office-job';
import { officeCSP, officeMain, officePage, officeThread } from './office-page';
import {
  officeInputLimit,
  officeOutputLimit,
  officeRuntimeFiles,
  officeRuntimeVersion,
} from './office-runtime-manifest';

export function officeRequestAllowed(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin || url.startsWith(`blob:${origin}/`);
  } catch {
    return false;
  }
}

const activeOrigins = new Set<string>();
let helperSession: Session | undefined;
function isolatedOfficeSession(): Session {
  if (helperSession) return helperSession;
  const isolated = session.fromPartition('viewer-office-renderer-v1', { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, reply) =>
    reply({
      cancel: ![...activeOrigins].some((origin) => officeRequestAllowed(details.url, origin)),
    }),
  );
  helperSession = isolated;
  return isolated;
}

/** Each cache miss owns one sandbox and one nonce-protected loopback server.
 * Closing/cancelling destroys the entire engine, its RAM files and its workers.
 * No host filesystem mount, Node/preload, app IPC, downloads or remote requests. */
export async function renderOffice(
  directory: string,
  input: Buffer,
  extension: string,
  outer: AbortSignal,
  options: OfficeRenderOptions = {},
): Promise<{ data: Buffer; office: OfficeLayoutMetadata }> {
  if (!isOfficeFormat(extension) || input.length > officeInputLimit)
    throw new Error(
      'Choose a Word, Excel or PowerPoint file smaller than 64 MB for layout preview.',
    );
  const job = createOfficeJob(extension, options);
  const signal = AbortSignal.any([outer, AbortSignal.timeout(45000)]);
  signal.throwIfAborted();
  const nonce = randomBytes(24).toString('hex');
  let window: BrowserWindow | undefined;
  let metadata: OfficeLayoutMetadata | undefined;
  let finish!: (bytes: Buffer) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<Buffer>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Install a handler before setup: cancellation can arrive during listen/load.
  void result.catch(() => {});
  const cancel = () =>
    fail(
      new Error(
        outer.aborted
          ? 'Office layout preview cancelled.'
          : 'Office layout exceeded 45 seconds. Try Reading or Sheet view, or retry the layout.',
      ),
    );
  signal.addEventListener('abort', cancel, { once: true });
  const files = new Set<string>(officeRuntimeFiles.map(([name]) => name));
  const scripts = new Map([
    ['', ['text/html', officePage]],
    ['office-main.js', ['application/javascript', officeMain]],
    ['office-thread.js', ['application/javascript', officeThread]],
  ]);
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', officeCSP);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const prefix = `/${nonce}/`;
    const name = request.url?.startsWith(prefix) ? request.url.slice(prefix.length) : undefined;
    if (name === undefined || (request.headers.origin && request.headers.origin !== origin)) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET' && name === 'input') {
      response.setHeader('X-Office-Format', extension);
      response.setHeader('Content-Type', 'application/octet-stream');
      response.end(input);
      return;
    }
    if (request.method === 'GET' && name === 'job') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(job));
      return;
    }
    if (
      request.method === 'POST' &&
      (name === 'result' || name === 'failed' || name === 'metadata')
    ) {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (name === 'result' ? officeOutputLimit : 256 * 1024)) {
          fail(new Error('The Office layout exceeds its 32 MB output limit.'));
          request.destroy();
        } else chunks.push(chunk);
      });
      request.on('end', () => {
        response.end('ok');
        const bytes = Buffer.concat(chunks);
        if (name === 'metadata') {
          try {
            metadata = officeLayoutMetadataSchema.parse(JSON.parse(bytes.toString()));
          } catch {
            fail(new Error('The Office renderer returned invalid worksheet metadata.'));
          }
        } else if (name === 'result' && metadata && bytes.subarray(0, 5).toString() === '%PDF-')
          finish(bytes);
        else
          fail(
            new Error(
              'This document could not be rendered. It may be protected or damaged. Try the available Reading or Sheet view.',
            ),
          );
      });
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    const script = scripts.get(name);
    if (script) {
      response.setHeader('Content-Type', script[0]!);
      response.end(script[1]);
      return;
    }
    if (!files.has(name)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      name.endsWith('.wasm')
        ? 'application/wasm'
        : name.endsWith('.js')
          ? 'application/javascript'
          : 'application/octet-stream',
    );
    createReadStream(path.join(directory, name))
      .on('error', () => {
        response.destroy();
        fail(new Error('A bundled Office asset could not be read.'));
      })
      .pipe(response);
  });
  server.maxConnections = 24;
  server.requestTimeout = 45000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Office renderer could not start.');
    origin = `http://127.0.0.1:${address.port}`;
    signal.throwIfAborted();
    activeOrigins.add(origin);
    const isolated = isolatedOfficeSession();
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== `${origin}/${nonce}/`) event.preventDefault();
    });
    window.webContents.once('render-process-gone', () =>
      fail(new Error('The Office renderer stopped. Retry the layout preview.')),
    );
    window.once('closed', () =>
      fail(new Error('The Office renderer closed. Retry the layout preview.')),
    );
    void window
      .loadURL(`${origin}/${nonce}/`)
      .catch(() => fail(new Error('The bundled Office renderer could not be opened.')));
    return { data: await result, office: metadata! };
  } finally {
    signal.removeEventListener('abort', cancel);
    if (window && !window.isDestroyed()) window.destroy();
    activeOrigins.delete(origin);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export function officeDecoder(directory: string): Decoder {
  let verified: Promise<void> | undefined;
  return async (source, mode, signal, _size, sheet) => {
    if (mode !== 'office' || source.info.size > officeInputLimit)
      throw new Error(
        'Office layout previews support Word, Excel and PowerPoint files up to 64 MB.',
      );
    verified ??= verifyOfficeRuntime(directory).catch(() => {
      verified = undefined;
      throw new Error(
        'The bundled Office renderer is missing or damaged. Reading and Sheet views remain available.',
      );
    });
    await verified;
    signal.throwIfAborted();
    const result = await renderOffice(
      directory,
      await officeInput(source, signal),
      path.extname(source.file).slice(1).toLowerCase(),
      signal,
      { name: path.basename(source.file), sheet: sheet || undefined },
    );
    return { ...result, extension: 'pdf', kind: 'office', decoder: officeRuntimeVersion };
  };
}
