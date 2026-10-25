import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from '../../domain/contracts';
import type {
  GitWorktree,
  GitWorktreeRecord,
  WorktreeCatalog,
  WorktreeReply,
  WorktreeRequest,
} from '../../domain/comparison/worktrees';
import { inspectReviewedFile } from '../native/reviewed-file';
import { entry } from '../files/filesystem';
import { GitReader, type GitRunner } from './git';

interface CheckoutIdentity {
  path: string;
  directory: string;
  administration: string;
  pointer?: string;
}

interface RegisteredWorktree {
  record: GitWorktreeRecord;
  identity?: CheckoutIdentity;
}

interface CatalogLease {
  owner: string;
  source: string;
  repository: string;
  issued: number;
  entries: Map<string, RegisteredWorktree>;
}

interface WorktreePorts {
  available(): boolean;
  access(paths: readonly string[]): Promise<void>;
  owner(owner: number): string | undefined;
  run?: GitRunner;
}

const leaseLifetime = 5 * 60_000;
const identityOf = (info: { dev: number; ino: number }) => `${info.dev}:${info.ino}`;
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};

/** Existing checkouts only. No method can switch branches, create, prune or remove a worktree. */
export class GitWorktrees {
  private readonly reader: GitReader;
  private readonly catalogs = new Map<string, CatalogLease>();
  private pending = 0;

  constructor(private readonly ports: WorktreePorts) {
    this.reader = new GitReader(ports.available, ports.access, ports.run);
  }

  private owner(owner: number): string {
    if (!this.ports.available())
      throw new Error('Git worktree browsing is available in the direct build only.');
    const identity = this.ports.owner(owner);
    if (!identity) throw new Error('The worktree window has closed.');
    return identity;
  }

  private async checkout(location: string): Promise<CheckoutIdentity> {
    if (!path.isAbsolute(location)) throw new Error('Git returned a non-local worktree path.');
    await this.ports.access([location]);
    const before = await lstat(location);
    if (!before.isDirectory() || before.isSymbolicLink())
      throw new Error('The registered worktree must be an ordinary folder.');
    const actual = await realpath(location);
    const marker = path.join(actual, '.git');
    const info = await lstat(marker);
    let administration: string;
    let pointer: string | undefined;
    if (info.isDirectory() && !info.isSymbolicLink()) administration = await realpath(marker);
    else if (info.isFile() && !info.isSymbolicLink()) {
      const inspected = await inspectReviewedFile(marker, 32768);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(inspected.bytes);
      if (!text.startsWith('gitdir: ') || text.includes('\0'))
        throw new Error('The worktree Git pointer is invalid.');
      const destination = text.slice(8).replace(/\n$/, '');
      if (!destination) throw new Error('The worktree Git pointer is empty.');
      administration = await realpath(path.resolve(actual, destination));
      pointer = inspected.reviewed.sha256;
    } else throw new Error('The worktree Git pointer must be a regular file or folder.');
    await this.ports.access([administration]);
    const admin = await lstat(administration);
    if (!admin.isDirectory() || admin.isSymbolicLink())
      throw new Error('The worktree administration folder is unavailable.');
    const after = await lstat(location);
    if (identityOf(before) !== identityOf(after) || (await realpath(location)) !== actual)
      throw new Error('The worktree folder changed while reading it.');
    return {
      path: actual,
      directory: identityOf(after),
      administration: identityOf(admin),
      pointer,
    };
  }

  async request(request: WorktreeRequest, owner: number): Promise<WorktreeReply> {
    const ownerID = this.owner(owner);
    if (request.kind === 'release') {
      if (this.catalogs.get(request.catalogID)?.owner === ownerID)
        this.catalogs.delete(request.catalogID);
      return { kind: 'released' };
    }
    if (this.pending >= 16) throw new Error('Worktree browsing is busy. Try again shortly.');
    this.pending += 1;
    try {
      if (request.kind === 'list') {
        const catalog = await this.list(request.directory, ownerID);
        if (this.owner(owner) !== ownerID) {
          this.catalogs.delete(catalog.id);
          throw new Error('The worktree window changed.');
        }
        return { kind: 'catalog', catalog };
      }
      const { lease, registered, current } = await this.resolve(
        request.catalogID,
        request.worktreeID,
        ownerID,
      );
      if (request.kind === 'open') {
        const folder: FileEntry = await entry(current.path);
        if (!folder.directory || folder.identity !== current.directory)
          throw new Error('The worktree folder changed. Refresh the list.');
        if (this.owner(owner) !== lease.owner) throw new Error('The worktree window changed.');
        return { kind: 'folder', entry: folder };
      }
      const status = await this.reader.status(current.path, true);
      if (status.kind !== 'ready') throw new Error(status.message);
      await this.resolve(request.catalogID, request.worktreeID, ownerID);
      if (
        status.snapshot.root !== current.path ||
        status.snapshot.commit !== registered.record.commit
      )
        throw new Error('The checkout changed. Refresh the worktree list.');
      if (this.owner(owner) !== lease.owner) throw new Error('The worktree window changed.');
      return { kind: 'status', snapshot: status.snapshot };
    } finally {
      this.pending -= 1;
    }
  }

