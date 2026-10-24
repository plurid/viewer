import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { DocumentStore } from '../persistence/document-store';
import type { TrashReceipt } from '../native/macos-files';
import { localPath } from '../schemas';

const document = z
  .object({
    version: z.literal(1),
    grants: z
      .array(
        z
          .object({
            path: localPath,
            directory: z.boolean(),
            bookmark: z.string().min(1).max(65536),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();
type Grant = z.infer<typeof document>['grants'][number];

export class FileAccessRequired extends Error {
  readonly code = 'FILE_ACCESS_REQUIRED';
  constructor(readonly path: string) {
    super('Allow access to this folder using the folder picker, then try again.');
  }
}
const contains = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};
async function existingParent(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(file) === file)
      throw error;
    return path.join(await existingParent(path.dirname(file)), path.basename(file));
  }
}

/** Native picker grants are private capabilities, never JSONC preferences or IPC arguments.
 * A root is acquired lazily once for the desktop session. Its scope stays alive for
 * watches, previews and queued jobs, and is released after those services stop. */
export class FileAccess {
  readonly scoped: boolean;
  private store: DocumentStore<z.infer<typeof document>>;
  private grants: Grant[] = [];
  private incoming = new Map<string, Grant>();
  private incomingDirectories = new Map<string, Grant>();
  private temporary = new Map<string, Grant>();
  private loading?: Promise<void>;
  private mutations: Promise<void> = Promise.resolve();
  private active = new Map<string, { stop(): void; root: Promise<string> }>();
  private closed = false;
  private denied = new Set<string>();
  private revocations = new Map<string, number>();
  private nativeRevision = 0;
  private held = new Map<string, number>();
  private blocked(file: string): boolean {
    return [...this.denied, ...this.held.keys()].some((root) => contains(root, file));
  }
  async withBlocked<T>(file: string, work: () => Promise<T>): Promise<T> {
    const root = path.resolve(localPath.parse(file));
    this.held.set(root, (this.held.get(root) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const count = (this.held.get(root) ?? 1) - 1;
      if (count) this.held.set(root, count);
      else this.held.delete(root);
    }
  }
  constructor(
    dataPath: string,
    private native?: { start(bookmark: string): () => void },
    private internalRoots: string[] = [dataPath],
  ) {
    this.scoped = !!native;
    this.store = new DocumentStore(path.join(dataPath, 'file-access-v1.json'), (value) =>
      document.parse(value),
    );
    this.internalRoots = internalRoots.map((value) => path.resolve(value));
  }
  load(): Promise<void> {
    if (!this.scoped) return Promise.resolve();
    return (this.loading ??= this.store
      .load()
      .then((value) => {
        this.grants = value?.grants ?? [];
      })
      .catch(() => {
        // Corrupt or obsolete metadata cannot confer access. The native picker can
        // repair the private store without preventing the application from starting.
        this.grants = [];
      }));
  }
  remember(file: string, directory: boolean, bookmark: string | undefined): Promise<void> {
    if (!this.scoped) return Promise.resolve();
    const wasDenied = this.blocked(path.resolve(file));
    const work = this.mutations
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new Error('Folder access has closed.');
        const grant = document.shape.grants.element.parse({
          path: path.resolve(file),
          directory,
          bookmark,
        });
        await this.load();
        if (wasDenied || this.blocked(grant.path)) throw new FileAccessRequired(grant.path);
        const grants = [...this.grants.filter((item) => item.path !== grant.path), grant];
        if (grants.length > 128)
          throw new Error(
            'Too many saved folder permissions. Choose a parent folder to cover its subfolders.',
          );
        await this.store.save({ version: 1, grants });
        this.grants = grants;
        // Keep the old live scope until shutdown; existing jobs may still use it.
        // A new bookmark supersedes it on the next cold launch.
      });
    this.mutations = work;
    return work;
  }
  /** A file chosen in a panel for one use, an export or an import: for this session only. Each was
   * saved as a folder permission, and at 128 of them new folders were refused (2026-10-20). */
  allowOnce(file: string, bookmark: string | undefined): Promise<void> {
    if (!this.scoped || !bookmark) return Promise.resolve();
    return this.receiveNative([{ path: file, directory: false, bookmark }]);
  }
  /** Native clipboard/drop capabilities last for this desktop session. They
   * must not fill the small persistent picker list or silently grant a parent. */
  async receiveNative(files: readonly Grant[]): Promise<void> {
    if (!this.scoped) return;
    const revision = this.nativeRevision;
    if (files.length > 10000) throw new Error('Select at most 10,000 items at a time.');
    const grants = files.map((file) =>
      document.shape.grants.element.parse({
        ...file,
        path: path.resolve(localPath.parse(file.path)),
      }),
    );
    const wasBlocked = grants.some((grant) => this.blocked(grant.path));
    await this.load();
    if (this.closed) throw new Error('Folder access has closed.');
    if (
      wasBlocked ||
      grants.some((grant) => this.blocked(grant.path)) ||
      (grants.length && revision !== this.nativeRevision)
    )
      throw new FileAccessRequired(
        grants.find((grant) => this.blocked(grant.path))?.path ?? grants[0]?.path ?? '',
      );
    const incoming = new Map(this.incoming);
    for (const grant of grants) incoming.set(grant.path, grant);
    if (
      incoming.size > 10000 ||
      [...incoming.values()].reduce((size, grant) => size + grant.bookmark.length, 0) >
        16 * 1024 * 1024
    )
      throw new Error(
        'Too many session file permissions. Choose their parent folder, or relaunch Viewer before importing more.',
      );
    this.incoming = incoming;
    this.incomingDirectories = new Map([...incoming].filter(([, grant]) => grant.directory));
  }
  async require(files: readonly string[]): Promise<void> {
    for (const file of files)
      if (this.blocked(path.resolve(file))) throw new FileAccessRequired(file);
    if (!this.scoped) return;
    await this.load();
    if (this.closed) throw new Error('Folder access has closed.');
    for (const input of files) {
      if (this.closed) throw new Error('Folder access has closed.');
      const file = path.resolve(localPath.parse(input));
      if (this.blocked(file)) throw new FileAccessRequired(file);
      if (this.internalRoots.some((root) => contains(root, file))) {
        const actual = await existingParent(file);
        const roots = await Promise.all(this.internalRoots.map((root) => existingParent(root)));
        if (roots.some((root) => contains(root, actual))) continue;
        throw new FileAccessRequired(file);
      }
      const exact = this.incoming.get(file);
      const candidates = [
        ...this.grants,
        ...this.incomingDirectories.values(),
        ...this.temporary.values(),
        ...(exact && !exact.directory ? [exact] : []),
      ]
        .filter((grant) => (grant.directory ? contains(grant.path, file) : grant.path === file))
        .sort((a, b) => b.path.length - a.path.length);
      let allowed = false;
      for (const grant of candidates) {
        let active = this.active.get(grant.path);
        try {
          if (!active) {
            const stop = this.native!.start(grant.bookmark);
            active = { stop, root: realpath(grant.path) };
            // Observe rejection even if another caller is interrupted before await.
            void active.root.catch(() => {});
            this.active.set(grant.path, active);
          }
          const [root, actual] = await Promise.all([active.root, existingParent(file)]);
          // Canonical filesystem reads can outlive revocation. A released scope
          // cannot approve the old caller after the temporary deny has cleared.
          if (this.active.get(grant.path) !== active) continue;
          if (grant.directory ? contains(root, actual) : root === actual) {
            allowed = true;
            break;
          }
        } catch {
          if (active && this.active.get(grant.path) === active) {
            this.active.delete(grant.path);
            active.stop();
          }
        }
      }
      if (this.closed) throw new Error('Folder access has closed.');
      if (this.blocked(file)) throw new FileAccessRequired(file);
      if (!allowed) throw new FileAccessRequired(file);
    }
  }
  async list(): Promise<
    // Temporary Undo leases are intentionally absent from this list.
    {
      path: string;
      directory: boolean;
      status: 'active' | 'saved' | 'revoking' | 'unavailable';
      session?: boolean;
    }[]
  > {
    await this.load();
    const result: Awaited<ReturnType<FileAccess['list']>> = [];
    for (const grant of this.grants) {
      let status: Awaited<ReturnType<FileAccess['list']>>[number]['status'] = 'saved';
      if (this.denied.has(grant.path)) status = 'revoking';
      else {
        let stop: (() => void) | undefined;
        try {
          const active = this.active.get(grant.path);
          if (!active) stop = this.native!.start(grant.bookmark);
          await realpath(grant.path);
          status = active ? 'active' : 'saved';
        } catch {
          status = 'unavailable';
        } finally {
          stop?.();
        }
      }
      result.push({ path: grant.path, directory: grant.directory, status });
    }
    for (const grant of this.incoming.values())
      if (!this.grants.some((saved) => saved.path === grant.path))
        result.push({
          path: grant.path,
          directory: grant.directory,
          status: this.blocked(grant.path)
            ? 'revoking'
            : this.active.has(grant.path)
              ? 'active'
              : 'saved',
          session: true,
        });
    return result;
  }
  /** A private Trash receipt leases one item during guarded Undo, without
   * creating saved permission to browse the user's Trash. */
  async withReceipt<T>(receipt: TrashReceipt, work: () => Promise<T>): Promise<T> {
    if (!this.scoped) return work();
    if (this.closed) throw new Error('Folder access has closed.');
    const grant = document.shape.grants.element.parse(receipt);
    if (this.blocked(grant.path) || this.temporary.has(grant.path))
      throw new FileAccessRequired(grant.path);
    this.temporary.set(grant.path, grant);
    try {
      await this.require([grant.path]);
      return await work();
    } finally {
      this.temporary.delete(grant.path);
      this.active.get(grant.path)?.stop();
      this.active.delete(grant.path);
    }
  }
  revoke(file: string, quiesce: () => Promise<void>): Promise<void> {
    const root = path.resolve(localPath.parse(file));
    this.nativeRevision++;
    const revision = (this.revocations.get(root) ?? 0) + 1;
    this.revocations.set(root, revision);
    this.denied.add(root);
    const work = this.mutations
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new Error('Folder access has closed.');
        await this.load();
        await quiesce();
        const grants = this.grants.filter((grant) => grant.path !== root);
        await this.store.save({ version: 1, grants });
        this.grants = grants;
        for (const file of this.incoming.keys())
          if (contains(root, file)) {
            this.incoming.delete(file);
            this.incomingDirectories.delete(file);
            this.active.get(file)?.stop();
            this.active.delete(file);
          }
        this.active.get(root)?.stop();
        this.active.delete(root);
        if (this.revocations.get(root) === revision) {
          this.denied.delete(root);
          this.revocations.delete(root);
        }
      });
    this.mutations = work;
    return work;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.nativeRevision++;
    await this.mutations.catch(() => {});
    const active = [...this.active.values()];
    this.active.clear();
    this.incoming.clear();
    this.incomingDirectories.clear();
    this.temporary.clear();
    for (const scope of active) scope.stop();
  }
}
