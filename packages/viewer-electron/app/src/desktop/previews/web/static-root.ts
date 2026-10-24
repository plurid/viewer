import { constants, type Stats } from 'node:fs';
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  abortable,
  byteRange,
  embeddedFileAllowed,
  escapeHtml,
  htmlFile,
  requestPath,
  responseHeaders,
  webLimits,
  WebPreviewError,
} from './policy';

export type WebAccess = (files: readonly string[]) => Promise<void>;
export interface ReadBudget {
  active: number;
}
export interface StaticRootIdentity {
  requested: string;
  path: string;
  requestedIdentity: string;
  identity: string;
}

export const containsPath = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};
const identity = (info: Stats) => `${info.dev}:${info.ino}`;
const stable = (before: Stats, after: Stats) =>
  identity(before) === identity(after) &&
  before.size === after.size &&
  before.mode === after.mode &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs;

interface Lease {
  signal: AbortSignal;
  file?: FileHandle;
  stream?: Readable;
  finish(): Promise<void>;
  done: Promise<void>;
}
interface StaticTarget {
  requested: string;
  actual: string;
  info: Stats;
}

/** One directory capability, shared by the private protocol and an explicit loopback server. */
export class StaticRoot {
  private abort = new AbortController();
  private leases = new Set<Lease>();

  constructor(
    readonly root: StaticRootIdentity,
    private access: WebAccess,
    private budget: ReadBudget,
    private ownerSignal: AbortSignal,
    private authorizeRoot = true,
  ) {}

  static async capture(
    requested: string,
    access: WebAccess,
    budget: ReadBudget,
    signal: AbortSignal,
    sourceIdentity?: string,
    authorizeRoot = true,
  ): Promise<StaticRoot> {
    if (!path.isAbsolute(requested) || requested.includes('\0'))
      throw new WebPreviewError(400, 'Choose an absolute folder path.');
    requested = path.resolve(requested);
    if (authorizeRoot) await abortable(access([requested]), signal);
    const alias = await lstat(requested);
    if (
      (!alias.isDirectory() && !alias.isSymbolicLink()) ||
      (sourceIdentity && identity(alias) !== sourceIdentity)
    )
      throw new WebPreviewError(403, 'The selected folder changed. Select it again.');
    const actual = await realpath(requested);
    if (authorizeRoot) await abortable(access([actual]), signal);
    const info = await lstat(actual);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new WebPreviewError(403, 'Choose a regular folder.');
    const reader = new StaticRoot(
      { requested, path: actual, requestedIdentity: identity(alias), identity: identity(info) },
      access,
      budget,
      signal,
      authorizeRoot,
    );
    await reader.verify(signal);
    return reader;
  }

