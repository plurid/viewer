import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { CapturedTarget, TerminalStart } from '../../domain/automation/actions';
import {
  gitActionKinds,
  gitActionLabels,
  gitTerminalProfileID,
  gitCommitMessageLimit,
  readOnlyGitAction,
  type GitActionKind,
  type GitActionReply,
  type GitActionRequest,
} from '../../domain/comparison/git-actions';
import { entry } from '../files/filesystem';
import { childEnvironment } from '../terminals/process-environment';
import { runGit, type GitRunner } from './git';

/** Private desktop launch specification. No public IPC accepts any of these program fields. */
export interface GitTerminalLaunch {
  request: TerminalStart;
  executable: '/usr/bin/git';
  args: string[];
  env: Record<string, string>;
  kind: GitActionKind;
  outputLimit: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface GitActionsOptions {
  direct: boolean;
  access(paths: readonly string[]): Promise<void>;
  validateTarget(owner: number, target: CapturedTarget): Promise<void> | void;
  launch(program: GitTerminalLaunch, owner: number): Promise<void>;
  readGit?: GitRunner;
  environment?: () => Record<string, string>;
}

interface Repository {
  root: string;
  gitDirectory: string;
  commonDirectory: string;
  branch?: string;
  fingerprint: string;
}

interface Ticket {
  owner: number;
  target: CapturedTarget;
  abort: AbortController;
  repository?: string;
  promise: Promise<GitActionReply>;
}

const processOptions = [
  '--no-pager',
  '--literal-pathspecs',
  '--no-replace-objects',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
];

const readOptions = [
  '--no-optional-locks',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'credential.helper=',
  '-c',
  'core.askPass=/usr/bin/false',
  '-c',
  'protocol.allow=never',
  '-c',
  'submodule.recurse=false',
  '-c',
  'color.ui=false',
];

/** Clear inherited repository/configuration redirection without inspecting credentials. */
export function gitActionEnvironment(
  kind: GitActionKind,
  inherited: Record<string, string> = childEnvironment(),
): Record<string, string> {
  const clean = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => !key.startsWith('GIT_') && key !== 'GPG_TTY'),
  );
  if (readOnlyGitAction(kind))
    return {
      PATH: '/usr/bin:/bin',
      HOME: os.homedir(),
      LANG: 'C.UTF-8',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/usr/bin/false',
      SSH_ASKPASS: '/usr/bin/false',
      GIT_NO_LAZY_FETCH: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
    };
  return {
    ...clean,
    GIT_TERMINAL_PROMPT: '1',
    GIT_MERGE_AUTOEDIT: 'no',
    GIT_EDITOR: '/usr/bin/false',
    GIT_SEQUENCE_EDITOR: '/usr/bin/false',
    GIT_PAGER: 'cat',
    GIT_NO_REPLACE_OBJECTS: '1',
  };
}

function boundedArgument(value: unknown, label: string, maximum = 32768): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    Buffer.byteLength(value) > maximum
  )
    throw new Error(`${label} is empty, contains a null character or exceeds its size limit.`);
}

const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};

const identity = (value: Stats) => `${value.dev}:${value.ino}`;

