import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { boundedText } from '../../domain/diagnostics/text';
import {
  diagnosticFailure,
  knownErrorCode,
  knownErrorName,
} from '../../domain/diagnostics/failure';
import type { DiagnosticErrorFields } from '../../domain/diagnostics/failure';
import { redactSecrets } from './failures';

export type DiagnosticKind =
  | 'main-exception'
  | 'main-rejection'
  | 'main-error'
  | 'service-error'
  | 'renderer-error'
  | 'renderer-gone'
  | 'renderer-unresponsive'
  | 'process-gone'
  | 'worker-output';

/**
 * A local, private log of failures for support. Nothing is sent anywhere: a person can
 * reveal it from the Help menu and choose to share it. Entries are bounded, and the file
 * keeps its most recent half when it grows past its limit.
 */
export class DiagnosticLog {
  private queue: Promise<void> = Promise.resolve();
  constructor(
    readonly file: string,
    private limit = 1024 * 1024,
  ) {}
  record(
    kind: DiagnosticKind,
    value: unknown,
    fields?: DiagnosticErrorFields,
    source?: string,
  ): Promise<void> {
    const failure =
      value instanceof Error
        ? diagnosticFailure(value)
        : {
            detail: String(value),
            errorClass: fields?.errorClass,
            code: fields?.code,
            stack: fields?.stack,
          };
    const errno = new Set(Object.keys(os.constants?.errno ?? {}));
    // Labels never establish credential boundaries in a message. Keep the stored display format.
    const prefix = source ? redactSecrets(source) + ': ' : '';
    const detail = redactSecrets(failure.detail);
    const line =
      JSON.stringify({
        at: new Date().toISOString(),
        kind,
        detail: boundedText(
          prefix + (kind === 'worker-output' ? boundedText(detail, 1000) : detail),
        ),
        errorClass: knownErrorName(failure.errorClass),
        code: knownErrorCode(failure.code, errno),
        stack: failure.stack ? boundedText(redactSecrets(failure.stack)) : undefined,
      }) + '\n';
    this.queue = this.queue.then(() => this.append(line)).catch(() => {});
    return this.queue;
  }
  private async append(line: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, line, { mode: 0o600 });
    if ((await stat(this.file)).size <= this.limit) return;
    const bytes = await readFile(this.file);
    const boundary = bytes.indexOf(10, bytes.length - Math.floor(this.limit / 2) - 1);
    // Start at a whole entry; the replacement is written beside the log, then renamed over it.
    // The newest entry always survives, even one larger than the half that is kept.
    const start =
      boundary >= 0 && boundary < bytes.length - 1
        ? boundary + 1
        : bytes.lastIndexOf(10, bytes.length - 2) + 1;
    const kept = bytes.subarray(start);
    const replacement = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(replacement, kept, { mode: 0o600, flag: 'wx' });
    await rename(replacement, this.file);
  }
}
