import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  CapturedTarget,
  CustomAction,
  ExecutionTask,
  TerminalProfile,
  ActionValues,
} from '../../domain/automation/actions';
import { actionArguments, actionAvailable, actionValues } from '../../domain/automation/actions';
import type { ApplicationSettings } from '../../domain/services';
import { entry, absolute } from '../files/filesystem';
import { executablePath } from '../terminals/terminal-launch';
import { childEnvironment } from '../terminals/process-environment';
import { errorMessage } from '../../domain/errors';
/** User-authored executables are subprocesses. Only the explicit shell executor interprets code. */
export class Executions {
  private tasks = new Map<string, ExecutionTask>();
  private children = new Map<string, ChildProcess>();
  private work = new Map<string, Promise<void>>();
  private targets = new Map<string, CapturedTarget>();
  private killTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private owners = new Map<string, number>();
  private preparing = new Set<{
    target: CapturedTarget;
    owner?: number;
    cancelled: boolean;
    promise: Promise<string>;
  }>();
  constructor(
    private settings: () => ApplicationSettings,
    private emit: (task: ExecutionTask, owner?: number) => void,
    private access: (files: readonly string[]) => Promise<void> = async () => {},
    /** Native first-run confirmation of each exact executor; without it nothing runs. */
    private confirm: (action: CustomAction) => Promise<void> = async () => {
      throw new Error('Action confirmation is unavailable, so nothing was run.');
    },
    private confirmProfile: (profile: TerminalProfile) => Promise<void> = async (profile) => {
      if (profile.executable || profile.args.join(' ') !== '-l' || Object.keys(profile.env).length)
        throw new Error('Shell profile confirmation is unavailable.');
    },
    private validateManual: (
      owner: number,
      target: CapturedTarget,
    ) => Promise<void> = async () => {},
  ) {}
  list(owner?: number): ExecutionTask[] {
    return [...this.tasks.values()].filter(
      (task) =>
        owner === undefined || !this.owners.has(task.id) || this.owners.get(task.id) === owner,
    );
  }
  start(
    actionID: string,
    target: CapturedTarget,
    values: ActionValues = {},
    owner?: number,
  ): Promise<string> {
    return this.enqueue(actionID, target, undefined, values, owner);
  }
  /** Only the window's manual command form calls this. No configuration or agent
   * request supplies an executor, environment or an approval override. */
  startManual(script: string, target: CapturedTarget, owner: number): Promise<string> {
    if (!script.trim() || script.includes('\0') || Buffer.byteLength(script) > 16000)
      return Promise.reject(new Error('Enter a command of at most 16 KB without null characters.'));
    return this.enqueue('', target, { script, owner });
  }
  private enqueue(
    actionID: string,
    target: CapturedTarget,
    manual?: { script: string; owner: number },
    values: ActionValues = {},
    owner = manual?.owner,
  ): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Custom commands have closed.'));
    const ticket = { target, owner, cancelled: false, promise: Promise.resolve('') };
    this.preparing.add(ticket);
    ticket.promise = this.prepare(
      actionID,
      target,
      () => ticket.cancelled,
      manual,
      values,
      owner,
    ).finally(() => this.preparing.delete(ticket));
    return ticket.promise;
  }
  private async prepare(
    actionID: string,
    target: CapturedTarget,
    cancelled: () => boolean,
    manual?: { script: string; owner: number },
    supplied: ActionValues = {},
    owner = manual?.owner,
  ): Promise<string> {
    if (this.closed) throw new Error('Custom commands have closed.');
    await this.access([target.directory, ...target.selection.map((file) => file.path)]);
    if (
      this.preparing.size +
        [...this.tasks.values()].filter((task) => task.status === 'running').length >
      20
    )
      throw new Error('Wait for an action to finish or cancel one before starting another.');
    const settings = this.settings();
    const profile = manual
      ? settings.terminals.profiles.find((profile) => profile.id === settings.terminals.profileID)
      : undefined;
    if (manual && !profile)
      throw new Error('Choose an available shell profile in Settings → Terminals.');
    const action: CustomAction | undefined = manual
      ? {
          id: '@manual',
          name: 'Run command',
          aliases: [],
          icon: 'terminal',
          shortcut: '',
          order: 0,
          pinned: false,
          when: { target: 'any', extensions: [], min: 0, max: 2000 },
          executor: {
            kind: 'shell',
            executable: profile!.executable || process.env.SHELL || '/bin/sh',
            script: manual.script,
            perItem: false,
          },
        }
      : settings.customActions.find((action) => action.id === actionID);
    if (!action || !actionAvailable(action, target))
      throw new Error('This action is unavailable for the captured selection.');
    const values = actionValues(action.inputs ?? [], supplied);
    const executor = action.executor;
    if (executor.kind !== 'executable' && executor.kind !== 'shell')
      throw new Error('This action must run through the command registry.');
    const cwd = await fs.realpath(absolute(target.directory));
    const original = await fs.stat(cwd);
    if (!original.isDirectory()) throw new Error('Action folder is unavailable.');
    for (const file of target.selection)
      if ((await entry(file.path)).identity !== file.identity)
        throw new Error(`Selection changed: ${file.name}. Review the action again.`);
    if (profile) await this.confirmProfile(profile);
    else await this.confirm(action);
    if (this.closed || cancelled()) throw new Error('Command cancelled before launch.');
    const executable = await executablePath(executor.executable);
    await this.access([target.directory, cwd, ...target.selection.map((file) => file.path)]);
    if (manual) await this.validateManual(manual.owner, target);
    const current = await fs.stat(cwd);
    if (
      (await fs.realpath(absolute(target.directory))) !== cwd ||
      current.dev !== original.dev ||
      current.ino !== original.ino
    )
      throw new Error('The command folder changed before launch. Choose the command again.');
    if (this.closed || cancelled())
      throw new Error('Command cancelled before launch because folder access changed.');
    const items = executor.perItem ? target.selection : [undefined];
    if (executor.perItem && !items.length) throw new Error('Select files for per-item execution.');
    const task: ExecutionTask = {
      id: randomUUID(),
      title: manual ? manual.script.trim().split('\n')[0]!.slice(0, 100) : action.name,
      status: 'running',
      output: '',
      directory: cwd,
      started: Date.now(),
      workspaceID: target.workspaceID,
      paneID: target.paneID,
      ...(manual
        ? { command: manual.script, folderIdentity: `${original.dev}:${original.ino}` }
        : {}),
    };
    this.tasks.set(task.id, task);
    if (owner !== undefined) this.owners.set(task.id, owner);
    while (this.tasks.size > 100) {
      const removable = [...this.tasks].find(([, task]) => task.status !== 'running');
      if (!removable) break;
      this.tasks.delete(removable[0]);
      this.owners.delete(removable[0]);
    }
    this.emit(task, owner);
    this.targets.set(task.id, target);
    const isCancelled = () => this.closed || cancelled() || task.status === 'cancelled';
    const work = (async () => {
      try {
        for (const item of items) {
          if (isCancelled()) break;
          await this.access([
            target.directory,
            cwd,
            ...(item ? [item.path] : target.selection.map((file) => file.path)),
          ]);
          if (isCancelled()) break;
          const args =
            manual && profile
              ? [...profile.args, '-c', manual.script, 'viewer-command']
              : executor.kind === 'executable'
                ? actionArguments(executor.args, target, item, values)
                : [
                    '-c',
                    executor.script,
                    'viewer-action',
                    ...actionArguments(['{directory}', '{paths}'], target, item),
                  ];
          await new Promise<void>((resolve, reject) => {
            const child = spawn(executable, args, {
              cwd,
              env: childEnvironment({
                ...profile?.env,
                ...Object.fromEntries(
                  Object.entries(values).map(([name, value]) => [
                    'VIEWER_INPUT_' + name.toUpperCase(),
                    value,
                  ]),
                ),
              }),
              shell: false,
              detached: process.platform !== 'win32',
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            this.children.set(task.id, child);
            let timer: ReturnType<typeof setTimeout> | undefined;
            const output = (data: Buffer) => {
              const bytes = Buffer.from(task.output + data.toString());
              task.truncated ||= bytes.length > 256 * 1024;
              task.output = bytes.subarray(-256 * 1024).toString('utf8');
              timer ??= setTimeout(() => {
                timer = undefined;
                this.emit({ ...task }, owner);
              }, 80);
            };
            child.stdout?.on('data', output);
            child.stderr?.on('data', output);
            child.on('error', reject);
            child.on('close', (code, signal) => {
              clearTimeout(timer);
              clearTimeout(this.killTimers.get(task.id));
              this.killTimers.delete(task.id);
              this.children.delete(task.id);
              task.exitCode = code ?? undefined;
              if ((code !== 0 || signal) && task.status !== 'cancelled')
                reject(
                  new Error(
                    `Command exited with ${signal ? `signal ${signal}` : `status ${code}`}.`,
                  ),
                );
              else resolve();
            });
          });
        }
        if (task.status !== 'cancelled') task.status = 'completed';
      } catch (error) {
        if (task.status !== 'cancelled') {
          task.status = 'failed';
          task.error = errorMessage(error);
        }
      }
      task.ended = Date.now();
      this.emit({ ...task }, owner);
    })().finally(() => {
      this.work.delete(task.id);
      this.targets.delete(task.id);
    });
    this.work.set(task.id, work);
    return task.id;
  }
  cancel(id: string, owner?: number): void {
    if (owner !== undefined && this.owners.has(id) && this.owners.get(id) !== owner)
      throw new Error('This command belongs to another window.');
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return;
    task.status = 'cancelled';
    const child = this.children.get(id);
    try {
      if (
        child?.pid &&
        child.exitCode === null &&
        child.signalCode === null &&
        process.platform !== 'win32'
      )
        process.kill(-child.pid, 'SIGTERM');
      else child?.kill();
    } catch {
      /* already stopped */
    }
    const timer = setTimeout(() => {
      try {
        if (child?.pid && this.children.get(id) === child && process.platform !== 'win32')
          process.kill(-child.pid, 'SIGKILL');
        else child?.kill('SIGKILL');
      } catch {
        /* already stopped */
      }
    }, 1500);
    this.killTimers.set(id, timer);
    timer.unref();
    this.emit({ ...task }, this.owners.get(id));
  }
  stopOwner(owner: number): void {
    for (const ticket of this.preparing) if (ticket.owner === owner) ticket.cancelled = true;
    for (const [id, taskOwner] of this.owners) if (taskOwner === owner) this.cancel(id, owner);
  }
  async quiesce(root: string): Promise<void> {
    const related = (file: string) =>
      file === root || file.startsWith(root.replace(/\/$/, '') + '/');
    const work: Promise<void>[] = [];
    for (const ticket of this.preparing)
      if (
        related(ticket.target.directory) ||
        ticket.target.selection.some((file) => related(file.path))
      ) {
        ticket.cancelled = true;
        work.push(
          ticket.promise.then(
            () => {},
            () => {},
          ),
        );
      }
    for (const [id, target] of this.targets)
      if (related(target.directory) || target.selection.some((file) => related(file.path))) {
        this.cancel(id);
        const pending = this.work.get(id);
        if (pending) work.push(pending);
      }
    await Promise.allSettled(work);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const ticket of this.preparing) ticket.cancelled = true;
    for (const task of this.tasks.values()) this.cancel(task.id);
    await Promise.allSettled(this.work.values());
    await Promise.allSettled([...this.preparing].map((ticket) => ticket.promise));
  }
}
