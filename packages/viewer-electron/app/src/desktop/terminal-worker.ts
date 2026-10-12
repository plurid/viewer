import * as pty from 'node-pty';
import type { TerminalEvent } from '../domain/automation';
interface Session {
  process: pty.IPty;
  pending: number;
  chunks: string[];
  timer?: ReturnType<typeof setTimeout>;
}
const sessions = new Map<string, Session>();
const port = process.parentPort;
const emit = (event: TerminalEvent) => port.postMessage(event);
function drain(id: string, value: Session): void {
  clearTimeout(value.timer);
  value.timer = undefined;
  if (value.chunks.length) {
    const data = value.chunks.join('');
    value.chunks = [];
    emit({ type: 'data', id, data });
  }
}
port.on('message', (message) => {
  const request = message.data as {
    kind: string;
    id: string;
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
    data: string;
    bytes: number;
  };
  try {
    if (request.kind === 'start') {
      if (sessions.has(request.id)) return;
      const process = pty.spawn(request.executable, request.args, {
        name: 'xterm-256color',
        cwd: request.cwd,
        env: request.env,
        cols: request.cols,
        rows: request.rows,
      });
      const value: Session = { process, pending: 0, chunks: [] };
      sessions.set(request.id, value);
      process.onData((data) => {
        value.pending += data.length;
        value.chunks.push(data);
        if (value.pending >= 512 * 1024) process.pause();
        if (value.chunks.reduce((sum, chunk) => sum + chunk.length, 0) >= 64 * 1024)
          drain(request.id, value);
        else value.timer ??= setTimeout(() => drain(request.id, value), 12);
      });
      process.onExit(({ exitCode }) => {
        drain(request.id, value);
        sessions.delete(request.id);
        emit({ type: 'exit', id: request.id, code: exitCode });
      });
    } else {
      const value = sessions.get(request.id);
      if (!value) return;
      if (request.kind === 'write') value.process.write(request.data);
      else if (request.kind === 'resize') value.process.resize(request.cols, request.rows);
      else if (request.kind === 'ack') {
        value.pending = Math.max(0, value.pending - request.bytes);
        if (value.pending < 128 * 1024) value.process.resume();
      } else if (request.kind === 'close') {
        clearTimeout(value.timer);
        value.process.kill();
      }
    }
  } catch (error) {
    const session = sessions.get(request.id);
    if (session) {
      clearTimeout(session.timer);
      sessions.delete(request.id);
      try {
        session.process.kill();
      } catch {
        /* already stopped */
      }
    }
    emit({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
process.on('exit', () => {
  for (const value of sessions.values()) {
    try {
      value.process.kill();
    } catch {
      /* already exited */
    }
  }
});
