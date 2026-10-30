import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DiagnosticLog } from '../src/desktop/diagnostics/diagnostics';
import {
  DiagnosticBudget,
  MainFailures,
  WorkerOutput,
  diagnosticText,
  recordConsoleErrors,
  redactSecrets,
} from '../src/desktop/diagnostics/failures';
import { UtilityClient, reportWorkers } from '../src/desktop/workers/utility-client';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-diagnostics-');
});
afterEach(async () => {
  await trashTemporary(root);
});
describe('diagnostic log', () => {
  it('appends bounded entries and keeps the most recent half past its limit', async () => {
    const log = new DiagnosticLog(path.join(root, 'Logs', 'diagnostics.log'), 20000);
    await log.record('renderer-error', 'x'.repeat(20000));
    let lines = (await readFile(log.file, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[0]).detail).toHaveLength(8000);
    for (let index = 0; index < 400; index++)
      await log.record('main-rejection', `failure ${index}`);
    const text = await readFile(log.file, 'utf8');
    expect(text.length).toBeLessThanOrEqual(20000);
    lines = text.trim().split('\n');
    // Whole entries only, ending with the latest.
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(lines.at(-1)!).detail).toBe('failure 399');
    expect(await readdir(path.dirname(log.file))).toEqual(['diagnostics.log']);
  });
  it('keeps the newest entry even when it alone exceeds the limit', async () => {
    const log = new DiagnosticLog(path.join(root, 'small.log'), 1000);
    await log.record('renderer-error', 'first');
    await log.record('renderer-error', 'y'.repeat(5000));
    const lines = (await readFile(log.file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).detail).toHaveLength(5000);
  });
});
describe('what the log keeps', () => {
  it('names objects by their kind, never their contents, and redacts credentials', () => {
    const text = diagnosticText([
      'Save failed',
      new Error('Disk full'),
      { contents: 'private file text' },
      Buffer.from('private bytes'),
      42,
    ]);
    expect(text).toContain('Save failed');
    expect(text).toContain('Error: Disk full');
    expect(text).toContain('[Object] [Buffer] 42');
    expect(text).not.toContain('private');
    const secrets = redactSecrets(
      'key sk-proj-abcdef1234567890 Authorization: Bearer abc.def.ghi123 apiKey="hunter22" token=xyz98765',
    );
    expect(secrets).not.toMatch(/abcdef1234567890|abc\.def|hunter22|xyz98765/);
    expect(secrets).toContain('apiKey="[redacted]');
  });

  it('allows each source a bounded number of entries a minute', () => {
    let now = 0;
    const budget = new DiagnosticBudget(2, 60_000, () => now);
    expect([budget.take('a'), budget.take('a'), budget.take('a'), budget.take('b')]).toEqual([
      true,
      true,
      false,
      true,
    ]);
    now = 60_000;
    expect(budget.take('a')).toBe(true);
  });

  it('keeps writing console errors, and records a bounded share of them', () => {
    const written: unknown[][] = [];
    const output = {
      error: (...values: unknown[]) => {
        written.push(values);
      },
    };
    const record = vi.fn();
    recordConsoleErrors(output, record, new DiagnosticBudget(1));
    output.error('First', new Error('one'));
    output.error('Second');
    expect(written).toHaveLength(2);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]![0]).toMatch(/^First Error: one/);
  });

  it('records worker stderr line by line, saying how many lines a full budget left out', () => {
    let now = 0;
    const record = vi.fn();
    const output = new WorkerOutput(
      'Viewer previews',
      record,
      new DiagnosticBudget(1, 1000, () => now),
    );
    output.write('first line\nsecond ');
    output.write('line\n');
    expect(record.mock.calls).toEqual([['Viewer previews: first line']]);
    now = 1000;
    output.write('third line\n');
    expect(record).toHaveBeenLastCalledWith(
      'Viewer previews (1 earlier line left out): third line',
    );
  });
});

describe('main-process failures', () => {
  const host = () => ({
    ask: vi.fn(async (_message: string) => 'show-log' as const),
    showLog: vi.fn(),
    quit: vi.fn(),
    record: vi.fn(),
  });

  it('asks once about an uncaught exception, shows the log when chosen, then quits', async () => {
    const ports = host();
    const failures = new MainFailures(ports);
    failures.exception(new Error('Unexpected state token=abc12345'));
    failures.exception(new Error('A second one while the first is answered'));
    await vi.waitFor(() => expect(ports.quit).toHaveBeenCalledOnce());
    expect(ports.ask).toHaveBeenCalledExactlyOnceWith('Unexpected state token=[redacted]');
    expect(ports.showLog).toHaveBeenCalledOnce();
  });

  it('quits even when the question cannot be shown', async () => {
    const ports = host();
    ports.ask.mockRejectedValueOnce(new Error('No dialog'));
    new MainFailures(ports).exception(new Error('Unexpected'));
    await vi.waitFor(() => expect(ports.quit).toHaveBeenCalledOnce());
    expect(ports.showLog).not.toHaveBeenCalled();
  });

  it('records a rejection and goes on, within its budget', () => {
    const ports = host();
    const failures = new MainFailures(ports, new DiagnosticBudget(1));
    failures.rejection(new Error('Background read failed'));
    failures.rejection(new Error('Again'));
    expect(ports.record).toHaveBeenCalledOnce();
    expect(ports.ask).not.toHaveBeenCalled();
    expect(ports.quit).not.toHaveBeenCalled();
  });

  it('reads a worker thread’s stderr and records why it ended', async () => {
    const worker = path.join(root, 'failing-worker.mjs');
    await writeFile(
      worker,
      "process.stderr.write('worker says goodbye\\n'); setTimeout(() => { throw new Error('worker failed'); }, 50);",
      { flag: 'wx' },
    );
    const lines = vi.fn();
    const stopped = vi.fn();
    reportWorkers({ output: () => (chunk) => lines(String(chunk)), stopped });
    const client = new UtilityClient(worker, { name: 'Fixture worker', backend: 'thread' });
    await expect(client.call('anything')).rejects.toThrow('Background file services stopped');
    await vi.waitFor(() =>
      expect(stopped).toHaveBeenCalledWith(
        'Fixture worker',
        expect.stringMatching(/^Fixture worker: worker failed \(exit 1\)$/),
      ),
    );
    expect(lines.mock.calls.join('')).toContain('worker says goodbye');
    await client.close();
  });
});
