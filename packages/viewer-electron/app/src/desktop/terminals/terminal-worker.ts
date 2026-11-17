import * as pty from 'node-pty';
import path from 'node:path';
import type { TerminalEvent } from '../../domain/automation/actions';
import { workerPort } from '../workers/worker-port';
import { errorMessage } from '../../domain/errors';
import type { TerminalWorkerReply, TerminalWorkerRequest } from './terminal-protocol';
import { validInitialInput } from './terminal-protocol';
import { TerminalOutputBudget } from './terminal-output';
import { TerminalStartInput } from './terminal-start-input';
interface InitialInput {
  command: string;
  input: TerminalStartInput;
  needsPasteMode: boolean;
  restoreInsertMode: boolean;
  quiet?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
}
type InitialInputTrigger = 'quiet' | 'deadline';
interface Session {
  process: pty.IPty;
  pending: number;
  chunks: string[];
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  readOnly: boolean;
  input: boolean;
  stopped: boolean;
  budget: TerminalOutputBudget;
  initial?: InitialInput;
}
const sessions = new Map<string, Session>();
const port = workerPort;
const post = (reply: TerminalWorkerReply) => port.postMessage(reply);
const emit = (event: TerminalEvent) => post(event);
function cancelInitialInput(value: Session): void {
  clearTimeout(value.initial?.quiet);
  clearTimeout(value.initial?.deadline);
  value.initial = undefined;
}
function writeHeldInput(value: Session, input: TerminalStartInput): void {
  for (const data of input.take()) {
    if (value.stopped) break;
    value.process.write(data);
  }
}
function releaseInitialInput(id: string, value: Session, message: string): void {
  const initial = value.initial;
  if (!initial || value.stopped) return;
  cancelInitialInput(value);
  drain(id, value);
  const data = '\r\n' + message + '\r\n';
  value.pending += data.length;
  emit({ type: 'data', id, data });
  writeHeldInput(value, initial.input);
}
function scheduleInitialInput(id: string, value: Session): void {
  if (!value.initial) return;
  clearTimeout(value.initial.quiet);
  value.initial.quiet = setTimeout(() => writeInitialInput(id, value, 'quiet'), 120);
}
function writeInitialInput(id: string, value: Session, trigger: InitialInputTrigger): void {
  const initial = value.initial;
  if (!initial || value.stopped) return;
  try {
    if (initial.input.waiting || (initial.needsPasteMode && !initial.input.bracketedPaste)) {
      if (trigger === 'deadline')
        releaseInitialInput(
          id,
          value,
          `Viewer did not type \`${initial.command}\` because ${initial.input.waiting ? 'the shell was still waiting for an answer' : 'the shell did not enable its line editor'}. Queued input was sent to the shell. Type this command manually when the shell is ready: ${initial.command}`,
        );
      return;
    }
    cancelInitialInput(value);
    // Unread reports can leave zsh in a vi command, motion or replace keymap. Escape+i
    // restores insert mode; emacs ignores that unbound key. Ctrl-U then clears the line.
    const insertMode = initial.restoreInsertMode ? '\x1bi' : '';
    const clearLine = initial.needsPasteMode ? '\x15' : '';
    value.process.write(insertMode + clearLine + initial.command + '\r');
    writeHeldInput(value, initial.input);
  } catch (error) {
    stop(id, value, errorMessage(error));
  }
}
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
  cancelInitialInput(value);
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
      if (
        request.initialInput !== undefined &&
        (!validInitialInput(request.initialInput) || request.readOnly || request.input === false)
      )
        throw new Error('The private terminal command is invalid.');
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
        input: request.input !== false,
        stopped: false,
        budget: new TerminalOutputBudget(request.outputLimit, request.readOnly),
        initial:
          request.initialInput === undefined
            ? undefined
            : {
                command: request.initialInput,
                input: new TerminalStartInput(),
                needsPasteMode: ['zsh', 'fish'].includes(path.basename(request.executable)),
                restoreInsertMode: path.basename(request.executable) === 'zsh',
              },
      };
      sessions.set(request.id, value);
      // zsh and fish announce their line editor with bracketed paste mode. Other shells can
      // still consume the command as the answer to an untracked startup question.
      // Shift+F3 or Alt+[ followed by CPR-shaped text is indistinguishable from a cursor reply
      // and can answer an outstanding query. DCS replies are unsafe even when requested.
      if (value.initial)
        value.initial.deadline = setTimeout(
          () => writeInitialInput(request.id, value, 'deadline'),
          3000,
        );
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
      post({ type: 'started', id: request.id, pid: process.pid });
      process.onData((data) => {
        if (value.stopped) return;
        if (data && value.initial) {
          value.initial.input.observeOutput(data);
          scheduleInitialInput(request.id, value);
        }
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
      process.onExit(({ exitCode, signal }) => {
        value.stopped = true;
        cancelInitialInput(value);
        clearTimeout(value.deadline);
        drain(request.id, value);
        sessions.delete(request.id);
        emit({ type: 'exit', id: request.id, code: exitCode, ...(signal ? { signal } : {}) });
      });
    } else {
      const value = sessions.get(request.id);
      if (!value) {
        if (request.kind === 'close' || request.kind === 'kill')
          emit({ type: 'exit', id: request.id, code: 0 });
        return;
      }
      if (request.kind === 'write') {
        if (!value.input) throw new Error('Command output does not accept terminal input.');
        if (value.readOnly) throw new Error('Read-only Git output does not accept terminal input.');
        if (!value.stopped) {
          if (value.initial && request.data.includes('\x03')) {
            cancelInitialInput(value);
            value.process.write(request.data.slice(request.data.indexOf('\x03')));
          } else if (value.initial) {
            const input = value.initial.input;
            const wasWaiting = input.waiting;
            const result = input.write(request.data, (data) => value.process.write(data));
            if (result === 'overflow') {
              releaseInitialInput(
                request.id,
                value,
                'Viewer: More than 65,536 characters arrived while waiting. The pending command was cancelled. Queued input was sent to the shell, which remains available.',
              );
            } else if (wasWaiting && !input.waiting) scheduleInitialInput(request.id, value);
          } else value.process.write(request.data);
        }
      } else if (request.kind === 'resize') value.process.resize(request.cols, request.rows);
      else if (request.kind === 'ack') {
        value.pending = Math.max(0, value.pending - request.bytes);
        if (!value.stopped && value.pending < 128 * 1024) value.process.resume();
      } else if (request.kind === 'close') {
        cancelInitialInput(value);
        clearTimeout(value.timer);
        clearTimeout(value.deadline);
        value.stopped = true;
        value.process.resume();
        value.process.kill();
      } else if (request.kind === 'kill') {
        cancelInitialInput(value);
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
      cancelInitialInput(session);
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
    cancelInitialInput(value);
    clearTimeout(value.deadline);
    try {
      value.process.kill();
    } catch {
      /* already exited */
    }
  }
});
