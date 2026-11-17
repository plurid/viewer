import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RemoteConnection } from '../../domain/remote/connections';
import { remoteLimits } from '../../domain/remote/limits';
import { sshArguments, validateControlPath } from '../../domain/remote/ssh-arguments';
import type { SSHCommand } from '../../domain/remote/ssh-arguments';
import { classifySSHFailure, SSHConnectionError } from '../../domain/remote/ssh-errors';
import { remoteEnvironment } from './environment';
import { privateSocketFolder } from './socket-folder';

export interface SSHRunOptions {
  environment: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface SSHRunResult {
  code: number | null;
  stderr: string;
}

export type SSHRunner = (command: SSHCommand, options: SSHRunOptions) => Promise<SSHRunResult>;

const stderrCharacters = 64 * 1024;

/** Tests serve a fake ssh; a running app always uses the system's, never a PATH lookup. */
export function testSSHExecutable(executable?: string): string {
  if (!executable) {
    return '/usr/bin/ssh';
  }
  if (process.env.VIEWER_TEST_PRESERVE !== '1' || !path.isAbsolute(executable)) {
    throw new Error('An SSH executable override is available only in preserved tests.');
  }
  return executable;
}

export function sshRunner(sshExecutable?: string): SSHRunner {
  const executable = testSSHExecutable(sshExecutable);
  return (command, options) =>
    new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('Connection cancelled.'));
        return;
      }
      const child = spawn(executable, command.args, {
        env: options.environment,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        child.kill('SIGTERM');
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), 100).unref();
      };
      const timer = setTimeout(stop, options.timeoutMs);
      options.signal?.addEventListener('abort', stop, { once: true });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < stderrCharacters) {
          stderr += chunk.toString('utf8').slice(0, stderrCharacters - stderr.length);
        }
      });
      const finish = (code: number | null, error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', stop);
        child.stderr.destroy();
        if (error) {
          reject(new Error('The SSH process could not start.'));
        } else if (options.signal?.aborted) {
          reject(new Error('Connection cancelled.'));
        } else {
          resolve({ code, stderr });
        }
      };
      child.once('error', (error) => finish(null, error));
      child.once('close', (code) => finish(code));
    });
}

/** Signing in through a chain of jump hosts takes one connect timeout per hop. */
function signInTimeoutMs(record: RemoteConnection, interactive: boolean): number {
  const hops = (record.jump?.length ?? 0) + 1;
  const connecting = (remoteLimits.sshConnectTimeoutSeconds * hops + 5) * 1000;
  return interactive ? remoteLimits.promptTimeoutMs + connecting : connecting;
}

interface Master {
  record: RemoteConnection;
  controlPath: string;
  controller?: AbortController;
  running?: Promise<SSHRunResult>;
  idle?: ReturnType<typeof setTimeout>;
  ready: boolean;
}

export interface RemoteControlOptions {
  runner?: SSHRunner;
  sshExecutable?: string;
  temporaryDirectory?: string;
  /** Called when nothing has held a ready connection for five minutes. */
  idle?(id: string): Promise<void>;
}

/** Owns explicit masters only. SFTP children belong to the servers worker. */
export class RemoteControl {
  private masters = new Map<string, Master>();
  private holders = new Map<string, number>();
  private directoryPromise?: Promise<string>;
  private runner: SSHRunner;
  private closing = false;
  private nextSocket = 1;

  constructor(private options: RemoteControlOptions = {}) {
    this.runner = options.runner ?? sshRunner(options.sshExecutable);
  }

  private directory(): Promise<string> {
    if (!this.directoryPromise) {
      const pending = privateSocketFolder(
        'v-',
        'c9999',
        validateControlPath,
        this.options.temporaryDirectory,
      );
      this.directoryPromise = pending;
      // A failed attempt is retried by the next connect rather than kept for the session.
      pending.catch(() => {
        if (this.directoryPromise === pending) {
          this.directoryPromise = undefined;
        }
      });
    }
    return this.directoryPromise;
  }

