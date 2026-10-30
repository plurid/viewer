import fs from 'node:fs/promises';
import { launchWorker, type OwnedWorker } from '../workers/utility-client';
import type {
  TerminalEvent,
  TerminalProfile,
  TerminalStart,
} from '../../domain/automation/actions';
import type { ApplicationSettings } from '../../domain/services';
import { absolute } from '../files/filesystem';
import { executablePath } from './terminal-launch';
import { terminateTerminalGroup } from './terminal-groups';
import { childEnvironment } from './process-environment';
import { errorMessage } from '../../domain/errors';
import {
  gitTerminalProfileID,
  readOnlyGitAction,
  type GitActionKind,
} from '../../domain/comparison/git-actions';
import type { GitTerminalLaunch } from '../comparison/git-actions';
import type { TerminalWorkerReply, TerminalWorkerRequest } from './terminal-protocol';
import { containsPath } from '../files/containment';

interface PendingTerminal {
  owner: number;
  request: TerminalStart;
  cancelled: boolean;
  git?: GitActionKind;
  promise: Promise<void>;
}

interface TerminalSession {
  owner: number;
  request: TerminalStart;
  output: string;
  cwd: string;
  git?: GitActionKind;
}

export class Terminals {
  private closed = false;
  private worker?: OwnedWorker<TerminalWorkerReply>;
  private groups = new Map<string, number>();
  /** Keep a repository reserved until all descendants are confirmed stopped, even after exit. */
  private gitMutations = new Map<string, string>();
  private cleanup = new Set<Promise<void>>();
  private failedCleanup = new Map<string, { cwd: string; error: Error }>();
  private pending = new Map<string, PendingTerminal>();
  private sessions = new Map<string, TerminalSession>();
  private stopping = new Map<
    string,
    {
      promise: Promise<void>;
      finish(): void;
      fail(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      cwd: string;
    }
  >();
  constructor(
    private workerPath: string,
    private settings: () => ApplicationSettings,
    private emit: (owner: number, event: TerminalEvent) => void,
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    /** Resolves once the person has confirmed this exact profile, or it needs no confirmation. */
    private confirm: (profile: TerminalProfile) => Promise<void> = async () => {},
  ) {}
  start(request: TerminalStart, owner: number): Promise<void> {
    if (request.profileID === gitTerminalProfileID)
      return Promise.reject(new Error('Git actions start only through their reviewed command.'));
    if (this.closed) return Promise.reject(new Error('Terminals have closed.'));
    if (this.failedCleanup.has(request.id))
      return Promise.reject(
        new Error(
          'Restart Viewer before reusing this terminal; its previous shell could not be confirmed stopped.',
        ),
      );
    if (this.stopping.has(request.id))
      return Promise.reject(new Error('This terminal is still stopping.'));
    const pending = this.pending.get(request.id);
    if (pending) {
      if (
        pending.owner !== owner ||
        pending.request.workspaceID !== request.workspaceID ||
        pending.request.rootID !== request.rootID ||
        pending.request.cwd !== request.cwd ||
        pending.request.profileID !== request.profileID
      )
        return Promise.reject(new Error('Terminal belongs to another plane.'));
      return pending.promise;
    }
    const ticket = { owner, request, cancelled: false, promise: Promise.resolve() };
    this.pending.set(request.id, ticket);
    ticket.promise = this.prepare(request, owner).finally(() => {
      if (this.pending.get(request.id) === ticket) this.pending.delete(request.id);
    });
    return ticket.promise;
  }

  /** Called only by GitActions after compiling a fixed operation and reviewing mutations. */
  startGit(program: GitTerminalLaunch, owner: number): Promise<void> {
    const { request } = program;
    if (process.mas)
      return Promise.reject(new Error('Git actions are available in the direct build only.'));
    if (this.closed) return Promise.reject(new Error('Terminals have closed.'));
    if (
      program.executable !== '/usr/bin/git' ||
      request.profileID !== gitTerminalProfileID ||
      !Number.isSafeInteger(program.outputLimit) ||
      program.outputLimit < 1 ||
      program.outputLimit > 1024 * 1024 ||
      !Number.isSafeInteger(program.timeoutMs) ||
      program.timeoutMs < 1 ||
      program.timeoutMs > 10 * 60 * 1000
    )
      return Promise.reject(new Error('The private Git launch specification is invalid.'));
    if (
      this.failedCleanup.has(request.id) ||
      this.stopping.has(request.id) ||
      this.sessions.has(request.id) ||
      this.pending.has(request.id)
    )
      return Promise.reject(
        new Error('This Git terminal has already started or is still stopping.'),
      );
    if (!readOnlyGitAction(program.kind)) {
      const busy = [...this.sessions.values(), ...this.pending.values()].some(
        (session) =>
          session.git !== undefined &&
          !readOnlyGitAction(session.git) &&
          session.request.cwd === request.cwd,
      );
      if (busy || [...this.gitMutations.values()].includes(request.cwd))
        return Promise.reject(new Error('Another Git action is still changing this repository.'));
    }
    const ticket: PendingTerminal = {
      owner,
      request,
      git: program.kind,
      cancelled: false,
      promise: Promise.resolve(),
    };
    this.pending.set(request.id, ticket);
    const cancel = () => this.stop(request.id, owner);
    program.signal.addEventListener('abort', cancel, { once: true });
    ticket.promise = this.prepareGit(program, ticket).finally(() => {
      program.signal.removeEventListener('abort', cancel);
      if (this.pending.get(request.id) === ticket) this.pending.delete(request.id);
    });
    return ticket.promise;
  }

  private async prepareGit(program: GitTerminalLaunch, ticket: PendingTerminal): Promise<void> {
    const check = () => {
      if (this.closed || ticket.cancelled || program.signal.aborted)
        throw new Error('Git action cancelled before launch.');
    };
    check();
    if (this.sessions.size + this.pending.size > 100)
      throw new Error('Close a terminal before opening another.');
    const { request } = program;
    await this.access([request.cwd]);
    check();
    const cwd = await fs.realpath(absolute(request.cwd));
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error('The Git repository is unavailable.');
    if (cwd !== request.cwd) throw new Error('The Git repository moved before launch.');
    await this.access([cwd]);
    check();
    if (!readOnlyGitAction(program.kind)) {
      const busy = [...this.sessions.values(), ...this.pending.values()].some(
        (session) =>
          session !== ticket &&
          session.git !== undefined &&
          !readOnlyGitAction(session.git) &&
          session.request.cwd === cwd,
      );
      if (busy || [...this.gitMutations.values()].includes(cwd))
        throw new Error('Another Git action is still changing this repository.');
    }
    const worker = this.ensureWorker();
    this.sessions.set(request.id, {
      owner: ticket.owner,
      request,
      cwd,
      output: '',
      git: program.kind,
    });
    if (!readOnlyGitAction(program.kind)) this.gitMutations.set(request.id, cwd);
    const message: TerminalWorkerRequest = {
      kind: 'start',
      ...request,
      cwd,
      executable: program.executable,
      args: program.args,
      env: { ...program.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      readOnly: readOnlyGitAction(program.kind),
      outputLimit: program.outputLimit,
      timeoutMs: program.timeoutMs,
    };
    try {
      worker.postMessage(message);
    } catch (error) {
      this.sessions.delete(request.id);
      this.gitMutations.delete(request.id);
      throw error;
    }
  }
  private async prepare(request: TerminalStart, owner: number): Promise<void> {
    const existing = this.sessions.get(request.id);
    if (existing) {
      if (
        existing.owner !== owner ||
        existing.request.workspaceID !== request.workspaceID ||
        existing.request.rootID !== request.rootID ||
        existing.request.profileID !== request.profileID ||
        existing.request.cwd !== request.cwd
      )
        throw new Error('Terminal belongs to another plane.');
      return;
    }
    if (this.sessions.size + this.pending.size > 100)
      throw new Error('Close a terminal before opening another.');
    await this.access([request.cwd]);
    const cwd = await fs.realpath(absolute(request.cwd));
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error('Terminal folder is unavailable.');
    const profile = this.settings().terminals.profiles.find(
      (profile) => profile.id === request.profileID,
    );
    if (!profile)
      throw new Error('Terminal profile no longer exists. Choose a profile in Settings.');
    // A profile from imported or edited configuration starts only once confirmed natively,
    // including a saved terminal plane that would otherwise start on restore.
    await this.confirm(profile);
    if (this.closed || this.pending.get(request.id)?.cancelled) return;
    const executable = await executablePath(
      profile.executable ||
        process.env.SHELL ||
        (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'),
    );
    if (this.closed || this.pending.get(request.id)?.cancelled) return;
    await this.access([request.cwd, cwd]);
    if (this.closed || this.pending.get(request.id)?.cancelled) return;
    const worker = this.ensureWorker();
    this.sessions.set(request.id, { owner, request, cwd, output: '' });
    const env = childEnvironment({
      ...profile.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    });
    worker.postMessage({
      kind: 'start',
      ...request,
      cwd,
      executable,
      args: profile.args,
      env,
    });
  }
  private ensureWorker(): OwnedWorker<TerminalWorkerReply> {
    if (this.worker) return this.worker;
    // One PTY worker per desktop. MAS threads share dynamic picker grants;
    // node-pty is never loaded concurrently by multiple terminal threads.
    const worker = launchWorker<TerminalWorkerReply>(
      this.workerPath,
      'Viewer terminals',
      process.mas ? 'thread' : undefined,
    );
    this.worker = worker;
    let diagnostic = '';
    worker.thread?.on('error', (error: unknown) => {
      diagnostic = errorMessage(error);
    });
    const capture = (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-2000);
    };
    if (worker.thread) worker.thread.stderr?.on('data', capture);
    else worker.process?.stderr?.on('data', capture);
    worker.message((event) => {
      if (event.type === 'started') {
        if (Number.isSafeInteger(event.pid) && event.pid > 1) this.groups.set(event.id, event.pid);
        return;
      }
      if (event.type === 'exit') {
        this.reap(event.id, event);
        return;
      }
      const session = this.sessions.get(event.id);
      if (!session) return;
      if (event.type === 'data') session.output = (session.output + event.data).slice(-128_000);
      this.emit(session.owner, event);
      if (event.type === 'error') this.stop(event.id, session.owner);
    });
    worker.exit(() => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const [id, session] of this.sessions) {
        this.emit(session.owner, {
          type: 'error',
          id,
          message:
            'Terminal process stopped. Reopen the terminal to start a fresh shell.' +
            (diagnostic ? '\n' + diagnostic : ''),
        });
        this.reap(id);
      }
      for (const id of this.stopping.keys()) if (!this.sessions.has(id)) this.reap(id);
    });
    return worker;
  }
  private reap(id: string, event?: TerminalEvent): void {
    const pid = this.groups.get(id),
      session = this.sessions.get(id),
      stopping = this.stopping.get(id);
    this.sessions.delete(id);
    if (stopping) clearTimeout(stopping.timer);
    const work = (async () => {
      try {
        if (pid) await terminateTerminalGroup(pid);
        else if (!event)
          throw new Error('The terminal worker stopped before confirming its shell process.');
        this.gitMutations.delete(id);
        if (event && session) this.emit(session.owner, event);
        stopping?.finish();
        if (this.stopping.get(id) === stopping) this.stopping.delete(id);
      } catch (error) {
        this.failedCleanup.set(id, {
          cwd: session?.cwd ?? stopping?.cwd ?? '',
          error: error as Error,
        });
        stopping?.fail(error as Error);
        if (session) this.emit(session.owner, { type: 'error', id, message: errorMessage(error) });
      } finally {
        if (this.groups.get(id) === pid) this.groups.delete(id);
      }
    })();
    this.cleanup.add(work);
    void work.finally(() => this.cleanup.delete(work));
  }
  private owned(id: string, owner: number): void {
    if (this.sessions.get(id)?.owner !== owner) throw new Error('Terminal is no longer available.');
  }
  write(id: string, data: string, owner: number): void {
    this.owned(id, owner);
    const git = this.sessions.get(id)?.git;
    if (git !== undefined && readOnlyGitAction(git))
      throw new Error('Read-only Git output does not accept terminal input.');
    this.worker?.postMessage({ kind: 'write', id, data });
  }
  resize(id: string, cols: number, rows: number, owner: number): void {
    this.owned(id, owner);
    this.worker?.postMessage({ kind: 'resize', id, cols, rows });
  }
  ack(id: string, bytes: number, owner: number): void {
    if (this.sessions.get(id)?.owner === owner)
      this.worker?.postMessage({ kind: 'ack', id, bytes });
  }
  stop(id: string, owner: number): void {
    const pending = this.pending.get(id);
    if (pending?.owner === owner) pending.cancelled = true;
    if (this.sessions.get(id)?.owner === owner) {
      const cwd = this.sessions.get(id)!.cwd;
      let finish!: () => void, fail!: (error: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      void promise.catch(() => {});
      const timer = setTimeout(() => {
        this.worker?.postMessage({ kind: 'kill', id });
        const stopping = this.stopping.get(id);
        if (stopping)
          stopping.timer = setTimeout(
            () =>
              fail(new Error('The terminal did not stop. Close it before revoking folder access.')),
            1500,
          );
      }, 1500);
      this.stopping.set(id, { promise, finish, fail, timer, cwd });
      this.worker?.postMessage({ kind: 'close', id });
      this.sessions.delete(id);
    }
  }
  async quiesce(root: string): Promise<void> {
    const related = (file: string) => containsPath(root, file);
    const work: Promise<void>[] = [];
    for (const pending of this.pending.values())
      if (related(pending.request.cwd)) {
        pending.cancelled = true;
        work.push(pending.promise);
      }
    for (const [id, session] of this.sessions)
      if (related(session.cwd)) {
        this.emit(session.owner, {
          type: 'error',
          id,
          message: 'Terminal stopped because folder access changed.',
        });
        this.stop(id, session.owner);
      }
    for (const stopping of this.stopping.values())
      if (related(stopping.cwd)) work.push(stopping.promise);
    await Promise.all(work);
    await Promise.all(this.cleanup);
    for (const failure of this.failedCleanup.values())
      if (related(failure.cwd)) throw failure.error;
  }
  agentRead(id: string): { cwd: string; output: string } {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal is no longer available.');
    if (session.git !== undefined)
      throw new Error('Git terminals are private to the person who ran the action.');
    return { cwd: session.cwd, output: session.output };
  }
  stopOwner(owner: number): void {
    for (const pending of this.pending.values())
      if (pending.owner === owner) pending.cancelled = true;
    for (const [id, session] of this.sessions) if (session.owner === owner) this.stop(id, owner);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const pending of this.pending.values()) pending.cancelled = true;
    for (const [id, session] of this.sessions) this.stop(id, session.owner);
    await Promise.allSettled([...this.pending.values()].map((pending) => pending.promise));
    await Promise.allSettled([...this.stopping.values()].map((stopping) => stopping.promise));
    await Promise.allSettled(this.cleanup);
    this.worker?.process?.kill();
    await this.worker?.thread?.terminate();
    await Promise.allSettled(this.cleanup);
    this.worker = undefined;
    for (const stopping of this.stopping.values()) {
      clearTimeout(stopping.timer);
      stopping.finish();
    }
    this.stopping.clear();
  }
}
