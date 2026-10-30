import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  HtmlPreview,
  LocalServer,
  LocalServerDetail,
  LocalServerLog,
} from '../../../domain/previews/web';
import { htmlCapability } from '../../../domain/previews/html-address';
import { LoopbackServer } from './loopback-server';
import { errorResponse, htmlFile, webLimits, WebPreviewError } from './policy';
import { StaticRoot, type ReadBudget, type WebAccess } from './static-root';
import { SavedPageReader } from './saved-page';
import { containsPath } from '../../files/containment';
import type { SavedPage } from '../../../domain/previews/saved-page';
import { savedPageName } from '../../../domain/previews/saved-page';

interface HtmlGrant {
  owner: number;
  resourceID: string;
  file: string;
  preview: HtmlPreview;
  reader: StaticRoot | SavedPageReader;
  /** The folder a file's page reads its companions from; a saved page reads none. */
  root?: string;
}
/** Memory every saved page holds together. */
const savedPageBudget = 128 * 1024 * 1024;
interface ServerRecord {
  owner: number;
  info: LocalServer;
  reader: StaticRoot;
  transport?: LoopbackServer;
  logs: LocalServerLog[];
  sequence: number;
  activation?: AbortController;
}
interface Pending {
  owner: number;
  paths: string[];
  resourceID?: string;
  abort: AbortController;
}

/** Private offline HTML capabilities and explicitly started, owner-bound loopback servers. */
export class WebPreviews {
  private readonly previews = new Map<string, HtmlGrant>();
  private readonly servers = new Map<string, ServerRecord>();
  private readonly owners = new Map<number, AbortController>();
  private readonly pending = new Map<Promise<unknown>, Pending>();
  private readonly serials = new Map<string, Promise<unknown>>();
  private readonly budget: ReadBudget = { active: 0 };
  private readonly abort = new AbortController();
  private starting = 0;
  private startingOwners = new Map<number, number>();
  private closing?: Promise<void>;

  constructor(
    private access: WebAccess,
    private changed?: (owner: number, servers: LocalServer[]) => void,
  ) {}

  private ownerSignal(owner: number): AbortSignal {
    if (!Number.isSafeInteger(owner) || owner <= 0)
      throw new WebPreviewError(403, 'Invalid preview owner.');
    let abort = this.owners.get(owner);
    if (!abort) this.owners.set(owner, (abort = new AbortController()));
    return AbortSignal.any([this.abort.signal, abort.signal]);
  }

  private track<T>(
    owner: number,
    paths: string[],
    work: (signal: AbortSignal, pending: Pending) => Promise<T>,
    resourceID?: string,
  ): Promise<T> {
    if (this.abort.signal.aborted)
      return Promise.reject(new WebPreviewError(410, 'Web previews are closed.'));
    if (
      this.pending.size >= 32 ||
      [...this.pending.values()].filter((item) => item.owner === owner).length >= 8
    )
      return Promise.reject(new WebPreviewError(429, 'Too many pending web preview requests.'));
    const pending: Pending = { owner, paths, resourceID, abort: new AbortController() };
    const signal = AbortSignal.any([this.ownerSignal(owner), pending.abort.signal]);
    const task = Promise.resolve()
      .then(async () => {
        signal.throwIfAborted();
        return work(signal, pending);
      })
      .finally(() => this.pending.delete(task));
    this.pending.set(task, pending);
    return task;
  }

  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const task = (this.serials.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(work)
      .finally(() => {
        if (this.serials.get(key) === task) this.serials.delete(key);
      });
    this.serials.set(key, task);
    return task;
  }

  private notify(owner: number): void {
    try {
      this.changed?.(owner, this.list(owner));
    } catch {
      /* Observers do not own server cleanup. */
    }
  }

