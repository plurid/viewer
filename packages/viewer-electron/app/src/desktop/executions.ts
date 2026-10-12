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
  constructor(
    private settings: () => ApplicationSettings,
    private emit: (task: ExecutionTask) => void,
  ) {}
  list(): ExecutionTask[] {
    return [...this.tasks.values()];
  }
  async start(actionID: string, target: CapturedTarget): Promise<string> {
    if ([...this.tasks.values()].filter((task) => task.status === 'running').length >= 20)
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
    void (async () => {
      try {
        for (const item of items) {
          if (task.status === 'cancelled') break;
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
    })();
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
        if (
          child?.pid &&
          child.exitCode === null &&
          child.signalCode === null &&
          process.platform !== 'win32'
        )
          process.kill(-child.pid, 'SIGKILL');
        else child?.kill('SIGKILL');
      } catch {
        /* already stopped */
      }
    }, 1500);
    timer.unref();
    this.emit({ ...task });
  }
  close(): void {
    for (const task of this.tasks.values()) this.cancel(task.id);
  }
}
