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
  WorktreeBranch,
  WorktreeCreation,
} from '../../domain/comparison/worktrees';
import { validBranchName } from '../../domain/comparison/worktrees';
import type { CapturedTarget } from '../../domain/automation/actions';
import { inspectReviewedFile } from '../native/reviewed-file';
import { entry } from '../files/filesystem';
import { GitReader, type GitRunner } from './git';
import { addWorktree } from './worktree-process';

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
  branches: Map<string, WorktreeBranch>;
  sourceID?: string;
  common: string;
}

interface WorktreePorts {
  available(): boolean;
  access(paths: readonly string[]): Promise<void>;
  owner(owner: number): string | undefined;
  run?: GitRunner;
  validateTarget?(owner: number, target: CapturedTarget): Promise<void>;
  create?: typeof addWorktree;
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

/** Owner-bound discovery and explicit human creation. Never switches, prunes or removes. */
export class GitWorktrees {
  private readonly reader: GitReader;
  private readonly catalogs = new Map<string, CatalogLease>();
  private pending = 0;
  private readonly writes = new Map<
    AbortController,
    { owner: number; paths: string[]; repository: string; done?: Promise<unknown> }
  >();

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
      if (request.kind === 'create') return await this.create(request, owner, ownerID);
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
    const current = worktrees
      .filter((tree) => inside(tree.path, registry.currentPath))
      .sort((left, right) => right.path.length - left.path.length)[0];
    let branches: WorktreeBranch[] = [],
      creationProblem: string | undefined;
    try {
      branches = (await this.reader.localBranches(directory)).map((branch) => ({
        id: randomUUID(),
        name: branch.name,
        branch: branch.name,
        commit: branch.commit,
        worktreeID: worktrees.find((tree) => tree.branch === branch.name)?.id,
      }));
      if (!current?.available || !current.commit)
        throw new Error('Create an initial commit before adding a worktree.');
      if (
        !branches.some(
          (branch) => branch.branch === current.branch && branch.commit === current.commit,
        )
      )
        branches.push({
          id: randomUUID(),
          name: 'Current checkout · ' + current.commit.slice(0, 8),
          commit: current.commit,
        });
    } catch (error) {
      creationProblem = (error as Error).message;
    }
    this.catalogs.set(id, {
      owner,
      source: directory,
      issued: Date.now(),
      repository: identityOf(common),
      entries,
      branches: new Map(branches.map((branch) => [branch.id, branch])),
      sourceID: current?.id,
      common: registry.commonDirectory,
    });
    return {
      id,
      repository: registry.worktrees[0]?.path ?? registry.commonDirectory,
      currentPath: current?.path ?? registry.currentPath,
      worktrees,
      branches,
      defaultBaseID:
        branches.find(
          (branch) => branch.commit === current?.commit && branch.branch === current?.branch,
        )?.id ?? branches.at(-1)?.id,
      creationProblem,
    };
  }

