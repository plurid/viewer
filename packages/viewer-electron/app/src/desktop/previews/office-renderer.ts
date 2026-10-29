import { BrowserWindow, session, type Session } from 'electron';
import { randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { Decoder } from './derived';
import {
  isOfficeFormat,
  officeLayoutMetadataSchema,
  type OfficeLayoutMetadata,
} from '../../domain/previews/documents/layout';
import { verifyOfficeRuntime } from './office-assets';
import { officeInput } from './office-input';
import { createOfficeJob, officeFileName, type OfficeRenderOptions } from './office-job';
import { officeCSP, officeMain, officePage, officeThread } from './office-page';
import {
  officeInputLimit,
  officeOutputLimit,
  officeRuntimeFiles,
  officeRuntimeVersion,
} from './office-runtime-manifest';
import { isolatedContent } from '../windows/web-content-policy';

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

interface OfficeTask {
  input: Buffer;
  extension: string;
  job: ReturnType<typeof createOfficeJob>;
}

/**
 * One engine for one document: a sandboxed window and a nonce-protected loopback server. Closing
 * or cancelling destroys the engine, its RAM files and its workers. No host filesystem mount,
 * Node/preload, app IPC, downloads or remote requests.
 *
 * Loading the engine takes seconds, so it can start before its document is chosen: the server
 * holds the engine's request for its input until a document is assigned. An engine is still
 * destroyed after its one document.
 */
class OfficeEngine {
  private task?: OfficeTask;
  private held: (() => void)[] = [];
  private metadata?: OfficeLayoutMetadata;
  private finish!: (bytes: Buffer) => void;
  private fail!: (error: Error) => void;
  private readonly result: Promise<Buffer>;
  private readonly nonce = randomBytes(24).toString('hex');
  private readonly server: Server;
  private window?: BrowserWindow;
  private origin = '';
  failed = false;
  constructor(private directory: string) {
    this.result = new Promise<Buffer>((resolve, reject) => {
      this.finish = resolve;
      this.fail = (error) => {
        this.failed = true;
        reject(error);
      };
    });
    // Install a handler before setup: cancellation can arrive during listen/load.
    void this.result.catch(() => {});
    this.server = createServer((request, response) => this.serve(request, response));
    this.server.maxConnections = 24;
    this.server.requestTimeout = 45000;
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Office renderer could not start.');
    this.origin = `http://127.0.0.1:${address.port}`;
    activeOrigins.add(this.origin);
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        ...isolatedContent,
        session: isolatedOfficeSession(),
        backgroundThrottling: false,
      },
    });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== `${this.origin}/${this.nonce}/`) event.preventDefault();
    });
    window.webContents.once('render-process-gone', () =>
      this.fail(new Error('The Office renderer stopped. Retry the layout preview.')),
    );
    window.once('closed', () =>
      this.fail(new Error('The Office renderer closed. Retry the layout preview.')),
    );
    void window
      .loadURL(`${this.origin}/${this.nonce}/`)
      .catch(() => this.fail(new Error('The bundled Office renderer could not be opened.')));
  }
  /** Gives the engine its one document and waits for the PDF. */
  async run(
    task: OfficeTask,
    signal: AbortSignal,
    outer: AbortSignal,
  ): Promise<{ data: Buffer; office: OfficeLayoutMetadata }> {
    const cancel = () =>
      this.fail(
        new Error(
          outer.aborted
            ? 'Office layout preview cancelled.'
            : 'Office layout exceeded 45 seconds. Try Reading or Sheet view, or retry the layout.',
        ),
      );
    signal.addEventListener('abort', cancel, { once: true });
    try {
      this.task = task;
      for (const release of this.held.splice(0)) release();
      return { data: await this.result, office: this.metadata! };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  async destroy(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    activeOrigins.delete(this.origin);
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
  private serve(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', officeCSP);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const prefix = `/${this.nonce}/`;
    const name = request.url?.startsWith(prefix) ? request.url.slice(prefix.length) : undefined;
    if (name === undefined || (request.headers.origin && request.headers.origin !== this.origin)) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET' && (name === 'input' || name === 'job')) {
      // the engine has loaded and waits here until it is given its document
      const task = this.task;
      if (!task) {
        this.held.push(() => this.serve(request, response));
        return;
      }
      if (name === 'input') {
        response.setHeader('X-Office-Format', task.extension);
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(task.input);
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(task.job));
      }
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
          this.fail(new Error('The Office layout exceeds its 32 MB output limit.'));
          request.destroy();
        } else chunks.push(chunk);
      });
      request.on('end', () => {
        response.end('ok');
        const bytes = Buffer.concat(chunks);
        if (name === 'metadata') {
          try {
            this.metadata = officeLayoutMetadataSchema.parse(JSON.parse(bytes.toString()));
          } catch {
            this.fail(new Error('The Office renderer returned invalid worksheet metadata.'));
          }
        } else if (
          name === 'result' &&
          this.metadata &&
          bytes.subarray(0, 5).toString() === '%PDF-'
        )
          this.finish(bytes);
        else
          this.fail(
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
    if (!runtimeFiles.has(name)) {
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
    createReadStream(path.join(this.directory, name))
      .on('error', () => {
        response.destroy();
        this.fail(new Error('A bundled Office asset could not be read.'));
      })
      .pipe(response);
  }
}

const runtimeFiles = new Set<string>(officeRuntimeFiles.map(([name]) => name));
const scripts = new Map([
  ['', ['text/html', officePage]],
  ['office-main.js', ['application/javascript', officeMain]],
  ['office-thread.js', ['application/javascript', officeThread]],
]);

/** How long a started engine waits for a document before it is closed. */
const spareLifetime = 60_000;
let spare:
  | { directory: string; engine: OfficeEngine; started: Promise<void>; expiry: NodeJS.Timeout }
  | undefined;

function discardSpare(): void {
  if (!spare) return;
  const { engine, started, expiry } = spare;
  spare = undefined;
  clearTimeout(expiry);
  void started.finally(() => engine.destroy()).catch(() => {});
}

/** Starts an engine for the next Office document, so its layout does not wait for the engine to
 * load. Unused, it closes after a minute. */
export function warmOffice(directory: string): void {
  if (spare?.directory === directory && !spare.engine.failed) {
    clearTimeout(spare.expiry);
    spare.expiry = setTimeout(discardSpare, spareLifetime);
    return;
  }
  discardSpare();
  const engine = new OfficeEngine(directory);
  const started = engine.start();
  started.catch(() => {});
  spare = { directory, engine, started, expiry: setTimeout(discardSpare, spareLifetime) };
}

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
  // a started engine of this runtime takes the document; otherwise one starts now
  let engine: OfficeEngine | undefined;
  let started: Promise<void> | undefined;
  if (spare?.directory === directory && !spare.engine.failed) {
    ({ engine, started } = spare);
    clearTimeout(spare.expiry);
    spare = undefined;
  } else {
    engine = new OfficeEngine(directory);
    started = engine.start();
  }
  try {
    await started;
    signal.throwIfAborted();
    return await engine.run({ input, extension, job }, signal, outer);
  } finally {
    await engine.destroy();
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
    const extension = source.format ?? path.extname(source.file).slice(1).toLowerCase();
    try {
      const result = await renderOffice(
        directory,
        await officeInput(source, signal),
        extension,
        signal,
        { name: officeFileName(path.basename(source.file), extension), sheet: sheet || undefined },
      );
      return { ...result, extension: 'pdf', kind: 'office', decoder: officeRuntimeVersion };
    } finally {
      // people read several documents in a row and pass some on the way: whether this one
      // finished or was left, the next one finds its engine started
      warmOffice(directory);
    }
  };
}

/** Saves an Office document as the PDF its layout preview shows, with every sheet of a workbook.
 * The source is only read; the PDF is written to the operation's new output. */
export function officePDFCopy(directory: string) {
  return async (source: string, output: string, signal: AbortSignal): Promise<void> => {
    await verifyOfficeRuntime(directory).catch(() => {
      throw new Error('The bundled Office renderer is missing or damaged.');
    });
    const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    let input: Buffer;
    try {
      input = await officeInput({ file: source, handle, info: await handle.stat() }, signal);
    } finally {
      await handle.close();
    }
    const { data } = await renderOffice(
      directory,
      input,
      path.extname(source).slice(1).toLowerCase(),
      signal,
      { name: path.basename(source), whole: true },
    );
    await writeFile(output, data, { flag: 'wx', mode: 0o644 });
  };
}
