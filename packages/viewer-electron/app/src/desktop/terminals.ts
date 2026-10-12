import fs from 'node:fs/promises';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { TerminalEvent, TerminalStart } from '../domain/automation';
import type { ApplicationSettings } from '../domain/services';
import { absolute } from './filesystem';
import { executablePath } from './terminal-launch';
export class Terminals {
  private worker?: UtilityProcess;
  private pending = new Map<
    string,
    { owner: number; request: TerminalStart; cancelled: boolean; promise: Promise<void> }
  >();
  private sessions = new Map<
    string,
    { owner: number; request: TerminalStart; output: string; cwd: string }
  >();
  constructor(
    private workerPath: string,
    private settings: () => ApplicationSettings,
    private emit: (owner: number, event: TerminalEvent) => void,
  ) {}
  start(request: TerminalStart, owner: number): Promise<void> {
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
    const cwd = await fs.realpath(absolute(request.cwd));
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error('Terminal folder is unavailable.');
    const profile = this.settings().terminals.profiles.find(
      (profile) => profile.id === request.profileID,
    );
    if (!profile)
      throw new Error('Terminal profile no longer exists. Choose a profile in Settings.');
    const executable = await executablePath(
      profile.executable ||
        process.env.SHELL ||
        (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'),
    );
    if (this.pending.get(request.id)?.cancelled) return;
    if (!this.worker) {
      const worker = utilityProcess.fork(this.workerPath, [], {
        serviceName: 'Viewer terminals',
        stdio: 'pipe',
      });
      this.worker = worker;
      let diagnostic = '';
      worker.stderr?.on('data', (data: Buffer) => {
        diagnostic = (diagnostic + data.toString()).slice(-2000);
      });
      worker.on('message', (event: TerminalEvent) => {
        const session = this.sessions.get(event.id);
        if (!session) return;
        if (event.type === 'data')
          session.output = (session.output + event.data).slice(-128 * 1024);
        this.emit(session.owner, event);
        if (event.type === 'exit' || event.type === 'error') this.sessions.delete(event.id);
      });
      worker.on('exit', () => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        for (const [id, session] of this.sessions)
          this.emit(session.owner, {
            type: 'error',
            id,
            message:
              'Terminal process stopped. Reopen the terminal to start a fresh shell.' +
              (diagnostic ? '\n' + diagnostic : ''),
          });
        this.sessions.clear();
      });
    }
    this.sessions.set(request.id, { owner, request, cwd, output: '' });
    const env = Object.fromEntries(
      Object.entries({
        ...process.env,
        ...profile.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      }).filter(
        ([key, value]) =>
          value !== undefined &&
          !key.startsWith('ELECTRON_') &&
          !key.startsWith('DYLD_') &&
          key !== 'NODE_OPTIONS',
      ),
    ) as Record<string, string>;
    this.worker.postMessage({
      kind: 'start',
      ...request,
      cwd,
      executable,
      args: profile.args,
      env,
    });
  }
  private owned(id: string, owner: number): void {
    if (this.sessions.get(id)?.owner !== owner) throw new Error('Terminal is no longer available.');
  }
  write(id: string, data: string, owner: number): void {
    this.owned(id, owner);
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
      this.worker?.postMessage({ kind: 'close', id });
      this.sessions.delete(id);
    }
  }
  agentRead(id: string): { cwd: string; output: string } {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal is no longer available.');
    return { cwd: session.cwd, output: session.output };
  }
  agentWrite(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal is no longer available.');
    this.write(id, data, session.owner);
  }
  stopOwner(owner: number): void {
    for (const pending of this.pending.values())
      if (pending.owner === owner) pending.cancelled = true;
    for (const [id, session] of this.sessions) if (session.owner === owner) this.stop(id, owner);
  }
  async close(): Promise<void> {
    for (const pending of this.pending.values()) pending.cancelled = true;
    for (const [id, session] of this.sessions) this.stop(id, session.owner);
    await new Promise((resolve) => setTimeout(resolve, 80));
    this.worker?.kill();
    this.worker = undefined;
  }
}