  openHtml(owner: number, file: string, resourceID: string): Promise<HtmlPreview> {
    if (!htmlFile(file) || !path.isAbsolute(file) || !resourceID || resourceID.length > 200)
      return Promise.reject(new WebPreviewError(400, 'Choose an on-disk HTML file.'));
    return this.track(
      owner,
      [file],
      (signal, pending) =>
        this.serial(`html:${owner}:${resourceID}`, async () => {
          signal.throwIfAborted();
          if (
            this.previews.size >= webLimits.previews ||
            [...this.previews.values()].filter((grant) => grant.owner === owner).length >=
              webLimits.ownerPreviews
          )
            throw new WebPreviewError(429, 'Close an HTML preview before opening another.');
          const reader = await StaticRoot.capture(
            path.dirname(file),
            this.access,
            this.budget,
            signal,
            undefined,
            false,
          );
          pending.paths.push(reader.root.path);
          const id = randomUUID();
          try {
            const response = await reader.response(
              '/' + encodeURIComponent(path.basename(file)),
              'HEAD',
              null,
              signal,
              id,
            );
            if (response.status !== 200)
              throw new WebPreviewError(response.status, 'HTML preview unavailable.');
            signal.throwIfAborted();
            if (
              this.previews.size >= webLimits.previews ||
              [...this.previews.values()].filter((grant) => grant.owner === owner).length >=
                webLimits.ownerPreviews
            )
              throw new WebPreviewError(429, 'Too many HTML previews.');
            const preview = {
              id,
              url: `viewer-html://${id}/${encodeURIComponent(path.basename(file))}`,
            };
            this.previews.set(id, {
              owner,
              resourceID,
              file,
              preview,
              reader,
              root: reader.root.path,
            });
            return { ...preview };
          } catch (error) {
            await reader.close();
            throw error;
          }
        }),
      resourceID,
    );
  }

  /**
   * A page made from `file`'s own parts, an email's HTML body or a saved web page: `read` makes it
   * in the preview worker. It is held in memory under its own capability and served without
   * scripts or any outside resource.
   */
  openPage(
    owner: number,
    file: string,
    resourceID: string,
    read: (signal: AbortSignal) => Promise<SavedPage>,
  ): Promise<HtmlPreview> {
    if (!path.isAbsolute(file) || !resourceID || resourceID.length > 200)
      return Promise.reject(new WebPreviewError(400, 'Choose an on-disk file.'));
    return this.track(
      owner,
      [file],
      (signal) =>
        this.serial(`page:${owner}:${resourceID}`, async () => {
          signal.throwIfAborted();
          const full = () =>
            this.previews.size >= webLimits.previews ||
            [...this.previews.values()].filter((grant) => grant.owner === owner).length >=
              webLimits.ownerPreviews;
          if (full()) throw new WebPreviewError(429, 'Close a preview before opening another.');
          const page = await read(signal);
          signal.throwIfAborted();
          const reader = new SavedPageReader(page);
          const held = [...this.previews.values()].reduce(
            (size, grant) =>
              size + (grant.reader instanceof SavedPageReader ? grant.reader.size : 0),
            0,
          );
          if (full() || held + reader.size > savedPageBudget) {
            await reader.close();
            throw new WebPreviewError(429, 'Close a preview before opening another.');
          }
          const id = randomUUID();
          const preview = {
            id,
            url: `viewer-html://${id}/${savedPageName}`,
            blocked: page.blocked,
          };
          this.previews.set(id, { owner, resourceID, file, preview, reader });
          return { ...preview };
        }),
      resourceID,
    );
  }

  ownsHtmlURL(owner: number, value: string): boolean {
    const capability = htmlCapability(value);
    const grant = capability ? this.previews.get(capability) : undefined;
    return !!grant && grant.owner === owner && !this.abort.signal.aborted;
  }