  private async list(directory: string, owner: string): Promise<WorktreeCatalog> {
    const registry = await this.reader.worktrees(directory);
    const common = await lstat(registry.commonDirectory);
    if (!common.isDirectory()) throw new Error('Git repository administration is unavailable.');
    const entries = new Map<string, RegisteredWorktree>();
    const worktrees: GitWorktree[] = [];
    for (let offset = 0; offset < registry.worktrees.length; offset += 8) {
      const batch = await Promise.all(
        registry.worktrees.slice(offset, offset + 8).map(async (record) => {
          const id = randomUUID();
          if (record.bare || record.prunable !== undefined)
            return {
              row: {
                ...record,
                id,
                available: false,
                problem: record.bare
                  ? 'A bare repository has no working files.'
                  : 'This registration is prunable; its folder is unavailable.',
              },
              registration: { record },
            };
          try {
            const identity = await this.checkout(record.path);
            return {
              row: { ...record, path: identity.path, id, available: true },
              registration: { record, identity },
            };
          } catch {
            return {
              row: {
                ...record,
                id,
                available: false,
                problem: 'This checkout is missing, inaccessible or its Git pointer is invalid.',
              },
              registration: { record },
            };
          }
        }),
      );
      for (const value of batch) {
        worktrees.push(value.row);
        entries.set(value.row.id, value.registration);
      }
    }
    const id = randomUUID();
    for (const [key, lease] of this.catalogs)
      if (Date.now() - lease.issued > leaseLifetime) this.catalogs.delete(key);
    if (this.catalogs.size >= 16) this.catalogs.delete(this.catalogs.keys().next().value!);
    this.catalogs.set(id, {
      owner,
      source: directory,
      issued: Date.now(),
      repository: identityOf(common),
      entries,
    });
    const current = worktrees
      .filter((tree) => inside(tree.path, registry.currentPath))
      .sort((left, right) => right.path.length - left.path.length)[0];
    return {
      id,
      repository: registry.worktrees[0]?.path ?? registry.commonDirectory,
      currentPath: current?.path ?? registry.currentPath,
      worktrees,
    };
  }

  private async resolve(id: string, worktreeID: string, owner: string) {
    const lease = this.catalogs.get(id);
    const registered = lease?.entries.get(worktreeID);
    if (
      !lease ||
      lease.owner !== owner ||
      !registered?.identity ||
      Date.now() - lease.issued > leaseLifetime
    )
      throw new Error('The worktree list expired or belongs to another window. Refresh it.');
    const registry = await this.reader.worktrees(lease.source);
    if (identityOf(await lstat(registry.commonDirectory)) !== lease.repository)
      throw new Error('The repository changed. Refresh the worktree list.');
    const fresh = registry.worktrees.find((tree) => tree.path === registered.record.path);
    if (
      !fresh ||
      fresh.bare ||
      fresh.prunable !== undefined ||
      fresh.branch !== registered.record.branch ||
      fresh.commit !== registered.record.commit ||
      fresh.detached !== registered.record.detached
    )
      throw new Error('The checkout registration, branch or revision changed. Refresh the list.');
    const current = await this.checkout(registered.record.path);
    if (
      current.path !== registered.identity.path ||
      current.directory !== registered.identity.directory ||
      current.administration !== registered.identity.administration ||
      current.pointer !== registered.identity.pointer
    )
      throw new Error('The worktree was replaced. Refresh the list.');
    const checkoutRegistry = await this.reader.worktrees(current.path);
    if (identityOf(await lstat(checkoutRegistry.commonDirectory)) !== lease.repository)
      throw new Error('The checkout now belongs to another repository. Refresh the list.');
    return { lease, registered, current };
  }

  close(): void {
    this.catalogs.clear();
    this.reader.close();
  }
}
