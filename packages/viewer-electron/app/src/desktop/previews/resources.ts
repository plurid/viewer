import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { lookup } from 'mime-types';
import type { Resource, ResourceRead } from '../../domain/contracts';
import { absolute, entry } from '../files/filesystem';
import { imageDimensions, readImageDimensions } from './image-dimensions';
import { Archives } from './archives';
import { PreviewWork, previewContains, type PreviewScope } from './preview-work';
import { fileCoordination } from '../files/file-coordination';
import { modelFormats } from '../../domain/previews/models/formats';

interface Grant {
  resource: Resource;
  authority?: string;
  root?: string;
  file?: string;
  data?: Buffer;
  archiveChildren: Set<string>;
  assets?: Set<string>;
}
const MAX_READ = 4 * 1024 * 1024;
export class Resources {
  private grants = new Map<string, Grant>();
  private streams = new Map<string, Map<Readable, string>>();
  /** Background work for a preview stops when the preview releases its resource. */
  private aborts = new Map<string, AbortController>();
  private work = new PreviewWork();
  private pending = new Map<string, AbortController>();
  readonly archives = new Archives();
  constructor(
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    /** Renders formats the renderer cannot decode; see `quick-look-render.ts`. */
    private render?: (
      file: string,
      signal: AbortSignal,
    ) => Promise<{ data: Buffer; extension: string }>,
    private renditionTimeout = 12000,
  ) {}
  grant(file: string, requestID?: string): Promise<Resource> {
    if (requestID && this.pending.has(requestID))
      return Promise.reject(new Error('This preview request is already running.'));
    const abort = new AbortController();
    if (requestID) this.pending.set(requestID, abort);
    let owned: Resource | undefined;
    return this.work
      .track(
        [file],
        async (scope) => {
          owned = await this.grantFile(file, scope);
          return owned;
        },
        abort.signal,
      )
      .then((resource) => {
        if (abort.signal.aborted) {
          this.release(resource.id);
          abort.signal.throwIfAborted();
        }
        return resource;
      })
      .catch((error) => {
        if (owned) this.release(owned.id);
        throw error;
      })
      .finally(() => {
        if (requestID) this.pending.delete(requestID);
      });
  }
  /** Immutable repository bytes are readable resources, never editable filesystem files. */
  async grantBytes(authority: string, name: string, data: Buffer): Promise<Resource> {
    await this.access([authority]);
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const held = [...this.grants.values()].reduce(
      (size, grant) => size + (grant.data?.length ?? 0),
      0,
    );
    if (data.length > 64 * 1024 * 1024 || held + data.length > 128 * 1024 * 1024)
      throw new Error(
        'The comparison resource budget is full. Close a comparison before opening another.',
      );
    const id = randomUUID();
    const resource: Resource = {
      id,
      url: `viewer-resource://${id}/asset/${encodeURIComponent(path.basename(name))}`,
      dimensions: imageDimensions(data),
      entry: {
        path: path.join(authority, name),
        name: path.basename(name),
        parent: authority,
        extension: path.extname(name).slice(1).toLowerCase(),
        kind: 'file',
        directory: false,
        size: data.length,
        modified: 0,
        created: 0,
        hidden: false,
        mime: lookup(name) || 'application/octet-stream',
        identity: id,
      },
    };
    this.grants.set(id, { resource, authority, data, archiveChildren: new Set() });
    return resource;
  }
  private async grantFile(file: string, scope: PreviewScope): Promise<Resource> {
    scope.check();
    await this.access([file]);
    const actual = await realpath(file);
    scope.add(actual);
    await this.access([actual]);
    const info = await stat(actual);
    if (!info.isFile()) throw new Error('Choose a regular file to preview.');
    return fileCoordination.run(
      [{ path: actual, mode: 'read' }],
      async (signal) => {
        signal?.throwIfAborted();
        await this.access([fileCoordination.path(actual)]);
        scope.check();
        return this.grantCoordinated(file, scope);
      },
      scope.signal,
    );
  }
  private async grantCoordinated(file: string, scope: PreviewScope): Promise<Resource> {
    await this.access([file]);
    scope.check();
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const item = await entry(absolute(file));
    if (item.directory || (item.kind !== 'file' && item.kind !== 'symlink'))
      throw new Error('Choose a regular file to preview.');
    const actual = await realpath(file);
    scope.add(actual);
    const target = await stat(actual);
    if (!target.isFile()) throw new Error('Special devices and sockets cannot be previewed.');
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const id = randomUUID();
    const resource = {
      dimensions: item.mime.startsWith('image/')
        ? await readImageDimensions(fileCoordination.path(actual)).catch(() => undefined)
        : undefined,
      id,
      url: `viewer-resource://${id}/asset/${encodeURIComponent(path.basename(actual))}`,
      entry: {
        ...item,
        size: target.size,
        extension: item.extension || path.extname(actual).slice(1).toLowerCase(),
        mime: item.mime === 'application/octet-stream' ? lookup(actual) || item.mime : item.mime,
      },
    };
    await this.access([actual]);
    scope.check();
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    this.grants.set(id, {
      resource,
      authority: actual,
      file: actual,
      // Only 3D models load companion files (textures, materials) beside them; any
      // other preview may read exactly its own file.
      root: modelFormats.includes(resource.entry.extension) ? path.dirname(actual) : undefined,
      archiveChildren: new Set(),
      assets: new Set(),
    });
    return resource;
  }
  /** Aborted when the resource is released, so a closed preview's extraction stops. */
  signal(id: string): AbortSignal {
    this.get(id);
    let abort = this.aborts.get(id);
    if (!abort) this.aborts.set(id, (abort = new AbortController()));
    return abort.signal;
  }
  release(id: string): void {
    this.pending.get(id)?.abort(new Error('Preview closed.'));
    this.aborts.get(id)?.abort();
    this.aborts.delete(id);
    for (const stream of this.streams.get(id)?.keys() ?? []) stream.destroy();
    const grant = this.grants.get(id);
    if (grant?.file) this.archives.release(grant.file);
    for (const child of grant?.archiveChildren ?? []) this.release(child);
    this.grants.delete(id);
  }
  private paths(id: string): string[] {
    const grant = this.grants.get(id);
    return grant
      ? [
          grant.resource.entry.path,
          ...(grant.authority ? [grant.authority] : []),
          ...(grant.assets ?? []),
        ]
      : [];
  }
  async affected(root: string): Promise<string[]> {
    const actual = await realpath(root).catch(() => root);
    return [...this.grants.keys()].filter((id) =>
      this.paths(id).some((file) => previewContains(root, file) || previewContains(actual, file)),
    );
  }
  private clearKnown(root?: string): void {
    for (const id of this.grants.keys())
      if (!root || this.paths(id).some((file) => previewContains(root, file))) this.release(id);
    for (const streams of this.streams.values())
      for (const [stream, file] of streams)
        if (!root || previewContains(root, file)) stream.destroy();
  }
  clear(root?: string): Promise<string | undefined> {
    const canonical = this.work.invalidate(root);
    this.clearKnown(root);
    return canonical.then((actual) => {
      if (actual && actual !== root) this.clearKnown(actual);
      return actual;
    });
  }
  async quiesce(root?: string): Promise<void> {
    const before = [...this.streams.values()].flatMap((streams) => [...streams]);
    const actual = await this.clear(root);
    const streams = before
      .filter(
        ([, file]) =>
          !root || previewContains(root, file) || (!!actual && previewContains(actual, file)),
      )
      .map(([stream]) => stream);
    const closed = streams
      .filter((stream) => !stream.closed)
      .map((stream) => new Promise<void>((resolve) => stream.once('close', resolve)));
    await Promise.allSettled([...closed, this.work.drain()]);
  }
  private get(id: string): Grant {
    const grant = this.grants.get(id);
    if (!grant) throw new Error('This preview resource has expired.');
    return grant;
  }
  async close(): Promise<void> {
    this.work.stop();
    await this.quiesce();
  }
  /** The file behind a previewed PDF; entries inside archives are not files to print. */
  async printableFile(id: string): Promise<string> {
    const grant = this.get(id);
    if (!grant.file || grant.resource.entry.extension !== 'pdf')
      throw new Error('Only PDF files on disk can be printed.');
    await this.access([grant.file]);
    return grant.file;
  }
  /** The file a preview shows, to edit where it is: a link's target, never an archive entry. */
  editableFile(id: string): string {
    const grant = this.get(id);
    if (!grant.file || grant.data)
      throw new Error(
        'This preview shows an entry inside an archive, which is not edited in place.',
      );
    return grant.file;
  }
  documentSource(id: string): string {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested document extraction is unavailable.');
    return grant.file;
  }
  read(id: string, requested = MAX_READ): Promise<ResourceRead> {
    return this.work.track(this.paths(id), () =>
      this.coordinated(id, () => this.readBounded(id, requested)),
    );
  }
  private async coordinated<T>(id: string, work: () => Promise<T>): Promise<T> {
    const grant = this.get(id);
    return grant.file
      ? fileCoordination.run([{ path: grant.file, mode: 'read' }], async (signal) => {
          signal?.throwIfAborted();
          await this.access([fileCoordination.path(grant.file!)]);
          this.get(id);
          return work();
        })
      : work();
  }
  private async readBounded(id: string, requested = MAX_READ): Promise<ResourceRead> {
    const grant = this.get(id);
    if (grant.authority) await this.access([grant.authority]);
    if (this.get(id) !== grant) throw new Error('This preview resource has expired.');
    const limit = Math.max(1, Math.min(requested, MAX_READ));
    let buffer: Buffer;
    let size: number;
    if (grant.data) {
      buffer = grant.data.subarray(0, limit);
      size = grant.data.length;
    } else {
      const file = await open(
        fileCoordination.path(grant.file!),
        constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
      );
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new Error('This preview file is no longer a regular file.');
        size = info.size;
        buffer = Buffer.alloc(Math.min(size, limit));
        await file.read(buffer, 0, buffer.length, 0);
      } finally {
        await file.close();
      }
    }
    const sample = buffer.subarray(0, 8192);
    const binary =
      sample.includes(0) ||
      [...sample].filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length >
        sample.length / 20;
    if (grant.authority) await this.access([grant.authority]);
    this.get(id);
    return { text: binary ? '' : buffer.toString('utf8'), binary, truncated: size > limit };
  }
  archive(id: string) {
    return this.work.track(this.paths(id), () => this.coordinated(id, () => this.listArchive(id)));
  }
  private async listArchive(id: string) {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested archives are not supported yet.');
    await this.access([grant.file]);
    const entries = await this.archives.list(grant.file);
    this.get(id);
    return entries;
  }
  archiveEntry(id: string, name: string): Promise<Resource> {
    return this.work.track(this.paths(id), () =>
      this.coordinated(id, () => this.readArchiveEntry(id, name)),
    );
  }
  private async readArchiveEntry(id: string, name: string): Promise<Resource> {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested archives are not supported yet.');
    await this.access([grant.file]);
    const data = await this.archives.read(grant.file, name);
    this.get(id); // A parent closed while its entry was loading cannot leave an orphan grant.
    return this.dataChild(id, path.basename(name), `${grant.file} → ${name}`, data);
  }
  /** A preview of a file Chromium cannot decode, rendered by the system and held in memory. */
  rendition(id: string): Promise<Resource> {
    return this.work.track(this.paths(id), (scope) =>
      this.coordinated(id, () => this.renderFile(id, scope.signal)),
    );
  }
  private async renderFile(id: string, scope: AbortSignal): Promise<Resource> {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Rendered previews need a file on disk.');
    if (!this.render) throw new Error('Rendered previews are unavailable here.');
    await this.access([grant.file]);
    const deadline = new AbortController();
    const signal = AbortSignal.any([scope, this.signal(id), deadline.signal]);
    signal.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    const { data, extension } = await new Promise<{ data: Buffer; extension: string }>(
      (resolve, reject) => {
        cancel = () => reject(signal.reason ?? new Error('Preview closed.'));
        timer = setTimeout(
          () =>
            deadline.abort(
              new Error(
                'The macOS image preview timed out. Retry the preview or open the file in its original app.',
              ),
            ),
          this.renditionTimeout,
        );
        signal.addEventListener('abort', cancel, { once: true });
        void Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return this.render!(fileCoordination.path(grant.file!), signal);
          })
          .then(resolve, reject);
        if (signal.aborted) cancel();
      },
    ).finally(() => {
      // The native service may never answer. Cleanup follows our own completion
      // so releasing a preview and application quiescence cannot wait on it.
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    });
    // A preview closed while rendering cannot leave an orphan grant.
    this.get(id);
    const name = `${grant.resource.entry.name}.${extension}`;
    return this.dataChild(id, name, grant.resource.entry.path, data);
  }
  /** Serves in-memory bytes derived from a granted file; released with that file's grant. */
  private dataChild(id: string, basename: string, label: string, data: Buffer): Resource {
    const grant = this.get(id);
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const childID = randomUUID();
    const resource: Resource = {
      dimensions: imageDimensions(data),
      id: childID,
      url: `viewer-resource://${childID}/asset/${encodeURIComponent(basename)}`,
      entry: {
        ...grant.resource.entry,
        name: basename,
        path: label,
        size: data.length,
        extension: path.extname(basename).slice(1).toLowerCase(),
        mime: lookup(basename) || 'application/octet-stream',
        kind: 'file',
      },
    };
    this.grants.set(childID, {
      resource,
      data,
      authority: grant.authority,
      archiveChildren: new Set(),
    });
    grant.archiveChildren.add(childID);
    return resource;
  }
  response(request: Request): Promise<Response> {
    return this.work
      .track(this.paths(new URL(request.url).hostname), (scope) => this.respond(request, scope))
      .catch(
        () => new Response('File is unavailable or this resource has expired.', { status: 404 }),
      );
  }
  private async respond(request: Request, scope: PreviewScope): Promise<Response> {
    let opened: FileHandle | undefined;
    let claim: Awaited<ReturnType<typeof fileCoordination.acquire>> | undefined;
    try {
      const url = new URL(request.url);
      const grant = this.get(url.hostname);
      if (grant.authority) await this.access([grant.authority]);
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const relative = decodeURIComponent(url.pathname.replace(/^\/asset\//, ''));
      if (
        url.pathname === relative ||
        !relative ||
        relative.includes('\0') ||
        relative.includes('\\')
      )
        return new Response(null, { status: 403 });
      let file = grant.file;
      if (grant.root) {
        const resolved = path.resolve(grant.root, relative);
        if (resolved !== grant.root && !resolved.startsWith(grant.root + path.sep))
          return new Response(null, { status: 403 });
        file = await realpath(resolved);
        if (!file.startsWith(grant.root + path.sep)) return new Response(null, { status: 403 });
      } else if (relative !== grant.resource.entry.name) return new Response(null, { status: 404 });
      // The granted path must still be the same real file, not a substituted link.
      else if (file && !grant.data && (await realpath(file)) !== file)
        return new Response(null, { status: 403 });
      if (file) scope.add(file);
      if (file && file !== grant.file) {
        if ((grant.assets?.size ?? 0) >= 256 && !grant.assets?.has(file))
          return new Response(null, { status: 429 });
        grant.assets?.add(file);
      }
      if (!grant.data) await this.access([file!]);
      if (file && !grant.data) {
        claim = await fileCoordination.acquire(
          [{ path: file, mode: 'read', stream: true }],
          request.signal,
        );
        claim.signal?.throwIfAborted();
        scope.check();
        file = claim.path(file);
        await this.access([file]);
        this.get(url.hostname);
      }
      const info = grant.data ? null : await stat(file!);
      if (info && !info.isFile()) return new Response(null, { status: 403 });
      if (info) {
        opened = await open(
          file!,
          constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
        );
        const actual = await opened.stat();
        if (!actual.isFile() || actual.dev !== info.dev || actual.ino !== info.ino)
          return new Response(null, { status: 403 });
      }
      this.get(url.hostname);
      const size = grant.data?.length ?? info!.size;
      let start = 0,
        end = size - 1,
        partial = false;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]))
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` },
          });
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (
          start > end ||
          start >= size ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        )
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` },
          });
        partial = true;
      }
      const headers: Record<string, string> = {
        'Content-Type': lookup(relative) || 'application/octet-stream',
        'Content-Length': String(Math.max(0, end - start + 1)),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'no-store',
      };
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      if (request.method === 'HEAD' || !size)
        return new Response(null, { status: partial ? 206 : 200, headers });
      let body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>;
      if (grant.data) body = new Uint8Array(grant.data.subarray(start, end + 1));
      else {
        const stream = opened!.createReadStream({ start, end, autoClose: true });
        const held = claim;
        const cancelled = () => stream.destroy(new Error('File access was cancelled.'));
        held?.signal?.addEventListener('abort', cancelled, { once: true });
        stream.on('error', () => {});
        const streams = this.streams.get(url.hostname) ?? new Map<Readable, string>();
        streams.set(stream, file!);
        this.streams.set(url.hostname, streams);
        stream.once('close', () => {
          held?.signal?.removeEventListener('abort', cancelled);
          void held?.release().catch(() => {});
          streams.delete(stream);
          if (!streams.size) this.streams.delete(url.hostname);
        });
        claim = undefined;
        body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      }
      opened = undefined; // The stream now owns and closes the descriptor, including cancellation.
      return new Response(body, { status: partial ? 206 : 200, headers });
    } catch {
      return new Response('File is unavailable or this resource has expired.', { status: 404 });
    } finally {
      await opened?.close();
      await claim?.release();
    }
  }
}