  private async create(
    request: WorktreeCreation,
    owner: number,
    ownerID: string,
  ): Promise<WorktreeReply> {
    const lease = this.catalogs.get(request.catalogID);
    if (
      !lease ||
      lease.owner !== ownerID ||
      Date.now() - lease.issued > leaseLifetime ||
      !lease.sourceID
    )
      throw new Error('The worktree list expired or belongs to another window. Refresh it.');
    if (!this.ports.validateTarget) throw new Error('Worktree creation is unavailable.');
    await this.ports.validateTarget(owner, request.target);
    if ((await realpath(request.target.directory)) !== (await realpath(lease.source)))
      throw new Error('The originating folder differs from this worktree list. Refresh it.');
    await this.resolve(request.catalogID, lease.sourceID, ownerID);
    if ([...this.writes.values()].some((write) => write.repository === lease.repository))
      throw new Error('A worktree is already being created for this repository.');
    const selected = lease.branches.get(
      request.checkout.kind === 'new' ? request.checkout.baseID : request.checkout.branchID,
    );
    if (!selected) throw new Error('This branch selection expired. Refresh the worktree list.');
    const fresh = request.checkout.kind === 'new';
    const name = request.checkout.kind === 'new' ? request.checkout.name : selected.branch;
    if (!name || !validBranchName(name)) throw new Error('Enter a valid local branch name.');
    const refs = await this.reader.localBranches(lease.source);
    if (
      selected.branch &&
      !refs.some((branch) => branch.name === selected.branch && branch.commit === selected.commit)
    )
      throw new Error('The selected branch changed. Refresh before creating a worktree.');
    if (fresh && refs.some((branch) => branch.name === name))
      throw new Error('That branch already exists. Choose Existing branch or another name.');
    const registry = await this.reader.worktrees(lease.source);
    const occupied = !fresh && registry.worktrees.find((tree) => tree.branch === name);
    if (occupied)
      throw new Error(
        'That branch is already checked out at ' + occupied.path + '. Open its existing worktree.',
      );
    if (!path.isAbsolute(request.destination) || request.destination.includes('\0'))
      throw new Error('Use an absolute local destination.');
    const parent = path.dirname(path.normalize(request.destination));
    await this.ports.access([lease.source, lease.common, parent, request.destination]);
    const parentInfo = await lstat(parent),
      canonicalParent = await realpath(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      throw new Error('Choose an ordinary existing parent folder.');
    const destination = path.join(canonicalParent, path.basename(request.destination));
    if (inside(lease.common, destination))
      throw new Error('A worktree cannot be created inside Git administration.');
    const absent = async () => {
      try {
        await lstat(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      throw new Error('The destination already exists. Choose a new folder name.');
    };
    await absent();
    const abort = new AbortController();
    if ([...this.writes.values()].some((write) => write.repository === lease.repository))
      throw new Error('A worktree is already being created for this repository.');
    const write = {
      owner,
      paths: [lease.source, lease.common, destination, canonicalParent],
      repository: lease.repository,
      done: undefined as Promise<unknown> | undefined,
    };
    this.writes.set(abort, write);
    const work = (async () => {
      let started = false;
      try {
        await this.ports.validateTarget!(owner, request.target);
        await this.resolve(request.catalogID, lease.sourceID!, ownerID);
        if (this.owner(owner) !== ownerID) throw new Error('The worktree window changed.');
        await this.ports.access(write.paths);
        if (
          identityOf(await lstat(parent)) !== identityOf(parentInfo) ||
          (await realpath(parent)) !== canonicalParent
        )
          throw new Error('The destination parent changed. Choose it again.');
        await absent();
        abort.signal.throwIfAborted();
        started = true;
        await (this.ports.create ?? addWorktree)(
          lease.source,
          destination,
          { name, commit: selected.commit, fresh },
          AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]),
        );
        abort.signal.throwIfAborted();
        await this.ports.validateTarget!(owner, request.target);
        const created = await this.checkout(destination),
          after = await this.reader.worktrees(created.path);
        if (
          identityOf(await lstat(after.commonDirectory)) !== lease.repository ||
          !after.worktrees.some(
            (tree) =>
              tree.path === created.path && tree.branch === name && tree.commit === selected.commit,
          )
        )
          throw new Error('The created checkout does not match the selected branch and revision.');
        const catalog = await this.list(lease.source, ownerID),
          tree = catalog.worktrees.find((tree) => tree.path === created.path);
        if (!tree?.available) throw new Error('The created checkout could not be verified.');
        if (this.owner(owner) !== ownerID) throw new Error('The worktree window changed.');
        return {
          kind: 'created' as const,
          catalog,
          worktreeID: tree.id,
          entry: await entry(created.path),
        };
      } catch (error) {
        const message = (error as Error).message;
        throw new Error(
          started
            ? `${message}\nInspect ${destination} and Refresh worktrees. Viewer kept any files or branch created by Git.`
            : message,
        );
      }
    })();
    write.done = work;
    try {
      return await work;
    } finally {
      this.writes.delete(abort);
    }
  }

  stopOwner(owner: number): void {
    for (const [abort, write] of this.writes)
      if (write.owner === owner) abort.abort(new Error('The worktree window closed.'));
  }
  async quiesce(root?: string): Promise<void> {
    const done: Promise<unknown>[] = [];
    for (const [abort, write] of this.writes)
      if (!root || write.paths.some((file) => inside(root, file) || inside(file, root))) {
        abort.abort(new Error('Worktree creation stopped because folder access changed.'));
        if (write.done) done.push(write.done);
      }
    await Promise.allSettled(done);
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
    for (const abort of this.writes.keys()) abort.abort(new Error('Viewer is closing.'));
    this.catalogs.clear();
    this.reader.close();
  }
}
