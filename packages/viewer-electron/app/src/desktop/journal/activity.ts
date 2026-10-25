import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { OperationJob } from '../../domain/contracts';
import type { TerminalEvent } from '../../domain/automation/actions';
import type { ChatDocument } from '../../domain/models/chat';
import {
  journalOriginSchema,
  type JournalAction,
  type JournalOrigin,
  type JournalPhase,
  type JournalSource,
} from '../../domain/journal/events';
import type { JournalStore } from './store';

interface Span {
  source: JournalSource;
  action: JournalAction;
  origin: JournalOrigin;
  traceID: string;
  taskID?: string;
  started: number;
  waiting?: boolean;
  finished?: boolean;
}

/** Captures origins at service entry; callbacks never look at the focused window. */
export class JournalActivity {
  private readonly context = new AsyncLocalStorage<JournalOrigin>();
  private readonly jobs = new Map<string, Span>();
  private readonly terminals = new Map<string, Span>();
  private readonly chats = new Map<string, Span>();

  constructor(private readonly store: Pick<JournalStore, 'record'>) {}

  within<T>(origin: JournalOrigin, work: () => T): T {
    const valid = journalOriginSchema.safeParse(origin);
    return this.context.run(valid.success ? valid.data : {}, work);
  }

  /** A service's validated target is more precise than the window's last published focus. */
  at<T>(origin: JournalOrigin, work: () => T): T {
    return this.within({ ...this.context.getStore(), ...origin }, work);
  }

  begin(source: JournalSource, action: JournalAction, taskID?: string): Span {
    const span: Span = {
      source,
      action,
      origin: { ...this.context.getStore() },
      traceID: randomUUID(),
      taskID,
      started: performance.now(),
    };
    this.write(span, 'started');
    return span;
  }

  private write(
    span: Span,
    phase: JournalPhase,
    details: { count?: number; exitCode?: number } = {},
  ) {
    if (span.finished) return;
    if (phase === 'succeeded' || phase === 'failed' || phase === 'cancelled') span.finished = true;
    try {
      this.store.record({
        source: span.source,
        action: span.action,
        origin: span.origin,
        traceID: span.traceID,
        taskID: span.taskID,
        phase,
        ...(phase !== 'started'
          ? { durationMs: Math.max(0, performance.now() - span.started) }
          : {}),
        ...details,
      });
    } catch {
      /* Observability never changes an operation's result. */
    }
  }

  async run<T>(source: JournalSource, action: JournalAction, work: () => Promise<T>): Promise<T> {
    const span = this.begin(source, action);
    try {
      const value = await work();
      this.write(span, 'succeeded');
      return value;
    } catch (error) {
      this.write(
        span,
        error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
      );
      throw error;
    }
  }

  async git<T>(id: string, action: JournalAction, work: () => Promise<T>): Promise<T> {
    if (this.terminals.has(id)) return work();
    const span = this.begin('git', action, id);
    // A rejected duplicate launch must not steal the original terminal's completion.
    const tracked = !this.terminals.has(id) && this.terminals.size < 256;
    if (tracked) this.terminals.set(id, span);
    try {
      return await work();
    } catch (error) {
      if (tracked && this.terminals.get(id) === span) this.terminals.delete(id);
      this.write(span, 'failed');
      throw error;
    }
  }

  terminal(event: TerminalEvent): void {
    if (event.type === 'data') return;
    const span = this.terminals.get(event.id);
    if (!span) return;
    this.terminals.delete(event.id);
    this.write(
      span,
      event.type === 'exit' && event.code === 0 ? 'succeeded' : 'failed',
      event.type === 'exit' ? { exitCode: event.code } : {},
    );
  }

  cancelGit(id: string, windowID: string | undefined): void {
    const span = this.terminals.get(id);
    if (!span || !windowID || span.origin.windowID !== windowID) return;
    this.terminals.delete(id);
    this.write(span, 'cancelled');
  }

  async send<T>(id: string, work: () => Promise<T>): Promise<T> {
    const span = this.begin('chat', 'send', id);
    const tracked = !this.chats.has(id) && this.chats.size < 8;
    if (tracked) this.chats.set(id, span);
    try {
      return await work();
    } catch (error) {
      if (tracked && this.chats.get(id) === span) this.chats.delete(id);
      this.write(span, 'failed');
      throw error;
    }
  }

  chat(document: Pick<ChatDocument, 'id' | 'status'>): void {
    const span = this.chats.get(document.id);
    if (!span || document.status === 'running') return;
    this.chats.delete(document.id);
    this.write(
      span,
      document.status === 'failed'
        ? 'failed'
        : document.status === 'stopped'
          ? 'cancelled'
          : 'succeeded',
    );
  }

  job(job: OperationJob): void {
    let span = this.jobs.get(job.id);
    if (!span && job.status === 'queued' && this.jobs.size < 1024) {
      span = this.begin('files', job.kind, job.id);
      this.jobs.set(job.id, span);
    }
    if (!span) return;
    if (job.status === 'collision' && !span.waiting) {
      span.waiting = true;
      this.write(span, 'waiting');
    }
    if (job.status === 'running') span.waiting = false;
    if (!['completed', 'cancelled', 'failed'].includes(job.status)) return;
    this.jobs.delete(job.id);
    this.write(
      span,
      job.status === 'completed'
        ? 'succeeded'
        : job.status === 'cancelled'
          ? 'cancelled'
          : 'failed',
      { count: job.completed.length },
    );
  }
}
