import { randomUUID, createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { CapturedTarget } from '../../domain/automation/actions';
import { gitRelativePath, commitPattern } from '../../domain/comparison/git';
import {
  parseReviewPatch,
  type GitReviewReply,
  type GitReviewRequest,
  type ParsedPatch,
  type ReviewBranch,
  type ReviewFile,
  type ReviewSnapshot,
  type ReviewFileEntry,
} from '../../domain/comparison/review';
import { inspectReviewedFile } from '../native/reviewed-file';
import { GitReader, runGit, gitEnvironment, gitSafeOptions } from './git';

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = (info: { dev: number; ino: number }) => `${info.dev}:${info.ino}`;
const diffOptions = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  '--ignore-submodules=all',
  '--diff-algorithm=myers',
];
interface Lease {
  owner: number;
  origin: string;
  target: CapturedTarget;
  root: string;
  identity: string;
  admin: string;
  adminIdentity: string;
  marker: string;
  branches: ReviewBranch[];
  issued: number;
  generation: number;
  snapshot?: ReviewSnapshot;
  index?: string;
  files: Map<
    string,
    { result: ReviewFile; patch: ParsedPatch; hash: string; index: string; head?: string }
  >;
}
interface Ports {
  available(): boolean;
  owner(id: number): string | undefined;
  access(paths: readonly string[]): Promise<void>;
  validate(owner: number, target: CapturedTarget): Promise<void>;
  apply?: typeof applyReviewPatch;
  changed?(root: string): void;
}

/** Fixed index-only write. It cannot run a shell, hook, external diff, filter or transport. */
function applyReviewPatch(
  root: string,
  patch: string,
  reverse: boolean,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/git',
      [
        ...gitSafeOptions,
        '-C',
        root,
        'apply',
        '--cached',
        '--recount',
        '--whitespace=nowarn',
        ...(reverse ? ['--reverse'] : []),
        '-',
      ],
      {
        env: gitEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
        signal,
        windowsHide: true,
      },
    );
    let bytes = 0,
      diagnostics = '',
      failure: Error | undefined;
    const receive = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 256 * 1024) {
        failure = new Error('Git diagnostics exceeded the limit.');
        child.kill('SIGKILL');
      } else diagnostics += chunk.toString('utf8');
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.stdin.on('error', (error) => {
      failure ??= error;
    });
    child.on('error', (error) => {
      failure ??= error;
    });
    child.on('close', (code) => {
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            diagnostics.trim().slice(-2000) || 'The hunk could not be applied. Refresh review.',
          ),
        );
      else resolve();
    });
    child.stdin.end(patch);
  });
}

/** One window owns a bounded review lease. Every write rechecks its captured
 * origin, checkout, HEAD, index and exact diff before using stored patch bytes. */
