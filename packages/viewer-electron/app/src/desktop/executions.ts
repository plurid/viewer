import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CapturedTarget, ExecutionTask } from '../domain/automation';
import { actionArguments, actionAvailable } from '../domain/automation';
import type { ApplicationSettings } from '../domain/services';
import { entry, absolute } from './filesystem';
import { executablePath } from './terminal-launch';
/** User-authored executables are subprocesses. Only the explicit shell executor interprets code. */
export class Executions {
  private tasks = new Map<string, ExecutionTask>();
  private children = new Map<string, ChildProcess>();
  private work = new Map<string, Promise<void>>();
  private targets = new Map<string, CapturedTarget>();
  private killTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private preparing = new Set<{
    target: CapturedTarget;
    cancelled: boolean;
    promise: Promise<string>;
  }>();
  constructor(
    private settings: () => ApplicationSettings,
    private emit: (task: ExecutionTask) => void,
    private access: (files: readonly string[]) => Promise<void> = async () => {},
  ) {}
  list(): ExecutionTask[] {
    return [...this.tasks.values()];
  }
  start(actionID: string, target: CapturedTarget): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Custom commands have closed.'));
    const ticket = { target, cancelled: false, promise: Promise.resolve('') };
    this.preparing.add(ticket);
    ticket.promise = this.prepare(actionID, target, () => ticket.cancelled).finally(() =>
      this.preparing.delete(ticket),
    );
    return ticket.promise;
  }
  private async prepare(
    actionID: string,
    target: CapturedTarget,
    cancelled: () => boolean,
  ): Promise<string> {
    if (this.closed) throw new Error('Custom commands have closed.');
    await this.access([target.directory, ...target.selection.map((file) => file.path)]);
    if (
      this.preparing.size +
        [...this.tasks.values()].filter((task) => task.status === 'running').length >
      20
    )
      throw new Error('Wait for an action to finish or cancel one before starting another.');
    const action = this.settings().customActions.find((action) => action.id === actionID);
    if (!action || !actionAvailable(action, target))
      throw new Error('This action is unavailable for the captured selection.');
    const executor = action.executor;
    if (executor.kind !== 'executable' && executor.kind !== 'shell')
      throw new Error('This action must run through the command registry.');
    const cwd = await fs.realpath(absolute(target.directory));
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error('Action folder is unavailable.');
    for (const file of target.selection)
      if ((await entry(file.path)).identity !== file.identity)
        throw new Error(`Selection changed: ${file.name}. Review the action again.`);
    const executable = await executablePath(executor.executable);
    await this.access([target.directory, cwd, ...target.selection.map((file) => file.path)]);
    if (this.closed || cancelled())
      throw new Error('Command cancelled before launch because folder access changed.');
    const items = executor.perItem ? target.selection : [undefined];
    if (executor.perItem && !items.length) throw new Error('Select files for per-item execution.');
    const task: ExecutionTask = {
      id: randomUUID(),
      title: action.name,
      status: 'running',
      output: '',
    };
    this.tasks.set(task.id, task);
    while (this.tasks.size > 100) {
      const removable = [...this.tasks].find(([, task]) => task.status !== 'running');
      if (!removable) break;
      this.tasks.delete(removable[0]);
    }
    this.emit(task);
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
            executor.kind === 'executable'
              ? actionArguments(executor.args, target, item)
              : [
                  '-c',
                  executor.script,
                  'viewer-action',
                  ...actionArguments(['{directory}', '{paths}'], target, item),
                ];
          await new Promise<void>((resolve, reject) => {
            const child = spawn(executable, args, {
              cwd,
              shell: false,
              detached: process.platform !== 'win32',
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            this.children.set(task.id, child);
            let timer: ReturnType<typeof setTimeout> | undefined;
            const output = (data: Buffer) => {
              task.output = (task.output + data.toString()).slice(-256 * 1024);
              timer ??= setTimeout(() => {
                timer = undefined;
                this.emit({ ...task });
              }, 80);
            };
            child.stdout?.on('data', output);
            child.stderr?.on('data', output);
            child.on('error', reject);
            child.on('close', (code) => {
              clearTimeout(timer);
              clearTimeout(this.killTimers.get(task.id));
              this.killTimers.delete(task.id);
              this.children.delete(task.id);
              task.exitCode = code ?? undefined;
              if (code && task.status !== 'cancelled')
                reject(new Error(`Command exited with status ${code}.`));
              else resolve();
            });
          });
        }
        if (task.status !== 'cancelled') task.status = 'completed';
      } catch (error) {
        if (task.status !== 'cancelled') {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : String(error);
        }
      }
      this.emit({ ...task });
    })().finally(() => {
      this.work.delete(task.id);
      this.targets.delete(task.id);
    });
    this.work.set(task.id, work);
    return task.id;
  }
  cancel(id: string): void {
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
    this.emit({ ...task });
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