  async verify(signal: AbortSignal = this.ownerSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.authorizeRoot) await this.permit([this.root.requested, this.root.path], signal);
    const [alias, actual, canonical] = await Promise.all([
      lstat(this.root.requested),
      lstat(this.root.path),
      realpath(this.root.requested),
    ]);
    if (
      identity(alias) !== this.root.requestedIdentity ||
      identity(actual) !== this.root.identity ||
      !actual.isDirectory() ||
      actual.isSymbolicLink() ||
      canonical !== this.root.path
    )
      throw new WebPreviewError(403, 'The selected folder changed.');
  }

  private async permit(files: readonly string[], signal: AbortSignal): Promise<void> {
    try {
      await abortable(this.access(files), signal);
    } catch {
      signal.throwIfAborted();
      throw new WebPreviewError(403, 'Folder access is required.');
    }
  }

  private enter(external?: AbortSignal): Lease {
    if (this.abort.signal.aborted || this.ownerSignal.aborted)
      throw new WebPreviewError(410, 'Preview closed.');
    if (this.leases.size >= webLimits.sessionReads || this.budget.active >= webLimits.globalReads)
      throw new WebPreviewError(429, 'Too many simultaneous asset reads.');
    const deadline = new AbortController();
    const signal = AbortSignal.any([
      this.abort.signal,
      this.ownerSignal,
      deadline.signal,
      ...(external ? [external] : []),
    ]);
    const timer = setTimeout(
      () => deadline.abort(new Error('Asset request timed out.')),
      webLimits.requestMs,
    );
    timer.unref();
    let resolve!: () => void;
    let finished = false;
    const done = new Promise<void>((complete) => {
      resolve = complete;
    });
    const lease: Lease = {
      signal,
      done,
      finish: async () => {
        if (finished) return done;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        await lease.file?.close().catch(() => {});
        this.leases.delete(lease);
        this.budget.active--;
        resolve();
      },
    };
    const cancel = () => lease.stream?.destroy(new Error('Asset request cancelled.'));
    signal.addEventListener('abort', cancel, { once: true });
    this.budget.active++;
    this.leases.add(lease);
    return lease;
  }

  private async resolve(parts: string[], signal: AbortSignal) {
    await this.verify(signal);
    const requested = path.join(this.root.path, ...parts);
    await this.permit([requested], signal);
    const actual = await realpath(requested);
    const relative = path.relative(this.root.path, actual);
    if (
      !containsPath(this.root.path, actual) ||
      relative.split(path.sep).some((part) => part.startsWith('.'))
    )
      throw new WebPreviewError(403, 'The asset is outside this folder.');
    await this.permit([requested, actual], signal);
    const info = await lstat(actual);
    await this.verify(signal);
    if ((await realpath(requested)) !== actual || (await realpath(actual)) !== actual)
      throw new WebPreviewError(403, 'The asset changed while opening.');
    return { requested, actual, info };
  }

  async response(
    rawPath: string,
    method: string,
    range: string | null,
    external?: AbortSignal,
    capability?: string,
  ): Promise<Response> {
    if (method !== 'GET' && method !== 'HEAD')
      throw new WebPreviewError(405, 'Only GET and HEAD are available.');
    const parts = requestPath(rawPath);
    const lease = this.enter(external);
    try {
      let target = await this.resolve(parts, lease.signal);
      if (target.info.isDirectory()) {
        if (capability)
          throw new WebPreviewError(403, 'Embedded directory listings are unavailable.');
        let index;
        try {
          index = await this.resolve([...parts, 'index.html'], lease.signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (index) target = index;
        else {
          const listing = await this.listing(parts, target.actual, lease.signal);
          await lease.finish();
          return new Response(method === 'HEAD' ? null : listing, {
            headers: {
              ...responseHeaders('index.html'),
              'Content-Length': String(Buffer.byteLength(listing)),
            },
          });
        }
      }
      if (!target.info.isFile() || target.info.isSymbolicLink())
        throw new WebPreviewError(403, 'Only regular assets are available.');
      if (capability && !embeddedFileAllowed(target.actual))
        throw new WebPreviewError(403, 'This asset type is unavailable in embedded HTML.');
      const limit = capability
        ? htmlFile(target.actual)
          ? webLimits.htmlBytes
          : webLimits.embeddedAssetBytes
        : webLimits.httpAssetBytes;
      if (target.info.size > limit) throw new WebPreviewError(413, 'The asset is too large.');
      lease.signal.throwIfAborted();
      lease.file = await open(
        target.actual,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const before = await lease.file.stat();
      if (!before.isFile() || !stable(target.info, before))
        throw new WebPreviewError(403, 'The asset changed while opening.');
      await this.verify(lease.signal);
      if (
        (await realpath(target.requested)) !== target.actual ||
        !stable(before, await lstat(target.actual))
      )
        throw new WebPreviewError(403, 'The asset changed while opening.');
      await this.permit([target.requested, target.actual], lease.signal);
      let selected;
      try {
        selected = byteRange(range, before.size);
      } catch (error) {
        if (error instanceof WebPreviewError && error.status === 416) {
          await lease.finish();
          return new Response(null, {
            status: 416,
            headers: {
              ...responseHeaders(target.actual, capability),
              'Content-Range': `bytes */${before.size}`,
            },
          });
        }
        throw error;
      }
      const headers = {
        ...responseHeaders(target.actual, capability),
        'Accept-Ranges': 'bytes',
        'Content-Length': String(Math.max(0, selected.end - selected.start + 1)),
        ...(selected.partial
          ? { 'Content-Range': `bytes ${selected.start}-${selected.end}/${before.size}` }
          : {}),
      };
      const status = selected.partial ? 206 : 200;
      if (method === 'HEAD' || before.size === 0) {
        await lease.finish();
        return new Response(null, { status, headers });
      }
      const stream = Readable.from(this.chunks(lease, target, before, selected));
      lease.stream = stream;
      stream.on('error', () => {});
      stream.once('close', () => {
        void lease.finish();
      });
      lease.signal.throwIfAborted();
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status,
        headers,
      });
    } catch (error) {
      lease.stream?.destroy();
      await lease.finish();
      throw error;
    }
  }

  private async *chunks(
    lease: Lease,
    target: StaticTarget,
    before: Stats,
    selected: ReturnType<typeof byteRange>,
  ): AsyncGenerator<Buffer> {
    let offset = selected.start;
    while (offset <= selected.end) {
      await this.verify(lease.signal);
      await this.permit([target.requested, target.actual], lease.signal);
      const buffer = Buffer.alloc(Math.min(64 * 1024, selected.end - offset + 1));
      const { bytesRead } = await lease.file!.read(buffer, 0, buffer.length, offset);
      lease.signal.throwIfAborted();
      if (!bytesRead || !stable(before, await lease.file!.stat()))
        throw new WebPreviewError(403, 'The asset changed while reading.');
      offset += bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
  }

  private async listing(parts: string[], actual: string, signal: AbortSignal): Promise<string> {
    const directory = await opendir(actual, { bufferSize: 32 });
    const entries: { name: string; directory: boolean }[] = [];
    let truncated = false;
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (entry.name.startsWith('.') || (!entry.isFile() && !entry.isDirectory())) continue;
      if (entries.length === webLimits.directoryEntries) {
        truncated = true;
        break;
      }
      entries.push({ name: entry.name, directory: entry.isDirectory() });
    }
    await this.verify(signal);
    await this.permit([actual], signal);
    const prefix = '/' + parts.map(encodeURIComponent).join('/') + (parts.length ? '/' : '');
    const items = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const name = entry.name + (entry.directory ? '/' : '');
        const href = prefix + encodeURIComponent(entry.name) + (entry.directory ? '/' : '');
        return `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></li>`;
      })
      .join('');
    return `<!doctype html><meta charset="utf-8"><title>Local folder</title><h1>Local folder</h1><ul>${items}</ul>${truncated ? '<p>Listing limited to 200 entries.</p>' : ''}`;
  }

  async close(): Promise<void> {
    this.abort.abort();
    const leases = [...this.leases];
    for (const lease of leases) lease.stream?.destroy(new Error('Preview closed.'));
    await Promise.allSettled(leases.map((lease) => lease.done));
  }
}
