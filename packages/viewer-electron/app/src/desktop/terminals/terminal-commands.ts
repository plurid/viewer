import type { TerminalWorkerReply, TerminalWorkerRequest } from './terminal-protocol';
import { terminateTerminalGroup } from './terminal-groups';
import { containsPath } from '../files/containment';
import { CommandOutput } from './command-output';

/** Private launch after Executions validates the person's command and captured folder. */
export interface TerminalCommand {
  id: string;
  owner: number;
  workspaceID: string;
  rootID: string;
  cwd: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
}
export type RunTerminalCommand = (
  program: TerminalCommand,
  signal: AbortSignal,
  output: (text: string) => void,
) => Promise<number>;

interface Running {
  program: TerminalCommand;
  signal: AbortSignal;
  abort(): void;
  output(text: string): void;
  decoder: CommandOutput;
  promise: Promise<number>;
  resolve(code: number): void;
  reject(error: Error): void;
  pid?: number;
  timer?: ReturnType<typeof setTimeout>;
  error?: Error;
  stopping?: boolean;
  finishing?: boolean;
}

/** Shares the desktop's PTY worker without exposing these sessions as terminal planes. */
export class TerminalCommands {
  private running = new Map<string, Running>();
  private failures = new Map<string, Error>();
  constructor(private post: (message: TerminalWorkerRequest) => void) {}
  get size(): number {
    return this.running.size;
  }
  has(id: string): boolean {
    return this.running.has(id);
  }

  run: RunTerminalCommand = (program, signal, output) => {
    if (signal.aborted) return Promise.reject(new Error('Command cancelled before launch.'));
    if (this.has(program.id)) return Promise.reject(new Error('This command already started.'));
    let resolve!: Running['resolve'], reject!: Running['reject'];
    const promise = new Promise<number>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const value: Running = {
      program,
      signal,
      output,
      resolve,
      reject,
      promise,
      decoder: new CommandOutput(),
      abort: () => this.stop(value),
    };
    this.running.set(program.id, value);
    signal.addEventListener('abort', value.abort, { once: true });
    try {
      this.post({
        kind: 'start',
        id: program.id,
        workspaceID: program.workspaceID,
        rootID: program.rootID,
        cwd: program.cwd,
        profileID: '@viewer-command',
        executable: program.executable,
        args: program.args,
        env: { ...program.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        cols: 120,
        rows: 30,
        input: false,
      });
    } catch (error) {
      void this.finish(value, error as Error);
    }
    return promise;
  };

  receive(event: TerminalWorkerReply): boolean {
    const value = this.running.get(event.id);
    if (!value) return false;
    if (event.type === 'started') {
      if (Number.isSafeInteger(event.pid) && event.pid > 1) value.pid = event.pid;
    } else if (event.type === 'data') {
      const text = value.decoder.accept(event.data);
      if (text && !value.finishing) value.output(text);
      this.post({ kind: 'ack', id: event.id, bytes: event.data.length });
    } else if (event.type === 'error') {
      value.error = new Error(event.message);
      this.stop(value);
    } else if (event.type === 'exit')
      void this.finish(
        value,
        value.error ??
          (event.signal ? new Error(`Command exited with signal ${event.signal}.`) : undefined),
        event.code,
      );
    return true;
  }

  private stop(value: Running): void {
    if (value.stopping || value.finishing) return;
    value.stopping = true;
    value.error ??= new Error('Command cancelled.');
    try {
      this.post({ kind: 'close', id: value.program.id });
      if (value.finishing) return;
      value.timer = setTimeout(() => {
        try {
          this.post({ kind: 'kill', id: value.program.id });
        } catch {
          /* worker exited */
        }
        value.timer = setTimeout(
          () => void this.finish(value, new Error('Command terminal did not stop.')),
          1500,
        );
      }, 1500);
    } catch (error) {
      void this.finish(value, error as Error);
    }
  }

  private async finish(value: Running, error?: Error, code = 1): Promise<void> {
    if (value.finishing) return;
    value.finishing = true;
    clearTimeout(value.timer);
    value.signal.removeEventListener('abort', value.abort);
    try {
      if (value.pid) await terminateTerminalGroup(value.pid);
    } catch (failure) {
      error = failure as Error;
      this.failures.set(value.program.cwd, error);
    }
    this.running.delete(value.program.id);
    if (error) value.reject(error);
    else value.resolve(code);
  }

  failed(message: string): void {
    for (const value of this.running.values()) {
      const error = new Error(message);
      if (!value.pid) this.failures.set(value.program.cwd, error);
      void this.finish(value, error);
    }
  }
  stopOwner(owner: number): void {
    for (const value of this.running.values()) if (value.program.owner === owner) this.stop(value);
  }
  async quiesce(root: string): Promise<void> {
    const values = [...this.running.values()].filter((value) =>
      containsPath(root, value.program.cwd),
    );
    for (const value of values) this.stop(value);
    await Promise.allSettled(values.map((value) => value.promise));
    for (const [cwd, error] of this.failures) if (containsPath(root, cwd)) throw error;
  }
  async close(): Promise<void> {
    const values = [...this.running.values()];
    for (const value of values) this.stop(value);
    await Promise.allSettled(values.map((value) => value.promise));
  }
}
