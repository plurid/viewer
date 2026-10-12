import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { lookup } from 'mime-types';
import type { Resource, ResourceRead } from '../domain/contracts';
import { absolute, entry } from './filesystem';
import { imageDimensions, readImageDimensions } from './image-dimensions';
import { Archives } from './archives';

interface Grant {
  resource: Resource;
  root?: string;
  file?: string;
  data?: Buffer;
  archiveChildren: Set<string>;
}
const MAX_READ = 4 * 1024 * 1024;
export class Resources {
  private grants = new Map<string, Grant>();
  readonly archives = new Archives();
  constructor(private access: (files: readonly string[]) => Promise<void> = async () => {}) {}
  async grant(file: string): Promise<Resource> {
    await this.access([file]);
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const item = await entry(absolute(file));
    if (item.directory || (item.kind !== 'file' && item.kind !== 'symlink'))
      throw new Error('Choose a regular file to preview.');
    const actual = await realpath(file);
    const target = await stat(actual);
    if (!target.isFile()) throw new Error('Special devices and sockets cannot be previewed.');
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const id = randomUUID();
    const resource = {
      dimensions: item.mime.startsWith('image/')
        ? await readImageDimensions(actual).catch(() => undefined)
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
    this.grants.set(id, {
      resource,
      file: actual,
      root: path.dirname(actual),
      archiveChildren: new Set(),
    });
    return resource;
  }
  release(id: string): void {
    const grant = this.grants.get(id);
    if (grant?.file) this.archives.release(grant.file);
    for (const child of grant?.archiveChildren ?? []) this.release(child);
    this.grants.delete(id);
  }
  clear(): void {
    for (const id of this.grants.keys()) this.release(id);
  }
  private get(id: string): Grant {
    const grant = this.grants.get(id);
    if (!grant) throw new Error('This preview resource has expired.');
    return grant;
  }
  documentSource(id: string): string {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested document extraction is unavailable.');
    return grant.file;
  }
  async read(id: string, requested = MAX_READ): Promise<ResourceRead> {
    const grant = this.get(id);
    const limit = Math.max(1, Math.min(requested, MAX_READ));
    let buffer: Buffer;
    let size: number;
    if (grant.data) {
      buffer = grant.data.subarray(0, limit);
      size = grant.data.length;
    } else {
      const file = await open(
        grant.file!,
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
    return { text: binary ? '' : buffer.toString('utf8'), binary, truncated: size > limit };
  }
  async archive(id: string) {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested archives are not supported yet.');
    return this.archives.list(grant.file);
  }
  async archiveEntry(id: string, name: string): Promise<Resource> {
    const grant = this.get(id);
    if (!grant.file) throw new Error('Nested archives are not supported yet.');
    const data = await this.archives.read(grant.file, name);
    this.get(id); // A parent closed while its entry was loading cannot leave an orphan grant.
    if (this.grants.size >= 256) throw new Error('Close some previews before opening more files.');
    const childID = randomUUID();
    const basename = path.basename(name);
    const resource: Resource = {
      dimensions: imageDimensions(data),
      id: childID,
      url: `viewer-resource://${childID}/asset/${encodeURIComponent(basename)}`,
      entry: {
        ...grant.resource.entry,
        name: basename,
        path: `${grant.file} → ${name}`,
        size: data.length,
        extension: path.extname(basename).slice(1).toLowerCase(),
        mime: lookup(basename) || 'application/octet-stream',
        kind: 'file',
      },
    };
    this.grants.set(childID, { resource, data, archiveChildren: new Set() });
    grant.archiveChildren.add(childID);
    return resource;
  }
  async response(request: Request): Promise<Response> {
    let opened: FileHandle | undefined;
    try {
      const url = new URL(request.url);
      const grant = this.get(url.hostname);
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
      if (!grant.data) await this.access([file!]);
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
      const body = grant.data
        ? new Uint8Array(grant.data.subarray(start, end + 1))
        : (Readable.toWeb(
            opened!.createReadStream({ start, end, autoClose: true }),
          ) as ReadableStream<Uint8Array>);
      opened = undefined; // The stream now owns and closes the descriptor, including cancellation.
      return new Response(body, { status: partial ? 206 : 200, headers });
    } catch {
      return new Response('File is unavailable or this resource has expired.', { status: 404 });
    } finally {
      await opened?.close();
    }
  }
}
