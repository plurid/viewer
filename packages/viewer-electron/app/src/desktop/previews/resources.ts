import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { open, realpath, stat, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { lookup } from 'mime-types';
import { mediaDemuxer } from '../transforms/media';
import type { Resource, ResourceRead } from '../../domain/contracts';
import { absolute, entry } from '../files/filesystem';
import { imageDimensions, readImageDimensions } from './image-dimensions';
import { epubImagePath, epubImageLimit } from '../../domain/previews/documents/epub';
import { Archives } from './archives';
import { PreviewWork, previewContains, type PreviewScope } from './preview-work';
import { fileCoordination } from '../files/file-coordination';
import { modelFormats } from '../../domain/previews/models/formats';
import {
  cameraRawFormats,
  type ImageRenditionRequest,
} from '../../domain/previews/images/rendered';
import type { DerivedPreviews, DerivedMode } from './derived';
import {
  carriesThumbnail,
  isOfficeFormat,
  openDocumentThumbnail,
  type OfficeLayoutRequest,
} from '../../domain/previews/documents/layout';
import { gzipLimits, gzipMember } from '../../domain/files/containers';
import { xmlEncoding } from '../../domain/previews/data/xml';
import type { SQLiteReply, SQLiteRequest } from '../../domain/previews/data/sqlite';
import {
  confirmedFormats,
  confirms,
  directoryProbe,
  identifyBytes,
  identifyProbe,
} from '../../domain/files/signatures';
import { byteRange, WebPreviewError } from './web/policy';
import { readSQLite } from './sqlite';

interface Grant {
  dispose?(): void;
  resource: Resource;
  authority?: string;
  root?: string;
  file?: string;
  data?: Buffer;
  archiveChildren: Set<string>;
  assets?: Set<string>;
  /** A format the file's own bytes confirmed, for a file whose name does not say it, and the
   * version of the file they were read from. */
  format?: { extension: string; version: string };
}
const MAX_READ = 4 * 1024 * 1024;
/** The extension a granted file is read as: the format its bytes confirmed, or its own. */
const grantExtension = (grant: Grant) => grant.format?.extension ?? grant.resource.entry.extension;
const fileVersion = (info: Stats) =>
  JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
/** At most `length` bytes of an open file, from `at`. */
const readAt = async (file: FileHandle, at: number, length: number) => {
  const bytes = Buffer.alloc(length);
  return bytes.subarray(0, (await file.read(bytes, 0, length, at)).bytesRead);
};
/** The bundled FFmpeg reads the container; the decoder still probes what it holds. */
const hasDemuxer = (extension: string) => {
  try {
    return !!mediaDemuxer(extension);
  } catch {
    return false;
  }
};
export class Resources {
  private grants = new Map<string, Grant>();
  private streams = new Map<string, Map<Readable, string>>();
  /** Background work for a preview stops when the preview releases its resource. */
  private aborts = new Map<string, AbortController>();
  private work = new PreviewWork();
  private pending = new Map<string, AbortController>();
  private documentRequests = new Map<string, { resource: string; abort: AbortController }>();
  readonly archives = new Archives();
  constructor(
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    /** Optional renderer adapter for tests/other platforms. macOS uses private images. */
    private render?: (
      file: string,
      signal: AbortSignal,
    ) => Promise<{ data: Buffer; extension: string }>,
    private renditionTimeout = 12000,
    private derived?: DerivedPreviews,
    private images?: DerivedPreviews,
    private office?: DerivedPreviews,
    /** The app reads databases in its preview worker; tests read them here. */
    private database: (
      file: string,
      request: SQLiteRequest,
      signal: AbortSignal,
    ) => Promise<SQLiteReply> = (file, request, signal) => readSQLite(file, request, { signal }),
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
    grant?.dispose?.();
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
    this.derived?.invalidate(root);
    this.images?.invalidate(root);
    this.office?.invalidate(root);
    return canonical.then((actual) => {
      if (actual && actual !== root) this.clearKnown(actual);
      if (actual && actual !== root) this.derived?.invalidate(actual);
      if (actual && actual !== root) this.images?.invalidate(actual);
      if (actual && actual !== root) this.office?.invalidate(actual);
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
    await this.derived?.close();
    await this.images?.close();
    await this.office?.close();
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
  /** One cancellable read is bound to its existing preview capability. Cancelling
   * a page never releases the source or another preview's shared-cache subscriber. */
  documentRead<T>(
    id: string,
    requestID: string,
    read: (file: string, signal: AbortSignal, format: string) => Promise<T>,
  ): Promise<T> {
    const file = this.documentSource(id);
    const grant = this.get(id);
    if (this.documentRequests.has(requestID))
      throw new Error('This document request is already running.');
    if (this.documentRequests.size >= 32)
      throw new Error('Too many document pages are opening. Try again.');
    const request = { resource: id, abort: new AbortController() };
    this.documentRequests.set(requestID, request);
    const sourceSignal = this.signal(id);
    return this.work
      .track(
        this.paths(id),
        async (scope) => {
          const signal = AbortSignal.any([scope.signal, sourceSignal, request.abort.signal]);
          signal.throwIfAborted();
          if (grant.format) await this.unchanged(grant);
          const value = await read(file, signal, grantExtension(grant));
          signal.throwIfAborted();
          this.documentSource(id);
          scope.check();
          return value;
        },
        request.abort.signal,
      )
      .finally(() => {
        if (this.documentRequests.get(requestID) === request)
          this.documentRequests.delete(requestID);
      });
  }
  /** The extension a document is read as, for a read outside `documentRead`. */
  async documentFormat(id: string): Promise<string> {
    const grant = this.get(id);
    if (grant.format) await this.unchanged(grant);
    return grantExtension(grant);
  }
  /** A confirmed format holds for the version of the file its bytes were read from. */
  private async unchanged(grant: Grant): Promise<void> {
    const format = grant.format;
    await this.access([grant.file!]);
    const info = await lstat(grant.file!).catch(() => undefined);
    if (info && fileVersion(info) === format?.version) return;
    if (grant.format === format) grant.format = undefined;
    throw new Error('This file changed after Viewer read its format. Reopen its preview.');
  }
  /**
   * Reads a granted file as `extension` from now on, once its own first bytes say it is one, with a
   * compound file's directory. Show as asks this for a file whose name does not say its format; the
   * renderer's word is not taken.
   */
  confirmFormat(id: string, extension: string): Promise<Resource> {
    return this.work.track(this.paths(id), () =>
      this.coordinated(id, () => this.readFormat(id, extension)),
    );
  }
  private async readFormat(id: string, extension: string): Promise<Resource> {
    const grant = this.get(id);
    if (!grant.file || grant.data)
      throw new Error('Only a file on disk can be shown as another format.');
    if (!confirmedFormats.has(extension))
      throw new Error(`Show as cannot read a file as .${extension}.`);
    await this.access([grant.file]);
    const file = await open(
      fileCoordination.path(grant.file),
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    );
    let head: Buffer, directory: Buffer | undefined, info: Stats;
    try {
      info = await file.stat();
      if (!info.isFile()) throw new Error('This preview file is no longer a regular file.');
      head = await readAt(file, 0, Math.min(info.size, identifyProbe));
      const probe = directoryProbe(head, info.size);
      if (probe) directory = await readAt(file, probe.at, probe.length);
    } finally {
      await file.close();
    }
    if (!confirms(identifyBytes(head, grant.resource.entry.name, directory), extension))
      throw new Error(`The contents of this file do not match .${extension}.`);
    await this.access([grant.file]);
    if (this.get(id) !== grant) throw new Error('This preview resource has expired.');
    grant.format = { extension, version: fileVersion(info) };
    const { entry } = grant.resource;
    return {
      ...grant.resource,
      entry: { ...entry, extension, mime: lookup(extension) || entry.mime },
    };
  }
  cancelDocument(id: string, requestID: string): void {
    const request = this.documentRequests.get(requestID);
    if (request?.resource === id) request.abort.abort(new Error('Document page cancelled.'));
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
    // A byte-order mark names UTF-16 text, which Windows tools and macOS .strings files write: its
    // zero bytes read as binary without it.
    const marked =
      buffer[0] === 0xff && buffer[1] === 0xfe
        ? 'utf-16le'
        : buffer[0] === 0xfe && buffer[1] === 0xff
          ? 'utf-16be'
          : undefined;
    const encoding =
      marked ?? (grant.resource.entry.extension === 'xml' ? xmlEncoding(buffer) : 'utf-8');
    const binary =
      encoding === 'utf-8' &&
      (sample.includes(0) ||
        [...sample].filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length >
          sample.length / 20);
    if (grant.authority) await this.access([grant.authority]);
    this.get(id);
    return {
      text: binary ? '' : new TextDecoder(encoding).decode(buffer),
      binary,
      truncated: size > limit,
    };
  }
  archive(id: string) {
    return this.work.track(this.paths(id), () => this.coordinated(id, () => this.listArchive(id)));
  }
  private async listArchive(id: string) {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested archives are not supported yet.');
    await this.access([grant.file]);
    const member = gzipMember(grant.resource.entry.name);
    const entries = member
      ? await this.archives.gzip(grant.file, member, gzipLimits)
      : await this.archives.list(grant.file);
    this.get(id);
    return entries;
  }
  /** Tables or a page of rows from the database file this preview was granted. */
  sqlite(id: string, request: SQLiteRequest): Promise<SQLiteReply> {
    return this.work.track(this.paths(id), (scope) =>
      this.coordinated(id, () => this.readDatabase(id, request, scope.signal)),
    );
  }
  private async readDatabase(
    id: string,
    request: SQLiteRequest,
    scope: AbortSignal,
  ): Promise<SQLiteReply> {
    const grant = this.get(id);
    if (!grant.file || grant.data)
      throw new Error('Databases inside archives and comparisons are not previewed.');
    await this.access([grant.file]);
    const signal = AbortSignal.any([scope, this.signal(id)]);
    const reply = await this.database(fileCoordination.path(grant.file), request, signal);
    signal.throwIfAborted();
    await this.access([grant.file]);
    // A preview closed while its database was read cannot receive the rows.
    if (this.get(id) !== grant) throw new Error('This preview resource has expired.');
    return reply;
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
    const bookImage = grantExtension(grant) === 'epub' && epubImagePath(name);
    if (bookImage) {
      const listing = await this.archives.list(grant.file);
      const image = listing.entries.find((entry) => entry.name === name);
      if (!image?.previewable || image.size > epubImageLimit)
        throw new Error('This book illustration exceeds its preview limit.');
    }
    const member = gzipMember(grant.resource.entry.name);
    if (member && name !== member) throw new Error(`This gzip file holds only ${member}.`);
    let data: Buffer;
    if (member) data = await this.archives.gunzip(grant.file, gzipLimits);
    else if (name === openDocumentThumbnail.name && carriesThumbnail(grantExtension(grant)))
      data = await this.archives.readPNG(grant.file, name, openDocumentThumbnail);
    else data = await this.archives.read(grant.file, name);
    if (bookImage) {
      const dimensions = imageDimensions(data);
      if (!dimensions || dimensions.width * dimensions.height > 64000000)
        throw new Error('This book illustration has unsupported or oversized dimensions.');
    }
    this.get(id); // A parent closed while its entry was loading cannot leave an orphan grant.
    return this.dataChild(id, path.basename(name), `${grant.file} → ${name}`, data);
  }
  /** A preview of a file Chromium cannot decode, produced by a private decoder. */
  rendition(id: string, request?: ImageRenditionRequest): Promise<Resource> {
    const grant = this.get(id);
    if (cameraRawFormats.includes(grantExtension(grant)))
      return this.derivedRendition(
        id,
        request?.mode ?? 'camera',
        request?.requestID ?? randomUUID(),
      );
    if (request?.mode === 'raw')
      return Promise.reject(new Error('RAW rendering requires a camera RAW file.'));
    if (this.images) return this.derivedRendition(id, 'image', request?.requestID ?? randomUUID());
    return this.work.track(this.paths(id), (scope) =>
      this.coordinated(id, () => this.renderFile(id, scope.signal)),
    );
  }
  videoRendition(id: string, requestID: string): Promise<Resource> {
    const grant = this.get(id);
    if (!hasDemuxer(grantExtension(grant)))
      return Promise.reject(
        new Error('Choose a supported audio or video file for a compatibility preview.'),
      );
    return this.derivedRendition(id, 'video', requestID);
  }
  officeLayout(id: string, request: OfficeLayoutRequest): Promise<Resource> {
    if (!isOfficeFormat(grantExtension(this.get(id))))
      return Promise.reject(
        new Error('Choose a Word, Excel or PowerPoint file for Office layout preview.'),
      );
    return this.derivedRendition(id, 'office', request.requestID, request.sheet);
  }
  private derivedRendition(
    id: string,
    mode: DerivedMode,
    requestID: string,
    variant?: string,
  ): Promise<Resource> {
    const grant = this.get(id);
    const decoder = mode === 'office' ? this.office : mode === 'image' ? this.images : this.derived;
    if (!decoder) return Promise.reject(new Error('The local preview decoder is unavailable.'));
    return this.documentRead(id, requestID, async (file, signal, format) => {
      const lease = await decoder.read(file, mode, signal, 4096, variant, format);
      try {
        signal.throwIfAborted();
        this.get(id);
        const child = this.dataChild(
          id,
          grant.resource.entry.name + '.' + lease.value.extension,
          grant.resource.entry.path,
          lease.value.data,
        );
        child.derivation = { kind: lease.value.kind, decoder: lease.value.decoder };
        child.office = lease.value.office;
        this.get(child.id).dispose = lease.release;
        return child;
      } catch (error) {
        lease.release();
        throw error;
      }
    });
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
    const held = new Set(
      [...this.grants.values()].flatMap((item) => (item.data ? [item.data] : [])),
    );
    if (
      data.length > 64 * 1024 * 1024 ||
      (!held.has(data) &&
        [...held].reduce((total, bytes) => total + bytes.length, 0) + data.length >
          128 * 1024 * 1024)
    )
      throw new Error('The preview resource budget is full. Close a preview and try again.');
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
        if (grant.root && file !== grant.file && (lookup(file!) || '').startsWith('image/')) {
          // Reject oversized companion bitmaps before Chromium decodes them.
          // A later renderer budget also accounts for combined texture storage.
          if (actual.size > 64 * 1024 * 1024) return new Response(null, { status: 413 });
          const header = Buffer.alloc(Math.min(actual.size, 512000));
          const { bytesRead } = await opened.read(header, 0, header.length, 0);
          const dimensions = imageDimensions(header.subarray(0, bytesRead));
          if (dimensions && dimensions.width * dimensions.height * 4 > 128 * 1024 * 1024)
            return new Response(null, { status: 413 });
        }
      }
      this.get(url.hostname);
      const size = grant.data?.length ?? info!.size;
      let selected: ReturnType<typeof byteRange>;
      try {
        selected = byteRange(request.headers.get('range'), size);
      } catch (error) {
        if (!(error instanceof WebPreviewError)) throw error;
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      }
      const { start, end, partial } = selected;
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
