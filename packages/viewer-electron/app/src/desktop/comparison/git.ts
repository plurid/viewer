import { runGit, type GitRunner } from './git-process';
export { runGit, gitEnvironment, gitSafeOptions, type GitRunner } from './git-process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { runGitInspection } from './git-inspection';
import { assertNoGitFilters } from './git-filters';
import { parseGitWorktrees } from '../../domain/comparison/worktrees';
import {
  gitSourceSchema,
  parseGitStatus,
  type GitResult,
  type GitSource,
  type GitSnapshot,
} from '../../domain/comparison/git';

const maximumStatus = 8 * 1024 * 1024;

/** Shared repository snapshots; disabled means no executable probe and no filesystem work. */
export class GitReader {
  private inspections = new Set<GitReader>();
  private pending = new Map<string, Promise<GitResult>>();
  private cached = new Map<string, { at: number; result: GitResult }>();
  private lifetime = new AbortController();
  private compatible?: Promise<void>;
  private lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
  private queued = 0;
  private nextLane = 0;
  constructor(
    private enabled: () => boolean,
    private access: (paths: readonly string[]) => Promise<void>,
    private run: GitRunner = runGit,
  ) {}
  private async inspect<T>(
    signal: AbortSignal,
    read: (reader: GitReader) => Promise<T>,
  ): Promise<T> {
    this.check();
    if (this.inspections.size >= 8)
      throw new Error(
        'Git inspection has reached its concurrent request limit. Retry after another request finishes.',
      );
    signal.throwIfAborted();
    const lifetime = AbortSignal.any([signal, this.lifetime.signal]);
    const reader = new GitReader(
      this.enabled,
      this.access,
      async (directory, args, limit, inner) => {
        const current = AbortSignal.any([lifetime, inner]);
        if (args[0] === 'status' || args[0] === 'diff')
          await assertNoGitFilters(runGitInspection, directory, current);
        return runGitInspection(directory, args, limit, current);
      },
    );
    this.inspections.add(reader);
    try {
      const result = await read(reader);
      lifetime.throwIfAborted();
      return result;
    } finally {
      reader.close();
      this.inspections.delete(reader);
    }
  }
  inspectStatus(file: string, signal: AbortSignal): Promise<GitResult> {
    return this.inspect(signal, (reader) => reader.status(file, true));
  }
  inspectDiff(directory: string, base: string, signal: AbortSignal) {
    return this.inspect(signal, (reader) => reader.diff(directory, base, signal));
  }
  private check() {
    if (!this.enabled()) throw new Error('Git is disabled in Settings.');
    this.lifetime.signal.throwIfAborted();
  }
  private async command(
    directory: string,
    args: readonly string[],
    limit = maximumStatus,
  ): Promise<Buffer> {
    this.check();
    if (this.queued >= 64) throw new Error('Git request queue exceeded its limit.');
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(5000)]);
    const lane = this.nextLane++ % this.lanes.length;
    this.queued++;
    const work = this.lanes[lane]!.catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        await this.access([directory]);
        const bytes = await this.run(directory, args, limit, signal);
        signal.throwIfAborted();
        this.check();
        await this.access([directory]);
        return bytes;
      })
      .finally(() => {
        this.queued--;
      });
    this.lanes[lane] = work;
    return work;
  }
  private async version(directory: string) {
    this.compatible ??= this.command(directory, ['--version'], 4096)
      .then((bytes) => {
        const match = /git version (\d+)\.(\d+)/.exec(bytes.toString());
        if (!match || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 36))
          throw new Error('Read-only Git requires Git 2.36 or newer.');
      })
      .catch((error) => {
        this.compatible = undefined;
        throw error;
      });
    await this.compatible;
  }
  private async directory(file: string) {
    await this.access([file]);
    return realpath(file).catch(async () =>
      path.join(await realpath(path.dirname(file)), path.basename(file)),
    );
  }
  /** Locate before scanning so a scoped caller can authorize the whole checkout first. */
  async root(file: string): Promise<string> {
    this.check();
    const directory = await this.directory(file);
    await this.version(directory);
    const root = new TextDecoder('utf-8', { fatal: true })
      .decode(await this.command(directory, ['rev-parse', '--show-toplevel'], 32768))
      .replace(/\n$/, '');
    const actual = await realpath(root);
    if (directory !== actual && !directory.startsWith(actual + path.sep))
      throw new Error('Git returned a repository outside the requested folder.');
    return actual;
  }
  async status(file: string, refresh = false): Promise<GitResult> {
    if (!this.enabled())
      return { kind: 'disabled', message: 'Enable Git in Settings to show repository status.' };
    const previous = this.cached.get(file);
    if (!refresh && previous && Date.now() - previous.at < 3000) return previous.result;
    const active = this.pending.get(file);
    if (active) return active;
    const work = this.readStatus(file)
      .then((result) => {
        if (!this.enabled())
          return { kind: 'disabled' as const, message: 'Git is disabled in Settings.' };
        if (this.cached.size >= 128) this.cached.delete(this.cached.keys().next().value!);
        this.cached.set(file, { at: Date.now(), result });
        return result;
      })
      .finally(() => {
        if (this.pending.get(file) === work) this.pending.delete(file);
      });
    this.pending.set(file, work);
    return work;
  }
  private async readStatus(file: string): Promise<GitResult> {
    try {
      const directory = await this.directory(file);
      await this.version(directory);
      const root = (await this.command(directory, ['rev-parse', '--show-toplevel'], 32768))
        .toString('utf8')
        .replace(/\n$/, '');
      const actual = await realpath(root);
      if (directory !== actual && !directory.startsWith(actual + path.sep))
        throw new Error('Git returned a repository outside the requested folder.');
      // Different folder planes share the same in-flight repository scan.
      if (actual !== file) {
        const existing = this.pending.get(actual);
        if (existing) {
          const result = await existing;
          return result.kind === 'ready' ? { ...result, canonical: directory } : result;
        }
      }
      const scan = this.command(actual, [
        'status',
        '--porcelain=v2',
        '-z',
        '--branch',
        '--untracked-files=all',
        '--ignore-submodules=all',
      ]).then((bytes) => ({
        kind: 'ready' as const,
        snapshot: parseGitStatus(new TextDecoder('utf-8', { fatal: true }).decode(bytes), actual),
      }));
      if (actual !== file) this.pending.set(actual, scan);
      try {
        return { ...(await scan), canonical: directory };
      } finally {
        if (this.pending.get(actual) === scan) this.pending.delete(actual);
      }
    } catch (error) {
      const message = (error as Error).message;
      return {
        kind: /not a git repository/i.test(message)
          ? 'outside'
          : /limit|timeout|abort/i.test(message)
            ? 'limited'
            : 'unavailable',
        message,
      };
    }
  }
  /** Fixed read-only diff. Resolve the base to an immutable commit before passing it to Git. */
  async diff(directory: string, base: string, outerSignal: AbortSignal) {
    this.check();
    if (!base || base.length > 300 || /[\0\r\n]/.test(base))
      throw new Error('Choose a branch or commit as the diff base.');
    const root = await this.root(directory);
    await this.access([root]);
    const signal = AbortSignal.any([outerSignal, this.lifetime.signal, AbortSignal.timeout(30000)]);
    const commit = new TextDecoder('utf-8', { fatal: true })
      .decode(
        await this.run(
          root,
          ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'],
          1024,
          signal,
        ),
      )
      .trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))
      throw new Error('Git returned an invalid base commit.');
    const patch = new TextDecoder('utf-8', { fatal: true }).decode(
      await this.run(
        root,
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--ignore-submodules=all',
          commit,
          '--',
        ],
        4 * 1024 * 1024,
        signal,
      ),
    );
    await this.access([root]);
    signal.throwIfAborted();
    return { root, base, commit, patch, includesUntracked: false, observed: Date.now() };
  }
  async head(file: string): Promise<{ kind: 'head'; source: GitSource | null; root: string }> {
    this.check();
    const actual = await this.directory(file),
      parent = path.dirname(actual);
    const result = await this.status(parent, true);
    if (result.kind !== 'ready') throw new Error(result.message);
    const snapshot: GitSnapshot = result.snapshot;
    let relative = path.relative(snapshot.root, actual);
    const change = snapshot.changes.find((item) => item.path === relative);
    if (change?.original) relative = change.original;
    const source: GitSource | null = snapshot.commit
      ? { kind: 'git', repository: snapshot.root, commit: snapshot.commit, path: relative }
      : null;
    return {
      kind: 'head',
      source: source && (await this.object(source)) ? source : null,
      root: snapshot.root,
    };
  }
  /** Also used by explicit discovery under its own direct-build policy, independent of badges. */
  async localBranches(directory: string): Promise<{ name: string; commit: string }[]> {
    const output = (
      await this.command(
        directory,
        ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads/'],
        1024 * 1024,
      )
    ).toString('utf8');
    if (!output) return [];
    const lines = output.replace(/\n$/, '').split('\n');
    if (lines.length > 512) throw new Error('Worktree creation supports up to 512 local branches.');
    return lines.map((line) => {
      const [ref, commit, extra] = line.split('\0');
      if (
        !ref?.startsWith('refs/heads/') ||
        !commit ||
        extra !== undefined ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)
      )
        throw new Error('Git returned an invalid local branch.');
      return { name: ref.slice(11), commit };
    });
  }
  /** Also used by explicit discovery under its own direct-build policy, independent of badges. */
  async worktrees(file: string) {
    this.check();
    const directory = await this.directory(file);
    await this.version(directory);
    const common = (
      await this.command(
        directory,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        32768,
      )
    )
      .toString('utf8')
      .replace(/\n$/, '');
    if (!path.isAbsolute(common)) throw new Error('Git returned a relative repository directory.');
    await this.access([common]);
    const commonDirectory = await realpath(common);
    const output = await this.command(directory, ['worktree', 'list', '--porcelain', '-z']);
    return {
      currentPath: directory,
      commonDirectory,
      worktrees: parseGitWorktrees(new TextDecoder('utf-8', { fatal: true }).decode(output)),
    };
  }
  private async object(source: GitSource): Promise<string | undefined> {
    this.check();
    gitSourceSchema.parse(source);
    const directory = await realpath(source.repository);
    await this.version(directory);
    const record = (
      await this.command(directory, ['ls-tree', '-z', source.commit, '--', source.path], 65536)
    ).toString('utf8');
    if (!record) return undefined;
    const match = /^100(?:644|755) blob ((?:[0-9a-f]{40}|[0-9a-f]{64}))\t([^\0]+)\0$/.exec(record);
    if (!match || match[2] !== source.path)
      throw new Error('Only exact regular Git blobs can be compared.');
    return match[1];
  }
  async blob(source: GitSource): Promise<Buffer> {
    const object = await this.object(source);
    if (!object) throw new Error('This file is absent from the selected commit.');
    return this.command(source.repository, ['cat-file', 'blob', object], 64 * 1024 * 1024);
  }
  invalidate() {
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cached.clear();
    this.pending.clear();
    this.compatible = undefined;
  }
  close() {
    this.lifetime.abort();
    this.cached.clear();
  }
}