  private async allocate(record: RemoteConnection): Promise<Master> {
    const existing = this.masters.get(record.id);
    if (existing) {
      return existing;
    }
    if (this.masters.size >= remoteLimits.connections) {
      throw new Error('Disconnect a server before connecting another.');
    }
    const folder = await this.directory();
    // Checked again after the await, so concurrent connects never share a socket.
    const raced = this.masters.get(record.id);
    if (raced) {
      return raced;
    }
    if (this.closing || this.masters.size >= remoteLimits.connections) {
      throw new Error('Disconnect a server before connecting another.');
    }
    const controlPath = path.join(folder, 'c' + this.nextSocket++);
    validateControlPath(controlPath);
    const master: Master = { record, controlPath, ready: false };
    this.masters.set(record.id, master);
    return master;
  }

  /** Starts the master. `interactive` only for a click: it may ask through the askpass relay. */
  async connect(
    record: RemoteConnection,
    environment: Record<string, string>,
    interactive: boolean,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.closing) {
      throw new Error('Server connections are shutting down.');
    }
    const master = await this.allocate(record);
    if (master.controller) {
      throw new Error('This server is already connecting.');
    }
    clearTimeout(master.idle);
    master.record = record;
    const controller = new AbortController();
    master.controller = controller;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      controller.abort();
    }
    try {
      const command = sshArguments(record, {
        kind: 'master',
        controlPath: master.controlPath,
        interactive,
      });
      const running = this.runner(command, {
        environment,
        signal: controller.signal,
        timeoutMs: signInTimeoutMs(record, interactive),
      });
      master.running = running;
      const result = await running;
      const failure = classifySSHFailure(result.code, result.stderr);
      if (failure) {
        throw new SSHConnectionError(failure);
      }
      if (controller.signal.aborted || this.closing) {
        throw new Error('Connection cancelled.');
      }
      master.ready = true;
      return master.controlPath;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (master.controller === controller) {
        master.controller = undefined;
      }
      master.running = undefined;
    }
  }

  /** Asks the master whether it still runs; never signs in or prompts. */
  async check(id: string, signal?: AbortSignal): Promise<boolean> {
    const master = this.masters.get(id);
    if (!master?.ready) {
      return false;
    }
    const command = sshArguments(master.record, { kind: 'check', controlPath: master.controlPath });
    const result = await this.runner(command, {
      environment: remoteEnvironment(),
      signal,
      timeoutMs: remoteLimits.quitTimeoutMs,
    });
    return result.code === 0;
  }

  /** The control socket of a ready master, for sessions that reuse it. */
  controlPath(id: string): string | undefined {
    const master = this.masters.get(id);
    return master?.ready ? master.controlPath : undefined;
  }

  held(id: string): boolean {
    return this.holders.has(id);
  }

  /** A plane, terminal or request holds the connection; release once when it no longer needs it. */
  retain(id: string): () => void {
    const master = this.masters.get(id);
    if (!master) {
      throw new Error('Connect to this server first.');
    }
    clearTimeout(master.idle);
    this.holders.set(id, (this.holders.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const held = Math.max(0, (this.holders.get(id) ?? 1) - 1);
      if (held) {
        this.holders.set(id, held);
      } else {
        this.holders.delete(id);
      }
      this.armIdle(id);
    };
  }

  armIdle(id: string): void {
    const master = this.masters.get(id);
    if (!master || this.holders.has(id) || !master.ready || this.closing) {
      return;
    }
    clearTimeout(master.idle);
    master.idle = setTimeout(() => {
      void (this.options.idle?.(id) ?? this.disconnect(id)).catch(() => {});
    }, remoteLimits.idleBrowseMs).unref();
  }

  cancel(id: string): void {
    this.masters.get(id)?.controller?.abort();
  }

  /** Drops a master that already ended on its own, without asking it to exit. */
  forget(id: string): void {
    const master = this.masters.get(id);
    if (!master) {
      return;
    }
    clearTimeout(master.idle);
    master.controller?.abort();
    this.masters.delete(id);
  }

  async disconnect(id: string): Promise<void> {
    const master = this.masters.get(id);
    if (!master) {
      return;
    }
    clearTimeout(master.idle);
    master.controller?.abort();
    this.masters.delete(id);
    await master.running?.catch(() => {});
    const command = sshArguments(master.record, { kind: 'exit', controlPath: master.controlPath });
    await this.runner(command, {
      environment: remoteEnvironment(),
      timeoutMs: remoteLimits.quitTimeoutMs - 150,
    }).catch(() => {});
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all([...this.masters.keys()].map((id) => this.disconnect(id)));
  }
}
