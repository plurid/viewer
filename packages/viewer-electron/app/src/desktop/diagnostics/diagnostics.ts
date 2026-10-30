import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  record(kind: DiagnosticKind, detail: string): Promise<void> {
    const line =
      JSON.stringify({ at: new Date().toISOString(), kind, detail: detail.slice(0, 8000) }) + '\n';
    this.queue = this.queue.then(() => this.append(line)).catch(() => {});
    return this.queue;
  }
  private async append(line: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, line, { mode: 0o600 });
    if ((await stat(this.file)).size <= this.limit) return;
    const text = await readFile(this.file, 'utf8');
    const recent = text.slice(text.length - Math.floor(this.limit / 2));
    // Start at a whole entry; the replacement is written beside the log, then renamed over it.
    // The newest entry always survives, even one larger than the half that is kept.
    const kept =
      recent.slice(recent.indexOf('\n') + 1) ||
      text.slice(text.lastIndexOf('\n', text.length - 2) + 1);
    const replacement = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(replacement, kept, { mode: 0o600, flag: 'wx' });
    await rename(replacement, this.file);
  }
}
