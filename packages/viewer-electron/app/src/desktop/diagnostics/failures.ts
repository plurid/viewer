import { StringDecoder } from 'node:string_decoder';
import { WorkerRecordBoundary } from './worker-record';
import { boundedText } from '../../domain/diagnostics/text';
import { redactCredentials } from '../../domain/diagnostics/secrets';
import { diagnosticFailure } from '../../domain/diagnostics/failure';
import type { DiagnosticErrorFields } from '../../domain/diagnostics/failure';

/** At most `limit` entries a minute from one source: a failure loop cannot flood the log. */
export class DiagnosticBudget {
  private spent = new Map<string, number[]>();

  constructor(
    private limit = 30,
    private span = 60_000,
    private now: () => number = Date.now,
  ) {}

  take(source: string): boolean {
    const now = this.now();
    const recent = (this.spent.get(source) ?? []).filter((at) => now - at < this.span);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(now);
    this.spent.set(source, recent);
    return allowed;
  }
}

/** Credentials a message may quote, replaced before it is kept. */
export function redactSecrets(text: string): string {
  return redactCredentials(text)
    .replace(/\p{Cc}/gu, (character) => (/[\r\n]/.test(character) ? character : ' '))
    .replace(/\p{Cf}/gu, (character) => (/[\u200c\u200d]/.test(character) ? character : ''));
}

/** A value as a log line names it: strings, numbers and errors as they read; any other object by
 * its kind only, so no file contents or settings it holds are copied. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  if (['number', 'boolean', 'bigint', 'undefined'].includes(typeof value) || value === null)
    return String(value);
  if (typeof value === 'symbol') return value.toString();
  const kind = (value as { constructor?: { name?: string } }).constructor?.name;
  return `[${kind || typeof value}]`;
}

/** What a console line says, bounded and with secrets redacted. */
export function diagnosticText(values: readonly unknown[]): string {
  return boundedText(redactSecrets(values.map(describe).join(' ')));
}

/** Keeps writing to the console as before, and records a bounded share of what it writes. */
export function recordConsoleErrors(
  output: Pick<Console, 'error'>,
  record: (detail: string, fields?: DiagnosticErrorFields) => void,
  budget: DiagnosticBudget,
): void {
  const write = output.error.bind(output);
  output.error = (...values: unknown[]) => {
    write(...values);
    if (budget.take('console')) {
      const error = values.find((value) => value instanceof Error);
      record(diagnosticText(values), error ? diagnosticFailure(error) : undefined);
    }
  };
}

/** A worker's stderr, line by line, at most a budget's share a minute. */
export class WorkerOutput {
  private decoder = new StringDecoder('utf8');
  private partial = '';
  private overlong = false;
  private skipped = 0;
  private boundary = new WorkerRecordBoundary();

  constructor(
    private name: string,
    private record: (detail: string) => void,
    private budget: DiagnosticBudget,
  ) {}

  write(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? this.decoder.end() + chunk : this.decoder.write(chunk);
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf('\n', start);
      const end = newline < 0 ? text.length : newline;
      if (this.partial.length + end - start > 2000) this.overlong = true;
      const part = text.slice(start, end);
      this.boundary.scan(part);
      if (!this.overlong) this.partial += part;
      if (newline < 0) return;
      this.recordLine();
      this.partial = '';
      this.overlong = false;
      start = end + 1;
    }
  }

  private recordLine(): void {
    const disposition = this.boundary.finishLine();
    const raw = this.partial.trim();
    if (!this.overlong && disposition === 'empty') return;
    if (!this.budget.take('worker:' + this.name)) {
      this.skipped++;
      return;
    }
    const omitted = this.skipped
      ? ` (${this.skipped} earlier ${this.skipped === 1 ? 'line' : 'lines'} left out)`
      : '';
    this.skipped = 0;
    const detail = this.overlong
      ? '[Long worker line omitted]'
      : disposition === 'omit'
        ? '[Worker continuation omitted]'
        : boundedText(redactSecrets(raw), 1000);
    this.record(`${this.name}${omitted}: ${detail}`);
  }
}

/** The answer to an exception nothing caught. */
export type MainFailureChoice = 'quit' | 'show-log';

export interface MainFailureHost {
  /** Asks the person; hidden verification runs answer without a dialog. */
  ask(message: string): Promise<MainFailureChoice>;
  showLog(): void;
  /** Quits through the quit sequence, which saves every window first. */
  quit(): void;
  record(detail: string, fields?: DiagnosticErrorFields): void;
}

/**
 * An exception nothing caught leaves the main process in a state no code expected, so Viewer
 * records it, says so once and quits through its quit sequence. A rejection ends only the work
 * that made it, as Electron's main process always treated it: Viewer records it and goes on.
 */
export class MainFailures {
  private handling = false;

  constructor(
    private host: MainFailureHost,
    private budget = new DiagnosticBudget(),
  ) {}

  /** Uncaught exceptions are already recorded by the process's monitor. */
  exception(error: unknown): void {
    if (this.handling) return;
    this.handling = true;
    const message = error instanceof Error ? error.message : String(error);
    void this.host
      .ask(boundedText(redactSecrets(message), 500))
      .then((choice) => {
        if (choice === 'show-log') this.host.showLog();
      })
      .catch(() => {})
      .finally(() => this.host.quit());
  }

  rejection(reason: unknown): void {
    if (this.budget.take('rejection'))
      this.host.record(
        diagnosticText([reason]),
        reason instanceof Error ? diagnosticFailure(reason) : undefined,
      );
  }
}
