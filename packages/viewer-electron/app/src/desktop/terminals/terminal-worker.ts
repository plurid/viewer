import * as pty from 'node-pty';
import type { TerminalEvent } from '../../domain/automation/actions';
import { workerPort } from '../workers/worker-port';
import { errorMessage } from '../../domain/errors';
import type { TerminalWorkerRequest } from './terminal-protocol';
import { TerminalOutputBudget } from './terminal-output';
interface Session {
  process: pty.IPty;
  pending: number;
  chunks: string[];
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  readOnly: boolean;
  stopped: boolean;
  budget: TerminalOutputBudget;
}
const sessions = new Map<string, Session>();
const port = workerPort;
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
function stop(id: string, value: Session, message: string): void {
  if (value.stopped) return;
  value.stopped = true;
  clearTimeout(value.deadline);
  drain(id, value);
  emit({ type: 'error', id, message });
  value.process.resume();
  value.process.kill();
}
port.on('message', (message) => {
  const request = message.data as TerminalWorkerRequest;
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
      const value: Session = {
        process,
        pending: 0,
        chunks: [],
        readOnly: request.readOnly === true,
        stopped: false,
        budget: new TerminalOutputBudget(request.outputLimit, request.readOnly),
      };
      sessions.set(request.id, value);
      if (request.timeoutMs !== undefined)
        value.deadline = setTimeout(
          () =>
            stop(
              request.id,
              value,
              'Git action exceeded its time limit. Run it again in a terminal if it needs longer.',
            ),
          request.timeoutMs,
        );
      port.postMessage({ type: 'started', id: request.id, pid: process.pid });
      process.onData((data) => {
        if (value.stopped) return;
        const accepted = value.budget.accept(data);
        value.pending += accepted.data.length;
        if (accepted.data) value.chunks.push(accepted.data);
        if (accepted.exceeded) {
          stop(
            request.id,
            value,
            'Git output exceeded its size limit. Narrow the request or run it in a terminal.',
          );
          return;
        }
        if (value.pending >= 512 * 1024) process.pause();
        if (value.chunks.reduce((sum, chunk) => sum + chunk.length, 0) >= 64 * 1024)
          drain(request.id, value);
        else value.timer ??= setTimeout(() => drain(request.id, value), 12);
      });
      process.onExit(({ exitCode }) => {
        clearTimeout(value.deadline);
        drain(request.id, value);
        sessions.delete(request.id);
        emit({ type: 'exit', id: request.id, code: exitCode });
      });
    } else {
      const value = sessions.get(request.id);
      if (!value) {
        if (request.kind === 'close' || request.kind === 'kill')
          emit({ type: 'exit', id: request.id, code: 0 });
        return;
      }
      if (request.kind === 'write') {
        if (value.readOnly) throw new Error('Read-only Git output does not accept terminal input.');
        if (!value.stopped) value.process.write(request.data);
      } else if (request.kind === 'resize') value.process.resize(request.cols, request.rows);
      else if (request.kind === 'ack') {
        value.pending = Math.max(0, value.pending - request.bytes);
        if (!value.stopped && value.pending < 128 * 1024) value.process.resume();
      } else if (request.kind === 'close') {
        clearTimeout(value.timer);
        clearTimeout(value.deadline);
        value.stopped = true;
        value.process.resume();
        value.process.kill();
      } else if (request.kind === 'kill') {
        clearTimeout(value.timer);
        clearTimeout(value.deadline);
        value.stopped = true;
        value.process.resume();
        value.process.kill('SIGKILL');
      }
    }
  } catch (error) {
    const session = sessions.get(request.id);
    if (session) {
      clearTimeout(session.timer);
      clearTimeout(session.deadline);
      session.stopped = true;
      try {
        session.process.kill();
      } catch {
        /* already stopped */
      }
    }
    emit({
      type: 'error',
      id: request.id,
      message: errorMessage(error),
    });
    if (!session) emit({ type: 'exit', id: request.id, code: 1 });
  }
});
process.on('exit', () => {
  for (const value of sessions.values()) {
    clearTimeout(value.deadline);
    try {
      value.process.kill();
    } catch {
      /* already exited */
    }
  }
});