async function metadataStamp(file: string): Promise<unknown> {
  try {
    const [link, target, canonical] = await Promise.all([lstat(file), stat(file), realpath(file)]);
    return [
      canonical,
      link.dev,
      link.ino,
      link.ctimeMs,
      target.dev,
      target.ino,
      target.size,
      target.mtimeMs,
      target.ctimeMs,
      target.mode,
    ];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function headText(gitDirectory: string): Promise<string> {
  const handle = await open(
    path.join(gitDirectory, 'HEAD'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096)
      throw new Error('Git HEAD is not a bounded regular file.');
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 4096) throw new Error('Git HEAD changed while it was read.');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function branchReference(value: string): boolean {
  return (
    value.startsWith('refs/heads/') &&
    value.length <= 4096 &&
    !/[\u0000-\u0020\u007f:*?\[\\]/.test(value) &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.')
  );
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new Error('Git action cancelled before launch.'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

/** Fixed human Git actions, separate from opt-in hardened badge reads and editable custom actions. */
export class GitActions {
  private readonly pending = new Map<string, { fingerprint: string; ticket: Ticket }>();
  private readonly launched = new Map<string, { fingerprint: string; reply: GitActionReply }>();
  private closed = false;
  constructor(private readonly options: GitActionsOptions) {}

  start(input: GitActionRequest, owner: number): Promise<GitActionReply> {
    if (!this.options.direct)
      return Promise.reject(new Error('Git actions are available in the direct build only.'));
    if (this.closed) return Promise.reject(new Error('Git actions have closed.'));
    const request = structuredClone(input);
    const key = `${owner}:${request.id}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const previous = this.launched.get(key);
    if (previous)
      return previous.fingerprint === fingerprint
        ? Promise.resolve(previous.reply)
        : Promise.reject(new Error('This Git terminal belongs to another action.'));
    const pending = this.pending.get(key);
    if (pending)
      return pending.fingerprint === fingerprint
        ? pending.ticket.promise
        : Promise.reject(new Error('This Git terminal is preparing another action.'));
    if (this.pending.size >= 20)
      return Promise.reject(new Error('Wait for another Git action to finish preparing.'));
    if (this.launched.size >= 4096)
      return Promise.reject(new Error('Reopen this window before starting more Git actions.'));
    const ticket: Ticket = {
      owner,
      target: request.target,
      abort: new AbortController(),
      promise: Promise.resolve({ id: request.id, root: '', title: '' }),
    };
    ticket.promise = abortable(this.prepare(request, ticket), ticket.abort.signal)
      .then((reply) => {
        this.launched.set(key, { fingerprint, reply });
        return reply;
      })
      .finally(() => {
        if (this.pending.get(key)?.ticket === ticket) this.pending.delete(key);
      });
    this.pending.set(key, { fingerprint, ticket });
    return ticket.promise;
  }

  private check(ticket: Ticket): void {
    if (this.closed || ticket.abort.signal.aborted)
      throw new Error('Git action cancelled before launch.');
  }

  private read(directory: string, args: readonly string[], ticket: Ticket): Promise<Buffer> {
    this.check(ticket);
    return (this.options.readGit ?? runGit)(
      directory,
      args,
      65536,
      AbortSignal.any([ticket.abort.signal, AbortSignal.timeout(5000)]),
    );
  }

  private async repository(directory: string, ticket: Ticket): Promise<Repository> {
    await this.options.access([directory]);
    const cwd = await realpath(directory);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Choose a folder in a Git worktree.');
    const readPath = async (args: string[]) => {
      const bytes = await this.read(cwd, args, ticket);
      const result = bytes.toString('utf8').replace(/\n$/, '');
      boundedArgument(result, 'Git repository path');
      return realpath(result);
    };
    const [root, gitDirectory, commonDirectory] = await Promise.all([
      readPath(['rev-parse', '--show-toplevel']),
      readPath(['rev-parse', '--absolute-git-dir']),
      readPath(['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    if (!inside(root, cwd))
      throw new Error('The selected folder is outside the resolved Git worktree.');
    await this.options.access([root, gitDirectory, commonDirectory]);
    const [rootInfo, gitInfo, commonInfo, head] = await Promise.all([
      stat(root),
      stat(gitDirectory),
      stat(commonDirectory),
      headText(gitDirectory),
    ]);
    if (![rootInfo, gitInfo, commonInfo].every((info) => info.isDirectory()))
      throw new Error('The Git repository directories changed.');
    const branch = head.startsWith('ref: ') ? head.slice(5).replace(/\n$/, '') : undefined;
    if (branch && !branchReference(branch))
      throw new Error('Git returned an invalid branch reference.');
    const paths = [
      path.join(root, '.git'),
      path.join(gitDirectory, 'HEAD'),
      path.join(gitDirectory, 'index'),
      path.join(commonDirectory, 'config'),
      path.join(gitDirectory, 'config.worktree'),
      path.join(commonDirectory, 'packed-refs'),
      ...(branch ? [path.join(commonDirectory, branch)] : []),
    ];
    const metadata = await Promise.all(paths.map(metadataStamp));
    const fingerprint = JSON.stringify([
      root,
      gitDirectory,
      commonDirectory,
      identity(rootInfo),
      identity(gitInfo),
      identity(commonInfo),
      head,
      metadata,
    ]);
    return { root, gitDirectory, commonDirectory, branch, fingerprint };
  }

  private async selection(target: CapturedTarget, root: string): Promise<string[]> {
    if (target.selection.length > 1000)
      throw new Error('Select at most 1,000 paths, or stage the whole repository.');
    const paths: string[] = [];
    for (const captured of target.selection) {
      const selected = path.resolve(captured.path);
      const current = await entry(selected);
      if (
        current.identity !== captured.identity ||
        current.modified !== captured.modified ||
        current.size !== captured.size
      )
        throw new Error(`Selection changed: ${captured.name}. Select it again.`);
      const canonical = path.join(await realpath(path.dirname(selected)), path.basename(selected));
      if (!inside(root, canonical)) throw new Error('A selected path is outside this repository.');
      const relative = path.relative(root, canonical).split(path.sep).join('/') || '.';
      boundedArgument(relative, 'Selected Git path');
      paths.push(relative);
    }
    if (Buffer.byteLength(paths.join('\0')) > 128 * 1024)
      throw new Error(
        'The selected paths exceed Git’s argument budget. Stage the repository instead.',
      );
    return [...new Set(paths)];
  }

  private async command(
    request: GitActionRequest,
    repository: Repository,
    paths: string[],
    ticket: Ticket,
  ): Promise<string[]> {
    switch (request.kind) {
      case 'status':
        return [
          'status',
          '--short',
          '--branch',
          '--untracked-files=normal',
          '--ignore-submodules=all',
        ];
      case 'log':
        return [
          'log',
          '--max-count=100',
          '--date=iso-strict',
          '--format=%h %ad %s',
          '--no-show-signature',
          '--no-decorate',
        ];
      case 'stage-selected':
        if (!paths.length) throw new Error('Select files or folders to stage.');
        return ['add', '--', ...paths];
      case 'stage-all':
        return ['add', '--all', '--', '.'];
      case 'commit':
        if (!repository.branch) throw new Error('Choose a branch before committing in Viewer.');
        return ['commit', '-m', request.message];
      case 'pull': {
        if (!repository.branch) throw new Error('Choose a branch before pulling.');
        const upstream = await this.upstream(repository, ticket);
        return [
          'pull',
          '--ff-only',
          '--no-rebase',
          '--no-squash',
          '--no-autostash',
          '--recurse-submodules=no',
          '--',
          upstream.remote,
          upstream.reference,
        ];
      }
      case 'push': {
        const upstream = await this.upstream(repository, ticket);
        return [
          // Git reapplies remote.<name>.mirror after parsing --no-mirror.
          // Override that config as well as supplying the explicit safe refspec.
          '-c',
          `remote.${upstream.remote}.mirror=false`,
          'push',
          '--porcelain',
          '--no-force',
          '--no-mirror',
          '--no-follow-tags',
          '--recurse-submodules=no',
          '--',
          upstream.remote,
          `HEAD:${upstream.reference}`,
        ];
      }
      default:
        throw new Error('This Git action is unavailable.');
    }
  }

  private async upstream(
    repository: Repository,
    ticket: Ticket,
  ): Promise<{ remote: string; reference: string }> {
    if (!repository.branch) throw new Error('Choose a branch before pushing or pulling.');
    const bytes = await this.read(
      repository.root,
      [
        'for-each-ref',
        '--format=%(upstream:remotename)%00%(upstream:remoteref)',
        repository.branch,
      ],
      ticket,
    );
    const [remote, reference, extra] = bytes.toString('utf8').replace(/\n$/, '').split('\0');
    if (
      !remote ||
      !reference ||
      extra !== undefined ||
      !branchReference(reference) ||
      (remote !== '.' && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(remote))
    )
      throw new Error(
        'This branch has no usable configured upstream. Set its upstream in a terminal first.',
      );
    return { remote, reference };
  }

  private async prepare(request: GitActionRequest, ticket: Ticket): Promise<GitActionReply> {
    boundedArgument(request.id, 'Git terminal ID', 200);
    if (!gitActionKinds.includes(request.kind)) throw new Error('This Git action is unavailable.');
    for (const [label, value] of [
      ['columns', request.cols ?? 80],
      ['rows', request.rows ?? 24],
    ] as const)
      if (!Number.isSafeInteger(value) || value < 2 || value > 1000)
        throw new Error(`Git terminal ${label} must be between 2 and 1,000.`);
    if (request.kind === 'commit') {
      boundedArgument(request.message, 'Commit message', gitCommitMessageLimit);
      if (!request.message.trim()) throw new Error('Enter a commit message.');
    } else if ('message' in request) throw new Error('Only Commit accepts a message.');
    await this.options.validateTarget(ticket.owner, request.target);
    this.check(ticket);
    const repository = await this.repository(request.target.directory, ticket);
    ticket.repository = repository.root;
    const paths = await this.selection(request.target, repository.root);
    const command = await this.command(request, repository, paths, ticket);
    this.check(ticket);
    await this.options.validateTarget(ticket.owner, request.target);
    await this.options.access([
      repository.root,
      ...request.target.selection.map((file) => file.path),
    ]);
    const after = await this.repository(request.target.directory, ticket);
    if (after.fingerprint !== repository.fingerprint)
      throw new Error(
        'The repository, index or branch changed during preparation. Run the action again.',
      );
    await this.selection(request.target, repository.root);
    this.check(ticket);
    const title = `Git ${gitActionLabels[request.kind]} · ${path.basename(repository.root) || repository.root}`;
    const readonly = readOnlyGitAction(request.kind);
    await this.options.launch(
      {
        request: {
          id: request.id,
          workspaceID: request.target.workspaceID,
          rootID: request.target.rootID,
          cwd: repository.root,
          profileID: gitTerminalProfileID,
          cols: request.cols ?? 80,
          rows: request.rows ?? 24,
        },
        executable: '/usr/bin/git',
        args: [
          ...processOptions,
          ...(readonly ? readOptions : []),
          '-C',
          repository.root,
          ...command,
        ],
        env: gitActionEnvironment(request.kind, this.options.environment?.()),
        kind: request.kind,
        outputLimit: readonly ? 256 * 1024 : 1024 * 1024,
        timeoutMs: readonly ? 15000 : 10 * 60 * 1000,
        signal: ticket.abort.signal,
      },
      ticket.owner,
    );
    return { id: request.id, root: repository.root, title };
  }

  /** Closing a plane cancels preparation before any PTY exists. */
  stop(id: string, owner: number): void {
    this.pending.get(`${owner}:${id}`)?.ticket.abort.abort();
  }

  stopOwner(owner: number): void {
    for (const { ticket } of this.pending.values())
      if (ticket.owner === owner) ticket.abort.abort();
    for (const key of this.launched.keys())
      if (key.startsWith(`${owner}:`)) this.launched.delete(key);
  }

  async quiesce(root: string): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const { ticket } of this.pending.values())
      if (
        inside(root, ticket.target.directory) ||
        (ticket.repository && inside(root, ticket.repository))
      ) {
        ticket.abort.abort();
        pending.push(ticket.promise);
      }
    await Promise.allSettled(pending);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const { ticket } of this.pending.values()) ticket.abort.abort();
    await Promise.allSettled([...this.pending.values()].map(({ ticket }) => ticket.promise));
    this.launched.clear();
  }
}
