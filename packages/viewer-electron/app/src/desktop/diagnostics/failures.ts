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

const secretPatterns: readonly RegExp[] = [
  // provider keys and tokens by their published prefixes
  /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // `apiKey: …`, `token=…`, `"password": "…"`
  /\b((?:api[-_]?key|access[-_]?token|token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
];

/** Credentials a message may quote, replaced before it is kept. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of secretPatterns)
    redacted = redacted.replace(pattern, (match, prefix?: string) =>
      typeof prefix === 'string' ? prefix + '[redacted]' : '[redacted]',
    );
  return redacted;
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
  return redactSecrets(values.map(describe).join(' ')).slice(0, 8000);
}

/** Keeps writing to the console as before, and records a bounded share of what it writes. */
export function recordConsoleErrors(
  output: Pick<Console, 'error'>,
  record: (detail: string) => void,
  budget: DiagnosticBudget,
): void {
  const write = output.error.bind(output);
  output.error = (...values: unknown[]) => {
    write(...values);
    if (budget.take('console')) record(diagnosticText(values));
  };
}

/** A worker's stderr, line by line, at most a budget's share a minute. */
export class WorkerOutput {
  private partial = '';
  private skipped = 0;

  constructor(
    private name: string,
    private record: (detail: string) => void,
    private budget: DiagnosticBudget,
  ) {}

  write(chunk: Buffer | string): void {
    const lines = (this.partial + chunk.toString()).split('\n');
    // a line without its end yet is held, bounded
    this.partial = lines.pop()!.slice(-2000);
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      if (!this.budget.take('worker:' + this.name)) {
        this.skipped++;
        continue;
      }
      const omitted = this.skipped
        ? ` (${this.skipped} earlier ${this.skipped === 1 ? 'line' : 'lines'} left out)`
        : '';
      this.skipped = 0;
      this.record(`${this.name}${omitted}: ${redactSecrets(text).slice(0, 1000)}`);
    }
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
  record(detail: string): void;
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
      .ask(redactSecrets(message).slice(0, 500))
      .then((choice) => {
        if (choice === 'show-log') this.host.showLog();
      })
      .catch(() => {})
      .finally(() => this.host.quit());
  }

  rejection(reason: unknown): void {
    if (this.budget.take('rejection')) this.host.record(diagnosticText([reason]));
  }
}
