import { randomUUID } from 'node:crypto';
import type { FlushResult } from '../../domain/persistence/flush';

export const FLUSH_TIMEOUT_MS = 10_000;
type FlushKind = 'flush' | 'flush-settings' | `note-trash:${string}`;

interface Request {
  owner: number;
  kind: FlushKind;
  promise: Promise<void>;
  finish(result: FlushResult): void;
}

/** Acknowledgements confer no authority across native windows, and silence is never success. */
export class WindowFlushRequests {
  private readonly pending = new Map<string, Request>();

  request(owner: number, kind: FlushKind, send: (token: string) => void): Promise<void> {
    const existing = [...this.pending.values()].find(
      (request) => request.owner === owner && request.kind === kind,
    );
    if (existing) return existing.promise;
    const token = randomUUID();
    let finish!: Request['finish'];
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: 'The window did not finish saving. Keep it open and retry when it responds.',
          code: 'PERSISTENCE_TIMEOUT',
        });
      }, FLUSH_TIMEOUT_MS);
      finish = (result) => {
        if (!this.pending.delete(token)) return;
        clearTimeout(timer);
        if (result.ok) resolve();
        else reject(Object.assign(new Error(result.error), { code: result.code, owner }));
      };
    });
    this.pending.set(token, { owner, kind, promise, finish });
    try {
      send(token);
    } catch (error) {
      finish({ ok: false, error: String(error).slice(0, 2000), code: 'PERSISTENCE_SEND_FAILED' });
    }
    return promise;
  }

  acknowledge(token: string, owner: number, result: FlushResult): void {
    const request = this.pending.get(token);
    if (request?.owner === owner) request.finish(result);
  }

  /** A stopped renderer saves nothing more: what it saved last is what it has, so its pending
   * saves end without waiting for an answer that cannot come. */
  released(owner: number): void {
    for (const request of [...this.pending.values()])
      if (request.owner === owner) request.finish({ ok: true });
  }

  disconnected(owner: number): void {
    for (const request of [...this.pending.values()])
      if (request.owner === owner)
        request.finish({
          ok: false,
          error: 'The window closed before its changes were saved.',
          code: 'PERSISTENCE_WINDOW_CLOSED',
        });
  }
}