  async response(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const capability = htmlCapability(request.url);
      const grant = capability ? this.previews.get(capability) : undefined;
      if (!grant) throw new WebPreviewError(404, 'HTML preview unavailable.');
      const origin = request.headers.get('origin');
      if (origin && origin !== 'null')
        throw new WebPreviewError(403, 'Cross-origin preview request.');
      return await grant.reader.response(
        url.pathname,
        request.method,
        request.headers.get('range'),
        request.signal,
        grant.preview.id,
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  async closeHtml(owner: number, id: string): Promise<void> {
    const grant = this.previews.get(id);
    if (!grant || grant.owner !== owner) return;
    this.previews.delete(id);
    await grant.reader.close();
  }

  async releaseResource(resourceID: string): Promise<void> {
    const work: Promise<unknown>[] = [];
    for (const [task, pending] of this.pending)
      if (pending.resourceID === resourceID) {
        pending.abort.abort();
        work.push(task);
      }
    for (const [id, grant] of this.previews)
      if (grant.resourceID === resourceID) work.push(this.closeHtml(grant.owner, id));
    await Promise.allSettled(work);
    for (const [id, grant] of this.previews)
      if (grant.resourceID === resourceID) await this.closeHtml(grant.owner, id);
  }

  start(
    owner: number,
    root: string,
    paneID: string,
    sourceIdentity?: string,
  ): Promise<LocalServer> {
    if (!paneID || paneID.length > 200 || !path.isAbsolute(root))
      return Promise.reject(new WebPreviewError(400, 'Choose a folder and a server plane.'));
    return this.track(owner, [root], (signal, pending) =>
      this.serial(`server:${owner}:${paneID}`, async () => {
        signal.throwIfAborted();
        const previous = [...this.servers.values()].find(
          (record) => record.owner === owner && record.info.paneID === paneID,
        );
        if (previous) {
          if (
            path.resolve(root) !== previous.reader.root.requested &&
            (await realpath(root)) !== previous.reader.root.path
          )
            throw new WebPreviewError(403, 'Close this server plane before changing its folder.');
          await previous.reader.verify(signal);
          if (sourceIdentity && sourceIdentity !== previous.reader.root.requestedIdentity)
            throw new WebPreviewError(403, 'The selected folder changed.');
          if (previous.info.state === 'stopped') await this.activate(previous, signal);
          return { ...previous.info };
        }
        if (
          this.servers.size >= webLimits.records ||
          this.list(owner).length >= webLimits.ownerRecords
        )
          throw new WebPreviewError(429, 'Close a server plane before opening another.');
        const reader = await StaticRoot.capture(
          root,
          this.access,
          this.budget,
          signal,
          sourceIdentity,
        );
        pending.paths.push(reader.root.path);
        signal.throwIfAborted();
        const record: ServerRecord = {
          owner,
          reader,
          logs: [],
          sequence: 0,
          info: {
            id: randomUUID(),
            paneID,
            root: reader.root.path,
            url: '',
            port: 0,
            started: 0,
            state: 'stopped',
          },
        };
        if (
          this.servers.size >= webLimits.records ||
          this.list(owner).length >= webLimits.ownerRecords
        ) {
          await reader.close();
          throw new WebPreviewError(429, 'Too many server planes.');
        }
        this.servers.set(record.info.id, record);
        await this.activate(record, signal);
        return { ...record.info };
      }),
    );
  }

  private async activate(record: ServerRecord, signal: AbortSignal): Promise<void> {
    if (this.servers.get(record.info.id) !== record)
      throw new WebPreviewError(410, 'Server plane closed.');
    await record.reader.verify(signal);
    if (
      this.starting +
        [...this.servers.values()].filter((item) => item.info.state === 'running').length >=
        webLimits.servers ||
      this.list(record.owner).filter((item) => item.state === 'running').length +
        (this.startingOwners.get(record.owner) ?? 0) >=
        webLimits.ownerServers
    )
      throw new WebPreviewError(429, 'Stop a local server before starting another.');
    this.starting++;
    this.startingOwners.set(record.owner, (this.startingOwners.get(record.owner) ?? 0) + 1);
    const activation = new AbortController();
    record.activation = activation;
    signal = AbortSignal.any([signal, activation.signal]);
    const reader = new StaticRoot(
      record.reader.root,
      this.access,
      this.budget,
      this.ownerSignal(record.owner),
    );
    const transport = new LoopbackServer(
      reader,
      (entry) => {
        record.logs.push({ ...entry, sequence: ++record.sequence });
        if (record.logs.length > webLimits.logs)
          record.logs.splice(0, record.logs.length - webLimits.logs);
      },
      () => {
        if (record.transport === transport && record.info.state === 'running') {
          record.info.state = 'stopped';
          this.notify(record.owner);
        }
      },
    );
    record.transport = transport;
    try {
      await transport.listen(signal);
      signal.throwIfAborted();
      if (this.servers.get(record.info.id) !== record)
        throw new WebPreviewError(410, 'Server plane closed.');
      record.reader = reader;
      record.info = {
        ...record.info,
        port: transport.port,
        url: `http://127.0.0.1:${transport.port}/`,
        started: Date.now(),
        state: 'running',
      };
      this.notify(record.owner);
    } catch (error) {
      await transport.close();
      record.transport = undefined;
      throw error;
    } finally {
      this.starting--;
      const count = (this.startingOwners.get(record.owner) ?? 1) - 1;
      if (count) this.startingOwners.set(record.owner, count);
      else this.startingOwners.delete(record.owner);
    }
  }

  list(owner: number): LocalServer[] {
    return [...this.servers.values()]
      .filter((record) => record.owner === owner)
      .map((record) => ({ ...record.info }));
  }
  private record(owner: number, id: string): ServerRecord {
    const record = this.servers.get(id);
    if (!record || record.owner !== owner)
      throw new WebPreviewError(404, 'This local server is unavailable.');
    return record;
  }
  get(owner: number, id: string): LocalServer {
    return { ...this.record(owner, id).info };
  }
  inspect(owner: number, id: string): LocalServerDetail {
    const record = this.record(owner, id);
    return { server: { ...record.info }, logs: record.logs.map((entry) => ({ ...entry })) };
  }
  clearLog(owner: number, id: string): void {
    this.record(owner, id).logs = [];
  }

  private async stopRecord(record: ServerRecord): Promise<void> {
    record.activation?.abort();
    record.activation = undefined;
    const wasRunning = record.info.state === 'running';
    record.info.state = 'stopped';
    await record.transport?.close();
    record.transport = undefined;
    await record.reader.close();
    if (wasRunning) this.notify(record.owner);
  }
  async stop(owner: number, id: string): Promise<void> {
    await this.stopRecord(this.record(owner, id));
  }
  restart(owner: number, id: string): Promise<LocalServer> {
    const record = this.record(owner, id);
    return this.track(owner, [record.reader.root.requested, record.reader.root.path], (signal) =>
      this.serial(`server:${owner}:${record.info.paneID}`, async () => {
        await this.stopRecord(record);
        await this.activate(record, signal);
        return { ...record.info };
      }),
    );
  }
  async dispose(owner: number, id: string): Promise<void> {
    const record = this.servers.get(id);
    if (!record || record.owner !== owner) return;
    await this.stopRecord(record);
    this.servers.delete(id);
    this.notify(owner);
  }

  async stopOwner(owner: number): Promise<void> {
    const abort = this.owners.get(owner);
    abort?.abort();
    await Promise.allSettled([
      ...[...this.pending]
        .filter(([, item]) => item.owner === owner)
        .map(([task, item]) => {
          item.abort.abort();
          return task;
        }),
      ...[...this.previews]
        .filter(([, item]) => item.owner === owner)
        .map(([id]) => this.closeHtml(owner, id)),
      ...this.list(owner).map((item) => this.dispose(owner, item.id)),
    ]);
    for (const item of this.list(owner)) await this.dispose(owner, item.id);
    if (this.owners.get(owner) === abort) this.owners.delete(owner);
  }

  async quiesce(root?: string): Promise<void> {
    const canonical = root ? await realpath(root).catch(() => path.resolve(root)) : undefined;
    const affected = async (paths: string[]) =>
      !root ||
      (await Promise.all(paths.map((file) => realpath(file).catch(() => path.resolve(file))))).some(
        (file) =>
          containsPath(canonical!, file) ||
          containsPath(file, canonical!) ||
          containsPath(path.resolve(root), file) ||
          containsPath(file, path.resolve(root)),
      );
    const work: Promise<unknown>[] = [];
    for (const [task, item] of this.pending)
      if (await affected(item.paths)) {
        item.abort.abort();
        work.push(task);
      }
    for (const [id, item] of this.previews)
      if (await affected(item.root ? [item.file, item.root] : [item.file]))
        work.push(this.closeHtml(item.owner, id));
    for (const item of this.servers.values())
      if (await affected([item.reader.root.requested, item.reader.root.path]))
        work.push(this.stopRecord(item));
    await Promise.allSettled(work);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.abort.abort();
    return (this.closing = (async () => {
      await Promise.allSettled([...this.owners.keys()].map((owner) => this.stopOwner(owner)));
      await Promise.allSettled([...this.pending.keys()]);
    })());
  }
}
