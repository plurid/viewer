import type { TerminalEvent, TerminalStart } from '../../domain/automation/actions';

/** Private main-to-worker messages. Public terminal IPC never accepts a program or environment. */
export type TerminalWorkerRequest =
  | (TerminalStart & {
      kind: 'start';
      executable: string;
      args: string[];
      env: Record<string, string>;
      outputLimit?: number;
      timeoutMs?: number;
      readOnly?: boolean;
    })
  | { kind: 'write'; id: string; data: string }
  | { kind: 'resize'; id: string; cols: number; rows: number }
  | { kind: 'ack'; id: string; bytes: number }
  | { kind: 'close' | 'kill'; id: string };

/** Worker-to-main messages: a session's events, and its process ID once it starts. */
export type TerminalWorkerReply = TerminalEvent | { type: 'started'; id: string; pid: number };