export class GitReviews {
  private reader: GitReader;
  private leases = new Map<string, Lease>();
  private active = new Map<
    AbortController,
    { owner: number; root: string; reviewID?: string; done?: Promise<unknown> }
  >();
  private writes = new Map<string, Promise<unknown>>();
  private pending = 0;
  constructor(private ports: Ports) {
    this.reader = new GitReader(ports.available, ports.access);
  }
  private async command(
    root: string,
    args: string[],
    signal: AbortSignal,
    limit = 4 * 1024 * 1024,
  ) {
    await this.ports.access([root]);
    const bytes = await runGit(root, args, limit, signal);
    signal.throwIfAborted();
    await this.ports.access([root]);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  private async marker(root: string): Promise<string> {
    const file = path.join(root, '.git');
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error('The Git marker is a link.');
    if (info.isDirectory()) return identity(info);
    if (!info.isFile()) throw new Error('The Git marker changed.');
    return identity(info) + ':' + (await inspectReviewedFile(file, 32768)).reviewed.sha256;
  }
  private async index(lease: Lease): Promise<string> {
    const file = path.join(lease.admin, 'index');
    try {
      return (await inspectReviewedFile(file, 64 * 1024 * 1024)).reviewed.sha256;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unborn';
      throw error;
    }
  }
  private async verify(lease: Lease, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.ports.owner(lease.owner) !== lease.origin || Date.now() - lease.issued > 5 * 60_000)
      throw new Error('This Git review expired. Refresh it.');
    await this.ports.validate(lease.owner, lease.target);
    await this.ports.access([lease.root, lease.admin]);
    const root = await lstat(lease.root),
      admin = await lstat(lease.admin);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      !admin.isDirectory() ||
      admin.isSymbolicLink() ||
      identity(root) !== lease.identity ||
      identity(admin) !== lease.adminIdentity ||
      (await this.marker(lease.root)) !== lease.marker
    )
      throw new Error('The checkout changed. Open a new review.');
    const actual = (
      await this.command(lease.root, ['rev-parse', '--absolute-git-dir'], signal, 32768)
    ).replace(/\n$/, '');
    if ((await realpath(actual)) !== lease.admin)
      throw new Error('The Git administration folder changed.');
  }
  async request(request: GitReviewRequest, owner: number): Promise<GitReviewReply> {
    if (!this.ports.available()) throw new Error('Git review is available in the direct build.');
    const origin = this.ports.owner(owner);
    if (!origin) throw new Error('The review window closed.');
    if (request.kind === 'release') {
      if (this.leases.get(request.reviewID)?.owner === owner) {
        this.leases.delete(request.reviewID);
        for (const [abort, active] of this.active)
          if (active.owner === owner && active.reviewID === request.reviewID) abort.abort();
      }
      return { kind: 'released' };
    }
    if (this.pending >= 16) throw new Error('Git review is busy. Try again shortly.');
    this.pending++;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]);
    const active = {
      owner,
      root:
        request.kind === 'open'
          ? request.target.directory
          : (this.leases.get(request.reviewID)?.root ?? ''),
      reviewID: request.kind === 'open' ? undefined : request.reviewID,
    };
    this.active.set(abort, active);
    try {
      if (request.kind === 'open') return await this.open(request.target, owner, origin, signal);
      const lease = this.leases.get(request.reviewID);
      if (!lease || lease.owner !== owner)
        throw new Error('This Git review is unavailable. Refresh it.');
      // Admission order owns the snapshot, even when native checks finish out of
      // order. A cancelled renderer read must never replace a newer mode's list.
      const generation = request.kind === 'read' ? ++lease.generation : lease.generation;
      if (request.kind === 'apply') lease.generation++;
      await this.verify(lease, signal);
      if (request.kind === 'read')
        return { kind: 'snapshot', snapshot: await this.read(lease, request, signal, generation) };
      if (request.kind === 'file')
        return {
          kind: 'file',
          file: await this.file(lease, request.snapshotID, request.fileID, signal),
        };
      const preceding = this.writes.get(lease.root) ?? Promise.resolve();
      const work = preceding
        .catch(() => {})
        .then(() => this.apply(lease, request.fileID, request.hunks, signal));
      this.writes.set(lease.root, work);
      Object.assign(active, { done: work });
      try {
        await work;
      } finally {
        if (this.writes.get(lease.root) === work) this.writes.delete(lease.root);
      }
      return { kind: 'applied' };
    } finally {
      this.active.delete(abort);
      this.pending--;
    }
  }
  private async open(
    target: CapturedTarget,
    owner: number,
    origin: string,
    signal: AbortSignal,
  ): Promise<GitReviewReply> {
    await this.ports.validate(owner, target);
    const result = await this.reader.status(target.directory, true);
    if (result.kind !== 'ready') throw new Error(result.message);
    const root = await realpath(result.snapshot.root);
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Choose an ordinary checkout folder.');
    const admin = await realpath(
      (await this.command(root, ['rev-parse', '--absolute-git-dir'], signal, 32768)).replace(
        /\n$/,
        '',
      ),
    );
    await this.ports.access([admin]);
    const branches = (await this.reader.localBranches(root)).map((branch) => ({
      id: randomUUID(),
      ...branch,
    }));
    if (result.snapshot.commit)
      branches.push({ id: randomUUID(), name: 'HEAD', commit: result.snapshot.commit });
    const id = randomUUID();
    const lease: Lease = {
      owner,
      origin,
      target,
      root,
      identity: identity(info),
      admin,
      adminIdentity: identity(await lstat(admin)),
      marker: await this.marker(root),
      branches,
      issued: Date.now(),
      generation: 0,
      files: new Map(),
    };
    await this.verify(lease, signal);
    for (const [key, value] of this.leases)
      if (Date.now() - value.issued > 5 * 60_000) this.leases.delete(key);
    if (this.leases.size >= 16)
      throw new Error('Close another Git review before opening this one.');
    this.leases.set(id, lease);
    return {
      kind: 'opened',
      reviewID: id,
      branches,
      defaultBaseID:
        branches.find((branch) => branch.name === 'main' || branch.name === 'master')?.id ??
        branches[0]?.id,
    };
  }
  private async read(
    lease: Lease,
    request: Extract<GitReviewRequest, { kind: 'read' }>,
    signal: AbortSignal,
    generation: number,
  ): Promise<ReviewSnapshot> {
    const status = await this.reader.status(lease.root, true);
    if (status.kind !== 'ready') throw new Error(status.message);
    let baseCommit: string | undefined;
    if (request.mode === 'branch') {
      const selected = lease.branches.find((branch) => branch.id === request.baseID);
      const base = selected?.commit ?? request.baseCommit;
      if (!base || !commitPattern.test(base)) throw new Error('Choose a local base branch.');
      if (!status.snapshot.commit)
        throw new Error('Commit this checkout before comparing branches.');
      baseCommit = (
        await this.command(lease.root, ['merge-base', base, status.snapshot.commit], signal, 4096)
      ).trim();
      if (!commitPattern.test(baseCommit))
        throw new Error('The branches have no readable common base.');
    }
    const index = await this.index(lease);
    let files: Omit<ReviewFileEntry, 'id'>[];
    if (request.mode === 'branch') {
      const output = await this.command(
        lease.root,
        ['diff', ...diffOptions, '--name-status', '-z', baseCommit!, '--'],
        signal,
      );
      const fields = output.split('\0');
      if (fields.at(-1) !== '') throw new Error('Incomplete changed-file list.');
      files = [];
      for (let i = 0; i < fields.length - 1; i += 2) {
        const status = fields[i]!,
          file = fields[i + 1];
        if (!/^[MADT]$/.test(status) || !file || !gitRelativePath(file))
          throw new Error('Invalid changed-file list.');
        files.push({ path: file, status });
      }
      for (const item of status.snapshot.changes.filter((item) => item.status === 'untracked'))
        if (!files.some((file) => file.path === item.path))
          files.push({ path: item.path, status: '?', untracked: true });
    } else {
      files = status.snapshot.changes
        .filter((item) =>
          request.mode === 'staged'
            ? !['.', '?'].includes(item.index)
            : item.worktree !== '.' || item.status === 'untracked',
        )
        .map((item) => ({
          path: item.path,
          status:
            item.status === 'conflict'
              ? '!'
              : item.status === 'renamed'
                ? 'R'
                : request.mode === 'staged'
                  ? item.index
                  : item.worktree,
          untracked: item.status === 'untracked',
        }));
    }
    if (files.length > 5000)
      throw new Error('The review exceeds 5,000 changed files. Narrow the repository changes.');
    await this.verify(lease, signal);
    if ((await this.index(lease)) !== index)
      throw new Error('The index changed during review. Refresh it.');
    const snapshot: ReviewSnapshot = {
      id: randomUUID(),
      mode: request.mode,
      root: lease.root,
      branch: status.snapshot.branch,
      head: status.snapshot.commit,
      baseCommit,
      files: files.map((file) => ({ ...file, id: randomUUID() })),
    };
    if (generation !== lease.generation)
      throw new Error('This review read was superseded by a newer request.');
    lease.snapshot = snapshot;
    lease.index = index;
    lease.files.clear();
    return snapshot;
  }
  private async patch(
    lease: Lease,
    snapshot: ReviewSnapshot,
    entry: ReviewFileEntry,
    signal: AbortSignal,
  ): Promise<string> {
    if (!gitRelativePath(entry.path)) throw new Error('Invalid review path.');
    if (entry.untracked) {
      const file = path.join(lease.root, entry.path);
      await this.ports.access([file]);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024)
        throw new Error('Untracked hunk review requires a regular text file up to 4 MiB.');
      return this.command(
        lease.root,
        ['diff', ...diffOptions, '--no-index', '--unified=3', '--', '/dev/null', entry.path],
        signal,
      );
    }
    return this.command(
      lease.root,
      [
        'diff',
        ...diffOptions,
        '--unified=3',
        ...(snapshot.mode === 'staged'
          ? ['--cached']
          : snapshot.mode === 'branch'
            ? [snapshot.baseCommit!]
            : []),
        '--',
        entry.path,
      ],
      signal,
    );
  }
  private async file(
    lease: Lease,
    snapshotID: string,
    entryID: string,
    signal: AbortSignal,
  ): Promise<ReviewFile> {
    const snapshot = lease.snapshot;
    const entry = snapshot?.id === snapshotID && snapshot.files.find((file) => file.id === entryID);
    if (!snapshot || !entry) throw new Error('The changed-file list changed. Refresh it.');
    const index = await this.index(lease);
    if (index !== lease.index) throw new Error('The index changed. Refresh review.');
    const raw = await this.patch(lease, snapshot, entry, signal);
    const patch = parseReviewPatch(raw);
    const unsupported =
      ['!', 'R'].includes(entry.status) ||
      /^(?:old mode|new mode|GIT binary patch|Binary files|.*(?:120000|160000))/m.test(
        patch.header,
      );
    const problem =
      patch.hunks.reduce((count, hunk) => count + hunk.lines.length, 0) > 20000
        ? 'This file exceeds the 20,000-line hunk review limit. Open diff to inspect the file.'
        : unsupported
          ? 'Conflicts, renames, mode changes and binary files need whole-file review.'
          : !patch.hunks.length
            ? 'No text hunks are available for this file.'
            : undefined;
    const result: ReviewFile = {
      id: randomUUID(),
      snapshotID,
      path: entry.path,
      hunks: problem
        ? []
        : patch.hunks.map((hunk) => ({
            id: randomUUID(),
            heading: hunk.heading,
            lines: hunk.lines,
          })),
      problem,
    };
    await this.verify(lease, signal);
    if ((await this.index(lease)) !== index)
      throw new Error('The index changed while reading the file.');
    if (lease.snapshot?.id !== snapshotID)
      throw new Error('This file read was superseded by a newer review.');
    lease.files.set(result.id, { result, patch, hash: digest(raw), index, head: snapshot.head });
    while (lease.files.size > 4) lease.files.delete(lease.files.keys().next().value!);
    const retained = () =>
      [...this.leases.values()]
        .flatMap((lease) => [...lease.files.values()])
        .reduce(
          (bytes, file) =>
            bytes +
            file.patch.header.length +
            file.patch.hunks.reduce((size, hunk) => size + hunk.patch.length, 0),
          0,
        );
    for (const value of this.leases.values()) {
      while (retained() > 16 * 1024 * 1024 && value.files.size)
        value.files.delete(value.files.keys().next().value!);
    }
    return result;
  }
  private async apply(
    lease: Lease,
    id: string,
    hunkIDs: string[],
    signal: AbortSignal,
  ): Promise<void> {
    await this.verify(lease, signal);
    const file = lease.files.get(id),
      snapshot = lease.snapshot;
    if (
      !file ||
      !snapshot ||
      file.result.snapshotID !== snapshot.id ||
      file.result.problem ||
      snapshot.mode === 'branch'
    )
      throw new Error('Read a current stageable file before applying hunks.');
    const wanted = new Set(hunkIDs);
    if (
      !wanted.size ||
      wanted.size !== hunkIDs.length ||
      wanted.size > 2000 ||
      hunkIDs.some((id) => !file.result.hunks.some((hunk) => hunk.id === id))
    )
      throw new Error('Choose hunks from this exact review.');
    const status = await this.reader.status(lease.root, true);
    if (
      status.kind !== 'ready' ||
      status.snapshot.commit !== file.head ||
      (await this.index(lease)) !== file.index
    )
      throw new Error('HEAD or the index changed. Refresh review before staging.');
    const entry = snapshot.files.find((entry) => entry.path === file.result.path)!;
    if (digest(await this.patch(lease, snapshot, entry, signal)) !== file.hash)
      throw new Error('The file changed. Refresh review before staging.');
    const selected = file.patch.hunks.filter((_, index) =>
      wanted.has(file.result.hunks[index]!.id),
    );
    await this.verify(lease, signal);
    await (this.ports.apply ?? applyReviewPatch)(
      lease.root,
      file.patch.header + selected.map((hunk) => hunk.patch).join(''),
      snapshot.mode === 'staged',
      signal,
    );
    lease.files.clear();
    lease.snapshot = undefined;
    lease.generation++;
    this.ports.changed?.(lease.root);
  }
  stopOwner(owner: number): void {
    for (const [id, lease] of this.leases) if (lease.owner === owner) this.leases.delete(id);
    for (const [abort, active] of this.active) if (active.owner === owner) abort.abort();
  }
  async quiesce(root: string): Promise<void> {
    const work: Promise<unknown>[] = [];
    for (const [abort, active] of this.active)
      if (active.root === root || active.root.startsWith(root + path.sep)) {
        abort.abort();
        if (active.done) work.push(active.done);
      }
    await Promise.allSettled(work);
    for (const [id, lease] of this.leases)
      if (lease.root === root || lease.root.startsWith(root + path.sep)) this.leases.delete(id);
  }
  async close(): Promise<void> {
    this.reader.close();
    for (const abort of this.active.keys()) abort.abort();
    this.leases.clear();
    await Promise.allSettled(this.writes.values());
  }
}
