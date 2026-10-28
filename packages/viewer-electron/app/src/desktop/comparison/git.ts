import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseGitWorktrees } from '../../domain/comparison/worktrees';
import {
  gitSourceSchema,
  parseGitStatus,
  type GitResult,
  type GitSource,
  type GitSnapshot,
} from '../../domain/comparison/git';

const maximumStatus = 8 * 1024 * 1024;
export const gitSafeOptions = [
  '--no-pager',
  '--no-optional-locks',
  '--no-replace-objects',
  '--literal-pathspecs',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
  '-c',
  'status.submoduleSummary=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'protocol.allow=never',
  '-c',
  'credential.helper=',
  '-c',
  'core.askPass=/usr/bin/false',
];
export type GitRunner = (
  directory: string,
  args: readonly string[],
  limit: number,
  signal: AbortSignal,
) => Promise<Buffer>;
export const gitEnvironment = () => ({
  PATH: '/usr/bin:/bin',
  HOME: os.homedir(),
  LANG: 'C.UTF-8',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/usr/bin/false',
  SSH_ASKPASS: '/usr/bin/false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
});
/** No shell, inherited Git configuration overrides, credential helpers, or network transports. */
export const runGit: GitRunner = (directory, args, limit, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/git', [...gitSafeOptions, '-C', directory, ...args], {
      env: gitEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0,
      errors = '',
      failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      child.kill('SIGKILL');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) stop('Git output exceeded its size limit.');
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length + chunk.length > 65536) stop('Git diagnostics exceeded their size limit.');
      else errors += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      failure ??= error;
    });
    child.on('close', (code) => {
      if (failure) reject(failure);
      else if (code !== 0 && !(code === 1 && args[0] === 'diff' && args.includes('--no-index')))
        reject(new Error(errors.trim().slice(0, 1000) || 'Git is unavailable.'));
      else resolve(Buffer.concat(chunks));
    });
  });

/** Shared repository snapshots; disabled means no executable probe and no filesystem work. */
export class GitReader {
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
