import { licensePayload, licenseSignature } from './support/diagnostic-license';
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
import { shellQuote } from '../src/desktop/terminals/terminal-launch';
import { UtilityClient, reportWorkers } from '../src/desktop/workers/utility-client';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { boundedText, boundedTextTail } from '../src/domain/diagnostics/text';

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
  it('rotates multibyte records by their UTF-8 byte size', async () => {
    const limit = 20000;
    const log = new DiagnosticLog(path.join(root, 'multibyte.log'), limit);
    const prior = JSON.stringify({ detail: '試験文'.repeat(500) }) + '\n';
    await writeFile(log.file, prior.repeat(12), { flag: 'wx' });
    const newest = '試験文'.repeat(500) + ' latest';
    await log.record('renderer-error', newest);
    const bytes = await readFile(log.file);
    expect(bytes.length).toBeLessThanOrEqual(limit / 2);
    const entries = bytes
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries.at(-1)?.detail).toBe(newest);
  });
});
describe('what the log keeps', () => {
  it.each([
    ['--password ,EXAMPLE_ONLY --json', '--password [redacted] --json'],
    ['--db-password=,SAMPLE_ONLY --json', '--db-password=[redacted] --json'],
    ['--client-secret=;SAMPLE_ONLY', '--client-secret=[redacted]'],
    ['--custom-api-key ,SAMPLE_ONLY', '--custom-api-key [redacted]'],
    ['DB_PASSWORD=,SAMPLE_ONLY run', 'DB_PASSWORD=[redacted]'],
    ['export client_secret=;SAMPLE_ONLY', 'export client_secret=[redacted]'],
    ['(password=) retry available', '(password=[redacted]'],
    ['_AUTH_TOKEN= SAMPLE ONLY', '_AUTH_TOKEN= [redacted]'],
    ['__AUTH_TOKEN=SAMPLE ONLY', '__AUTH_TOKEN=[redacted]'],
    ['"password":not JSON SAMPLE ONLY', '"password":[redacted]'],
    ['DB_PASSWORD= "SAMPLE ONLY"', 'DB_PASSWORD= [redacted]'],
    ["DB_PASSWORD=  'SAMPLE\nSECOND LINE'", 'DB_PASSWORD=  [redacted]'],
    ['configuration DB_PASSWORD= SAMPLE ONLY', 'configuration DB_PASSWORD= [redacted]'],
    ['export DB_PASSWORD=  ,FIRST SECOND', 'export DB_PASSWORD=  [redacted]'],
    ['password =  sample value\nnext diagnostic', 'password =  [redacted]\nnext diagnostic'],
    ['env DB_PASSWORD= viewer --version', 'env DB_PASSWORD= [redacted]'],
    ['env MODE=test DB_PASSWORD= viewer --version', 'env MODE=test DB_PASSWORD= [redacted]'],
    [
      'env viewer configuration DB_PASSWORD= SAMPLE ONLY',
      'env viewer configuration DB_PASSWORD= [redacted]',
    ],
    [
      'exec /usr/bin/env AUTHORIZATION= viewer --version',
      'exec /usr/bin/env AUTHORIZATION= [redacted]',
    ],
    ['DB_PASSWORD= viewer --version', 'DB_PASSWORD= [redacted]'],
    ['--db-password= sync', '--db-password= sync'],
    ['--db-password= -v', '--db-password= -v'],
    ['--authorization= -v', '--authorization= -v'],
    ['AUTHORIZATION= viewer --version', 'AUTHORIZATION= [redacted]'],
    [`"--client-secret" "SAMPLE ONLY" --json`, `"--client-secret" [redacted] --json`],
    [`'--db-password=two words' --json`, `'--db-password=[redacted]' --json`],
    ['--db-password= --json', '--db-password= --json'],
    ['?db-password=&page=2', '?db-password=&page=2'],
    ['{"password": "SAMPLE\r\n_ONLY","ok":true}', '{"password": [redacted],"ok":true}'],
    ['{"client_secret": "SAMPLE\\"ONLY"}', '{"client_secret": [redacted]}'],
    ['{"Cookie": "SAMPLE_ONLY", "ok":true}', '{"Cookie": [redacted], "ok":true}'],
    ['{"token": 1234,"ok":true}', '{"token": [redacted],"ok":true}'],
    ['{"token": {"value":["SAMPLE_ONLY}"]},"ok":true}', '{"token": [redacted],"ok":true}'],
    ['{"token": ["SAMPLE_ONLY",{"id":1}],"ok":true}', '{"token": [redacted],"ok":true}'],
    ['{"token":\n42\n{"ok":true}', '{"token":\n42\n{"ok":true}'],
    ['--token=;EXAMPLE_ONLY', '--token=[redacted]'],
    ['-u a,b&EXAMPLE_ONLY', '-u [redacted]'],
    ['--password prefix" EXAMPLE_ONLY" --json', '--password [redacted] --json'],
    ['--password prefix\\ EXAMPLE_ONLY --json', '--password [redacted] --json'],
    [
      'https://test.invalid/?token=,EXAMPLE_ONLY&page=2',
      'https://test.invalid/?token=[redacted]&page=2',
    ],
    ['Authorization:\n    at nextFrame', 'Authorization:\n    at nextFrame'],
    ['Cookie:  \r\nnext diagnostic line', 'Cookie:  \r\nnext diagnostic line'],
    [
      'https://test.invalid/?authorization=%12&page=3',
      'https://test.invalid/?authorization=[redacted]&page=3',
    ],
  ])('uses credential boundaries at log ingress for %s', async (message, expected) => {
    const log = new DiagnosticLog(path.join(root, 'ingress.log'));
    await log.record('main-error', message);
    expect(JSON.parse(await readFile(log.file, 'utf8')).detail).toBe(expected);
  });
  it.each(['https://api.example.invalid/query?token=&page=2\n    at fetchData', '--token= --json'])(
    'preserves the suffix after an empty credential value (%s)',
    (text) => {
      expect(redactSecrets(text)).toBe(text);
    },
  );
  it.each(['--db-password', '--client-secret', '--api-key', '-u'])(
    'redacts a separate value after the launcher quotes the option %s',
    async (option) => {
      const log = new DiagnosticLog(path.join(root, 'quoted-command.log'));
      for (const secret of [',SAMPLE ONLY', "SAMPLE's value", 'SAMPLE\\']) {
        const args = ['viewer', option, secret, 'show status', '-v'];
        await log.record('main-error', args.map(shellQuote).join(' '));
      }
      const lines = (await readFile(log.file, 'utf8')).trimEnd().split('\n');
      expect(lines.map((line) => JSON.parse(line).detail)).toEqual(
        Array(3).fill(
          [
            shellQuote('viewer'),
            shellQuote(option),
            '[redacted]',
            shellQuote('show status'),
            shellQuote('-v'),
          ].join(' '),
        ),
      );
    },
  );
  it('cuts every diagnostic boundary without leaving a surrogate half', async () => {
    for (const limit of [500, 1000, 2000, 8000]) {
      const text = 'x'.repeat(limit - 1) + '😀';
      expect(boundedText(text, limit)).toHaveLength(limit - 1);
      expect(() =>
        encodeURIComponent(boundedTextTail('😀' + 'x'.repeat(limit - 1), limit)),
      ).not.toThrow();
    }
    const text = 'x'.repeat(7999) + '😀';
    expect(() => encodeURIComponent(diagnosticText([text]))).not.toThrow();
    const log = new DiagnosticLog(path.join(root, 'emoji.log'));
    await log.record('renderer-error', text);
    const kept = JSON.parse((await readFile(log.file, 'utf8')).trim()).detail;
    expect(() => encodeURIComponent(kept)).not.toThrow();
    expect(kept).toHaveLength(7999);
  });

  it.each([
    'DB_PASSWORD=hunter2',
    'client_secret="private words"',
    "MYAPP_API_KEY='private words'",
    'passwd=hunter2 pwd=hunter2 pass: hunter2',
    '-u user:hunter2',
    '--password "private words"',
    'Cookie: session=hunter2; private-cookie=value',
    `“viewer-license-1.\n ${licensePayload}.\n ${licenseSignature}”`,
    `“vie\n wer- license -1.\n ${licensePayload}.\n ${licenseSignature}”`,
  ])('does not persist recognizable credential forms: %s', async (text) => {
    expect(redactSecrets(text)).not.toMatch(/hunter2|private words|private-cookie|eyJ|abcdefghijk/);
    const log = new DiagnosticLog(path.join(root, 'credentials.log'));
    await log.record('renderer-error', text);
    expect(await readFile(log.file, 'utf8')).not.toMatch(
      /hunter2|private words|private-cookie|eyJ|abcdefghijk/,
    );
  });

  it('names objects by their kind, never their contents, and redacts credentials', () => {
    const text = diagnosticText([
      'Save failed',
      new Error('Disk full'),
      { contents: 'unlogged-content file text' },
      Buffer.from('unlogged-content bytes'),
      42,
    ]);
    expect(text).toContain('Save failed');
    expect(text).toContain('Error: Disk full');
    expect(text).toContain('[Object] [Buffer] 42');
    // a word no file path holds: a stack trace under /private/tmp has 'private' in it
    expect(text).not.toContain('unlogged-content');
    const secrets = redactSecrets(
      'key sk-proj-abcdef1234567890 Authorization: Bearer abc.def.ghi123 apiKey="hunter22" token=xyz98765',
    );
    expect(secrets).not.toMatch(/abcdef1234567890|abc\.def|hunter22|xyz98765/);
    expect(secrets).toContain('[redacted]');
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

  it.each([2000, 2001, 12000])(
    'resumes bracketed warnings and JSON after a %i-character worker line',
    (length) => {
      const records: string[] = [];
      const worker = new WorkerOutput(
        'Preview',
        (detail, source) => records.push(source + ': ' + detail),
        new DiagnosticBudget(),
      );
      for (const part of [
        'x'.repeat(length - 1),
        'x\n',
        '[warning] decoder unavailable\n',
        '[info] retry complete\n',
        '{"status":"ready"}\n',
      ])
        worker.write(part);
      expect(records.slice(1)).toEqual([
        'Preview: [warning] decoder unavailable',
        'Preview: [info] retry complete',
        'Preview: {"status":"ready"}',
      ]);
      if (length > 2000) expect(records[0]).toBe('Preview: [Long worker line omitted]');
    },
  );

  it.each([
    "'viewer' 'public-secret' '--db-password' 'first\nSAMPLE_ONLY'",
    "'viewer' '--old-token' '--db-password' 'first\nSAMPLE_ONLY'",
    '"--db-password" "first\nSAMPLE_ONLY"',
    "trace '--db-pass\x1b[31mword' 'first\nSAMPLE_ONLY'",
    "trace '--db-pass[31mword' 'first\nSAMPLE_ONLY'",
    "'--db-password=first\nSAMPLE_ONLY'",
    "DB_PASSWORD= 'first\nSAMPLE_ONLY'",
    "--db-password prefix'first\nSAMPLE_ONLY'",
    '-u "first\\\nSAMPLE_ONLY"',
  ])('resumes a complete worker record after the quoted credential in %j', (command) => {
    for (const padding of ['', 'x'.repeat(2500) + ' ']) {
      const records: string[] = [];
      const worker = new WorkerOutput(
        'Preview',
        (detail, source) => records.push(source + ': ' + detail),
        new DiagnosticBudget(),
      );
      for (const ch of padding + command + '\n[warning] recovered\n{"status":"ready"}\n')
        worker.write(ch);
      expect(records.join('\n')).not.toContain('SAMPLE_ONLY');
      expect(records.slice(-2)).toEqual([
        'Preview: [warning] recovered',
        'Preview: {"status":"ready"}',
      ]);
    }
  });

  it.each([
    "password wasn't configured",
    'parse error at [offset',
    'unexpected TOKEN": [offset',
    'field "token": [offset',
    'field "token": {"items":[1,broken',
  ])('recovers after an overlong plain-language warning containing %j', (warning) => {
    const rows: string[] = [];
    const worker = new WorkerOutput(
      'Preview',
      (row, source) => rows.push(source + ': ' + row),
      new DiagnosticBudget(),
    );
    worker.write(
      'x'.repeat(2001) +
        ' ' +
        warning +
        '\n{"status":"checking"}\n{"status":"retry"}\n[warning] recovered\n{"status":"ready"}\n',
    );
    expect(rows.slice(1)).toEqual([
      'Preview: {"status":"checking"}',
      'Preview: {"status":"retry"}',
      'Preview: [warning] recovered',
      'Preview: {"status":"ready"}',
    ]);
  });

  it('preserves credential context in the discarded portion of a long worker line', () => {
    const records: string[] = [];
    const worker = new WorkerOutput(
      'Preview',
      (detail, source) => records.push(source + ': ' + detail),
      new DiagnosticBudget(),
    );
    const command = ['viewer', '--db-password', "first's [value\nSAMPLE_FIVE\nlast secret", 'done']
      .map(shellQuote)
      .join(' ');
    const stderr =
      'x'.repeat(9000) +
      ' ' +
      command +
      '\n[warning] recovered\n' +
      'x'.repeat(10000) +
      ' {"password":["secret\nSAMPLE_SIX"]}\n{"status":"ready"}\n';
    for (let offset = 0; offset < stderr.length; offset += 7)
      worker.write(stderr.slice(offset, offset + 7));
    expect(records.join('\n')).not.toMatch(/SAMPLE|last secret/);
    expect(records).toContain('Preview: [warning] recovered');
    expect(records.at(-1)).toBe('Preview: {"status":"ready"}');
  });

  it('tracks quoted worker values when the budget skips their opening and closing lines', () => {
    let now = 0;
    const rows: string[] = [];
    const worker = new WorkerOutput(
      'Preview',
      (row, source) => rows.push(source + ': ' + row),
      new DiagnosticBudget(1, 100, () => now),
    );
    worker.write("ordinary message\n'--db-password' 'first\n");
    now = 100;
    worker.write("SAMPLE_ONLY\nlast'\n");
    now = 200;
    worker.write('[warning] resumed\n');
    expect(rows).toEqual([
      'Preview: ordinary message',
      'Preview (1 earlier line left out): [Worker continuation omitted]',
      'Preview (1 earlier line left out): [warning] resumed',
    ]);
  });

  it('tracks an open JSON string across a worker line skipped by the rate limit', () => {
    let now = 0;
    const records: string[] = [];
    const output = new WorkerOutput(
      'Preview',
      (detail, source) => records.push(source + ': ' + detail),
      new DiagnosticBudget(1, 1000, () => now),
    );
    output.write('ordinary message\n{"password":"start\n');
    now = 1000;
    output.write('  SAMPLE_ONLY"}\n');
    now = 2000;
    output.write('{"status":"ready"}\n');
    expect(records).toEqual([
      'Preview: ordinary message',
      'Preview (1 earlier line left out): [Worker continuation omitted]',
      'Preview: {"status":"ready"}',
    ]);
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
    expect(record.mock.calls).toEqual([['first line', 'Viewer previews']]);
    now = 1000;
    output.write('third line\n');
    expect(record).toHaveBeenLastCalledWith(
      'third line',
      'Viewer previews (1 earlier line left out)',
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
    reportWorkers({
      output: () => ({ write: (chunk) => lines(String(chunk)), end: () => {} }),
      stopped,
    });
    const client = new UtilityClient(worker, { name: 'Fixture worker', backend: 'thread' });
    await expect(client.call('anything')).rejects.toThrow('Background file services stopped');
    await vi.waitFor(() =>
      expect(stopped).toHaveBeenCalledWith(
        'Fixture worker',
        expect.stringMatching(/^worker failed \(exit 1\)$/),
      ),
    );
    expect(lines.mock.calls.join('')).toContain('worker says goodbye');
    await client.close();
  });
});
